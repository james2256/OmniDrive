import type { D1Database } from '@cloudflare/workers-types';
import { GoogleDriveService } from './google-drive';

export class PolicyService {
  constructor(private db: D1Database) {}

  async checkQuota(workspaceId: string, incomingBytes: number): Promise<boolean> {
    const workspace = await this.db.prepare('SELECT used_bytes FROM workspaces WHERE id = ?').bind(workspaceId).first<{ used_bytes: number }>();
    if (!workspace) return false;

    const policy = await this.db.prepare(
      `SELECT config FROM workspace_policies 
       WHERE workspace_id = ? AND policy_type = 'storage_quota'`
    ).bind(workspaceId).first<{ config: string }>();

    if (!policy) return true; // No quota set

    const config = JSON.parse(policy.config) as { max_bytes: number };
    return (workspace.used_bytes + incomingBytes) <= config.max_bytes;
  }

  async checkRetentionProtection(folderId: string): Promise<boolean> {
    const policy = await this.db.prepare(
      `SELECT p.config 
       FROM workspace_policies p
       JOIN workspace_folders f ON f.workspace_id = p.workspace_id
       WHERE f.id = ? AND p.policy_type = 'data_retention'
         AND (p.target_type = 'workspace' OR (p.target_type = 'folder' AND p.target_id = ?))`
    ).bind(folderId, folderId).first<{ config: string }>();

    if (!policy) return false;

    const config = JSON.parse(policy.config) as { action: string, days?: number };
    return config.action === 'prevent_deletion';
  }

  async updateWorkspaceStorage(workspaceId: string, sizeDelta: number) {
    await this.db.prepare('UPDATE workspaces SET used_bytes = COALESCE(used_bytes, 0) + ? WHERE id = ?').bind(sizeDelta, workspaceId).run();
  }

  async processAutoDeleteRetentionPolicies(
    googleClientId: string,
    googleClientSecret: string,
    encryptionKey: string,
  ) {
    // 1. Get all auto_delete policies
    const { results: policies } = await this.db.prepare(
      `SELECT * FROM workspace_policies WHERE policy_type = 'data_retention' AND json_extract(config, '$.action') = 'auto_delete'`
    ).all<{ id: string, workspace_id: string, target_type: string, target_id: string | null, config: string }>();

    const driveService = new GoogleDriveService(this.db, googleClientId, googleClientSecret, encryptionKey);

    for (const policy of policies) {
      const config = JSON.parse(policy.config) as { action: string, days: number };
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - config.days);
      const cutoffStr = cutoffDate.toISOString();

      let query = '';
      let binds: any[] = [];

      if (policy.target_type === 'workspace') {
        query = `SELECT f.id, f.user_id, f.google_file_id, f.size, f.workspace_id, d.id as driveId 
                 FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id 
                 WHERE f.workspace_id = ? AND f.created_at < ?`;
        binds = [policy.workspace_id, cutoffStr];
      } else {
        query = `SELECT f.id, f.user_id, f.google_file_id, f.size, f.workspace_id, d.id as driveId 
                 FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id 
                 WHERE f.workspace_id = ? AND f.workspace_folder_id = ? AND f.created_at < ?`;
        binds = [policy.workspace_id, policy.target_id, cutoffStr];
      }

      const { results: expiredFiles } = await this.db.prepare(query).bind(...binds).all<{ id: string, user_id: string, google_file_id: string, size: number, workspace_id: string, driveId: string }>();

      for (const file of expiredFiles) {
        // Delete from Google Drive first (404 is OK — file may already be gone)
        try {
          await driveService.deleteFile(file.driveId, file.google_file_id);
        } catch (e) {
          console.error(`Retention: failed to delete file ${file.google_file_id} from Google Drive:`, e);
          // Continue anyway — still remove the DB row so quota is accurate
        }
        // Then remove from DB and update quota
        await this.db.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();
        await this.updateWorkspaceStorage(file.workspace_id, -file.size);
      }
    }
  }
}
