import type { Env } from '../types/env';
import { GoogleDriveService } from './google-drive';

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
  </Rule>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration>
${rulesXml}
</LifecycleConfiguration>`;
}

/**
 * Cron: move objects older than their rule's expiration window to Google Drive
 * trash (Option A — recoverable ~30 days, NOT a permanent delete).
 * Files already trashed are skipped via is_trashed = 0.
 */
export async function runLifecycleExpiration(env: Env): Promise<void> {
  const { results: rules } = await env.DB.prepare(
    'SELECT id, workspace_id, prefix, expiration_days FROM s3_lifecycle_rules WHERE enabled = 1'
  ).all<{ id: string; workspace_id: string; prefix: string; expiration_days: number }>();

  if (!rules?.length) return;

  const driveService = new GoogleDriveService(
    env.DB,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.TOKEN_ENCRYPTION_KEY
  );

  for (const rule of rules) {
    // Reuse the ListObjects CTE to build S3 keys, then filter by prefix + age.
    const modifier = `-${rule.expiration_days} days`;
    const { results: expired } = await env.DB.prepare(`
      WITH RECURSIVE folder_path(id, path) AS (
          SELECT id, name || '/' FROM workspace_folders WHERE parent_id IS NULL AND workspace_id = ?
          UNION ALL
          SELECT f.id, fp.path || f.name || '/'
          FROM workspace_folders f
          JOIN folder_path fp ON f.parent_id = fp.id
          WHERE f.workspace_id = ?
      )
      SELECT f.id, f.drive_account_id, f.google_file_id
      FROM files f
      LEFT JOIN folder_path fp ON f.workspace_folder_id = fp.id
      WHERE f.workspace_id = ? AND f.is_trashed = 0
        AND COALESCE(fp.path, '') || f.name LIKE ?
        AND f.updated_at <= datetime('now', ?)
    `).bind(rule.workspace_id, rule.workspace_id, rule.workspace_id, rule.prefix + '%', modifier)
      .all<{ id: string; drive_account_id: string; google_file_id: string }>();

    for (const file of expired ?? []) {
      try {
        await driveService.trashFile(file.drive_account_id, file.google_file_id);
        await env.DB.prepare('UPDATE files SET is_trashed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(file.id).run();
      } catch (e) {
        // Best-effort: skip this file, keep processing the rest.
        console.error(`Lifecycle expire failed for file ${file.id}`, e);
      }
    }
  }
}

/**
 * Cron: reap orphan S3 multipart uploads that were never Completed or Aborted.
 * These leave a temp Google Drive folder + an s3_multipart_uploads row (and its
 * parts) behind forever. We delete the temp folder best-effort, then remove the
 * upload row; s3_multipart_parts rows cascade via ON DELETE CASCADE.
 * created_at is a TEXT datetime string, so age is filtered in SQL with
 * datetime('now','-1 day') — never epoch ms.
 * ponytail: 24h threshold hardcoded — the ceiling is that a legitimate upload
 * spanning >24h gets reaped; make it configurable if long-running uploads appear.
 */
export async function cleanupOrphanMultipartUploads(env: Env): Promise<void> {
  const { results: orphans } = await env.DB.prepare(
    "SELECT upload_id, drive_account_id, temp_folder_id FROM s3_multipart_uploads WHERE created_at < datetime('now','-1 day')"
  ).all<{ upload_id: string; drive_account_id: string; temp_folder_id: string }>();

  if (!orphans?.length) return;

  const driveService = new GoogleDriveService(
    env.DB,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.TOKEN_ENCRYPTION_KEY
  );

  for (const upload of orphans) {
    try {
      await driveService.deleteFile(upload.drive_account_id, upload.temp_folder_id);
    } catch (err) {
      // Best-effort: the temp folder may already be gone; still drop the DB row.
      console.error('Failed to delete orphan multipart temp folder from Google Drive:', err);
    }
    await env.DB.prepare('DELETE FROM s3_multipart_uploads WHERE upload_id = ?')
      .bind(upload.upload_id).run();
  }
}
