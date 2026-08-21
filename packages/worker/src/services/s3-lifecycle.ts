import type { Env } from '../types/env';
import { createDriveService } from '../lib/drive-factory';
import { logErrorNoCtx } from '../lib/logger';
import { S3LifecycleRepository } from '../repositories/s3-lifecycle.repository';
import { S3MultipartRepository } from '../repositories/s3-multipart.repository';
import { FileRepository } from '../repositories/file.repository';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import { escapeXml } from '../lib/s3-xml';

export interface LifecycleRule {
  prefix: string;
  days: number;
  enabled: boolean;
}

/**
 * Parse an S3 PutBucketLifecycleConfiguration XML body.
 * ponytail: regex parse (no XML dep, matches this codebase's approach).
 * Only Expiration-by-Days rules are supported; rules without <Days> are ignored.
 */
export function parseLifecycleXml(xml: string): LifecycleRule[] {
  const rules: LifecycleRule[] = [];
  for (const m of xml.matchAll(/<Rule>([\s\S]*?)<\/Rule>/g)) {
    const block = m[1];
    const daysStr = block.match(/<Days>\s*(\d+)\s*<\/Days>/)?.[1];
    if (!daysStr) continue;
    const days = parseInt(daysStr, 10);
    if (!Number.isFinite(days) || days < 1) continue;
    const prefix = (block.match(/<Prefix>([\s\S]*?)<\/Prefix>/)?.[1] ?? '').trim();
    const status = (block.match(/<Status>([\s\S]*?)<\/Status>/)?.[1] ?? 'Enabled').trim();
    rules.push({ prefix, days, enabled: status !== 'Disabled' });
  }
  return rules;
}

export function serializeLifecycleXml(rules: LifecycleRule[]): string {
  const rulesXml = rules
    .map(
      (r, i) => `  <Rule>
    <ID>rule-${i}</ID>
    <Filter><Prefix>${escapeXml(r.prefix)}</Prefix></Filter>
    <Status>${r.enabled ? 'Enabled' : 'Disabled'}</Status>
    <Expiration><Days>${r.days}</Days></Expiration>
  </Rule>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
${rulesXml}
</LifecycleConfiguration>`;
}

/**
 * Cron: move objects older than their rule's expiration window to Google Drive
 * trash (Option A — recoverable ~30 days, NOT a permanent delete).
 * Files already trashed are skipped via is_trashed = 0.
 */
export async function runLifecycleExpiration(env: Env): Promise<void> {
  const MAX_LIFECYCLE_EXPIRES_PER_CYCLE = 15;
  const s3LifecycleRepo = new S3LifecycleRepository(env.DB);
  const fileRepo = new FileRepository(env.DB);
  const workspaceRepo = new WorkspaceRepository(env.DB);

  const { results: rules } = await s3LifecycleRepo.findEnabledRules();

  if (!rules?.length) return;

  const driveService = createDriveService(env);

  let expiredCount = 0;
  for (const rule of rules) {
    // Escape LIKE wildcards in the prefix (matches s3.ts ListObjectsV2 pattern).
    const escapedPrefix = rule.prefix.replace(/[%_^]/g, (ch) => '^' + ch) + '%';
    const { results: expired } = await s3LifecycleRepo.findExpiredFiles(
      rule.workspace_id,
      escapedPrefix,
      rule.expiration_days,
    );

    for (const file of expired ?? []) {
      if (expiredCount >= MAX_LIFECYCLE_EXPIRES_PER_CYCLE) break;
      try {
        await driveService.trashFile(file.drive_account_id, file.google_file_id);
        // Conditional mark-trashed — prevents concurrent cycles from double-applying.
        const markResult = await env.DB.batch([fileRepo.markTrashedSystemIfActiveStmt(file.id)]);
        expiredCount++; // Outside changes > 0 — counts iterations, protects subrequest budget
        // Only apply deltas if the UPDATE actually changed a row.
        if (markResult[0]?.meta?.changes > 0 && file.owned_by_me === 1) {
          try {
            await env.DB.batch([
              fileRepo.applyStorageDeltaStmt(file.user_id, file.mime_type ?? '', -file.size),
              workspaceRepo.updateUsedBytesStmt(rule.workspace_id, -file.size),
            ]);
          } catch (e) {
            logErrorNoCtx('Lifecycle: mark-trashed succeeded but quota delta failed', e, {
              fileId: file.id,
              workspaceId: rule.workspace_id,
            });
          }
        }
      } catch (e) {
        // Best-effort: skip this file, keep processing the rest.
        logErrorNoCtx('Lifecycle expire failed for file', e, { fileId: file.id });
      }
    }
    if (expiredCount >= MAX_LIFECYCLE_EXPIRES_PER_CYCLE) break;
  }
}

/**
 * Cron: reap orphan S3 multipart uploads that were never Completed or Aborted.
 * These leave a temp Google Drive folder + an s3_multipart_uploads row (and its
 * parts) behind forever. We delete the temp folder best-effort, then remove the
 * upload row; s3_multipart_parts rows are deleted explicitly via deleteUpload's
 * batch (manual cascade — see S3LifecycleRepository.deleteUpload).
 * created_at is a TEXT datetime string, so age is filtered in SQL with
 * datetime('now','-1 day') — never epoch ms.
 * ponytail: 24h threshold hardcoded — the ceiling is that a legitimate upload
 * spanning >24h gets reaped; make it configurable if long-running uploads appear.
 */
export async function cleanupOrphanMultipartUploads(env: Env): Promise<void> {
  const MAX_ORPHAN_CLEANUPS_PER_CYCLE = 5;
  const s3LifecycleRepo = new S3LifecycleRepository(env.DB);

  const { results: orphans } = await s3LifecycleRepo.findOrphanUploads();

  if (!orphans?.length) return;

  let orphanCount = 0;
  for (const upload of orphans) {
    if (orphanCount >= MAX_ORPHAN_CLEANUPS_PER_CYCLE) break;
    const allDeleted = await deleteMultipartUploadParts(env, upload);
    if (allDeleted) {
      await s3LifecycleRepo.deleteUpload(upload.upload_id);
      orphanCount++;
    } else {
      // Keep D1 row — next cleanup cycle will retry the failed parts.
      logErrorNoCtx('Multipart cleanup: keeping D1 row (some parts failed to delete)', undefined, {
        uploadId: upload.upload_id,
      });
    }
  }
}

/**
 * Delete all individual multipart part files from Google Drive, then delete
 * the temp folder. Per Google Drive API, deleting a folder does NOT delete
 * its children — so we must iterate s3_multipart_parts and delete each
 * part's google_file_id individually before deleting the temp folder.
 *
 * Returns true if ALL parts + temp folder were deleted successfully.
 * Returns false if any deletion failed — the caller should keep the D1 row
 * so the next cleanup cycle can retry.
 *
 * Used by CompleteMultipartUpload, AbortMultipartUpload, and orphan cleanup.
 * AbortMultipartUpload and CompleteMultipartUpload ignore the return value
 * (they unconditionally delete the D1 row — the upload is over regardless).
 */
export async function deleteMultipartUploadParts(
  env: Env,
  upload: { drive_account_id: string; temp_folder_id: string; upload_id: string },
): Promise<boolean> {
  const driveService = createDriveService(env);
  const multipartRepo = new S3MultipartRepository(env.DB);

  // Delete each part file individually
  const { results: parts } = await multipartRepo.findPartsByUpload(upload.upload_id);
  let allDeleted = true;

  for (const part of parts) {
    try {
      await driveService.deleteFile(upload.drive_account_id, part.google_file_id);
    } catch (err) {
      logErrorNoCtx('Failed to delete multipart part file', err, {
        googleFileId: part.google_file_id,
      });
      allDeleted = false;
    }
  }

  // Only delete the temp folder if all parts were deleted — otherwise keep
  // the D1 row so the next cleanup cycle can retry.
  if (allDeleted) {
    try {
      await driveService.deleteFile(upload.drive_account_id, upload.temp_folder_id);
    } catch (err) {
      logErrorNoCtx('Failed to delete multipart temp folder', err, {
        tempFolderId: upload.temp_folder_id,
      });
      allDeleted = false;
    }
  }

  return allDeleted;
}
