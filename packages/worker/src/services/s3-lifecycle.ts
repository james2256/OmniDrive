import type { Env } from '../types/env';
import { createDriveService } from '../lib/drive-factory';
import { logErrorNoCtx } from '../lib/logger';
import { S3LifecycleRepository } from '../repositories/s3-lifecycle.repository';
import { FileRepository } from '../repositories/file.repository';

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
    <Filter><Prefix>${r.prefix}</Prefix></Filter>
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
  const s3LifecycleRepo = new S3LifecycleRepository(env.DB);
  const fileRepo = new FileRepository(env.DB);

  const { results: rules } = await s3LifecycleRepo.findEnabledRules();

  if (!rules?.length) return;

  const driveService = createDriveService(env);

  for (const rule of rules) {
    // Escape LIKE wildcards in the prefix (matches s3.ts ListObjectsV2 pattern).
    const escapedPrefix = rule.prefix.replace(/[%_^]/g, (ch) => '^' + ch) + '%';
    const { results: expired } = await s3LifecycleRepo.findExpiredFiles(
      rule.workspace_id,
      escapedPrefix,
      rule.expiration_days,
    );

    for (const file of expired ?? []) {
      try {
        await driveService.trashFile(file.drive_account_id, file.google_file_id);
        await fileRepo.markTrashedSystem(file.id);
        // Update per-MIME storage stats (mirrors sync.ts and file.service.ts trashFile).
        await fileRepo.applyStorageDeltas([
          { userId: file.user_id, mimeType: file.mime_type ?? '', delta: -file.size },
        ]);
      } catch (e) {
        // Best-effort: skip this file, keep processing the rest.
        logErrorNoCtx('Lifecycle expire failed for file', e, { fileId: file.id });
      }
    }
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
  const s3LifecycleRepo = new S3LifecycleRepository(env.DB);

  const { results: orphans } = await s3LifecycleRepo.findOrphanUploads();

  if (!orphans?.length) return;

  const driveService = createDriveService(env);

  for (const upload of orphans) {
    try {
      await driveService.deleteFile(upload.drive_account_id, upload.temp_folder_id);
    } catch (err) {
      // Best-effort: the temp folder may already be gone; still drop the DB row.
      logErrorNoCtx('Failed to delete orphan multipart temp folder from Google Drive', err);
    }
    await s3LifecycleRepo.deleteUpload(upload.upload_id);
  }
}
