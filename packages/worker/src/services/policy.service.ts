import type { D1Database } from '@cloudflare/workers-types';
import type { DriveProvider } from '../types/drive-provider';
import { logErrorNoCtx } from '../lib/logger';
import { toSQLiteDatetime } from '../lib/datetime';
import { safeJsonParse } from '../lib/safe-json-parse';
import { FileRepository } from '../repositories/file.repository';
import { WorkspaceRepository } from '../repositories/workspace.repository';

export class PolicyService {
  private workspaceRepo: WorkspaceRepository;
  private fileRepo: FileRepository;

  constructor(
    private db: D1Database,
    private driveProvider: DriveProvider,
  ) {
    this.workspaceRepo = new WorkspaceRepository(db);
    this.fileRepo = new FileRepository(db);
  }

  async checkQuota(workspaceId: string, incomingBytes: number): Promise<boolean> {
    const workspace = await this.workspaceRepo.findUsedBytes(workspaceId);
    if (!workspace) return false;

    const policy = await this.workspaceRepo.findStorageQuotaPolicy(workspaceId);

    if (!policy) return true; // No quota set

    const config = safeJsonParse(policy.config, { max_bytes: Infinity }) as { max_bytes: number };
    return workspace.used_bytes + incomingBytes <= config.max_bytes;
  }

  async checkRetentionProtection(folderId: string): Promise<boolean> {
    const policy = await this.workspaceRepo.findRetentionPolicyForFolder(folderId);

    if (!policy) return false;

    const config = safeJsonParse(policy.config, { action: 'prevent_deletion' }) as {
      action: string;
      days?: number;
    };
    return config.action === 'prevent_deletion';
  }

  async updateWorkspaceStorage(workspaceId: string, sizeDelta: number) {
    await this.workspaceRepo.updateUsedBytesStmt(workspaceId, sizeDelta).run();
  }

  /**
   * Atomically reserve quota for an upload. Checks the policy AND increments
   * used_bytes in a single atomic conditional UPDATE. Returns true if the
   * reservation succeeded, false if quota would be exceeded.
   *
   * This replaces the TOCTOU-vulnerable checkQuota + updateWorkspaceStorage
   * pair for upload paths. The caller must handle the false case (delete the
   * uploaded file, return 403).
   */
  async tryReserveQuota(workspaceId: string, incomingBytes: number): Promise<boolean> {
    const policy = await this.workspaceRepo.findStorageQuotaPolicy(workspaceId);
    if (!policy) {
      // No quota policy set — allow unconditionally (but still increment)
      await this.workspaceRepo.updateUsedBytesStmt(workspaceId, incomingBytes).run();
      return true;
    }
    const config = safeJsonParse(policy.config, { max_bytes: Infinity }) as { max_bytes: number };
    return this.workspaceRepo.updateUsedBytesAtomic(workspaceId, incomingBytes, config.max_bytes);
  }

  async processAutoDeleteRetentionPolicies() {
    const MAX_DELETES_PER_CYCLE = 20; // Free-tier: 50 subrequests, leave margin for DB calls

    // 1. Get all auto_delete policies
    const { results: policies } = await this.workspaceRepo.findAllAutoDeleteRetentionPolicies();

    for (const policy of policies) {
      const config = safeJsonParse(policy.config, null) as { action: string; days: number } | null;
      // Skip corrupt or invalid policies — a missing/non-number `days` would
      // crash the date arithmetic below. safeJsonParse already logged the row.
      if (!config || config.action !== 'auto_delete' || typeof config.days !== 'number') {
        continue;
      }
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - config.days);
      const cutoffStr = toSQLiteDatetime(cutoffDate);

      // Build the retention-sweep target. A folder policy with a null target_id
      // is corrupt (the column is the FK to workspace_folders.id) — skip it,
      // matching the "skip corrupt policies" guard above.
      const target =
        policy.target_type === 'workspace'
          ? { kind: 'workspace' as const, workspaceId: policy.workspace_id, cutoffStr }
          : policy.target_id
            ? {
                kind: 'folder' as const,
                workspaceId: policy.workspace_id,
                folderId: policy.target_id,
                cutoffStr,
              }
            : null;
      if (!target) continue;

      const { results: expiredFiles } = await this.fileRepo.findExpiredForRetention(target);

      let deleted = 0;
      for (const file of expiredFiles) {
        if (deleted >= MAX_DELETES_PER_CYCLE) break;

        // Permanently delete via Google Drive API, then remove from DB.
        // If the Google API call fails, skip the DB delete — the file still
        // exists in Drive and would reappear on next sync.
        try {
          await this.driveProvider.deleteFile(file.driveId, file.google_file_id);
        } catch (error) {
          logErrorNoCtx('Retention auto-delete: Google Drive API call failed', error, {
            fileId: file.id,
          });
          continue;
        }

        const stmts: D1PreparedStatement[] = [this.fileRepo.deleteByIdStmt(file.id)];
        if (file.owned_by_me === 1) {
          stmts.push(this.workspaceRepo.updateUsedBytesStmt(file.workspace_id, -file.size));
          stmts.push(
            this.fileRepo.applyStorageDeltaStmt(file.user_id, file.mime_type ?? '', -file.size),
          );
        }
        await this.db.batch(stmts);
        deleted++;
      }
    }
  }
}
