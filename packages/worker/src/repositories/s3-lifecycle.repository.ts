import type { D1Database } from '@cloudflare/workers-types';

/**
 * Repository for S3 lifecycle rule reads + orphan multipart-upload cleanup.
 * Owns all SQL for the s3-lifecycle cron service so the service stays pure
 * orchestration (Google Drive API calls + per-file updates via FileRepository).
 */
export class S3LifecycleRepository {
  constructor(private db: D1Database) {}

  /** All enabled lifecycle rules (expiration by days). */
  findEnabledRules() {
    return this.db
      .prepare(
        'SELECT id, workspace_id, prefix, expiration_days FROM s3_lifecycle_rules WHERE enabled = 1',
      )
      .all<{ id: string; workspace_id: string; prefix: string; expiration_days: number }>();
  }

  /**
   * Files expired under a lifecycle rule (matching prefix + age, not trashed).
   * Uses the same recursive folder_path CTE as routes/s3.ts ListObjectsV2 so
   * S3 key prefixes align with workspace folder paths.
   */
  findExpiredFiles(workspaceId: string, escapedPrefix: string, expirationDays: number) {
    const modifier = `-${expirationDays} days`;
    return this.db
      .prepare(
        `
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
        AND COALESCE(fp.path, '') || f.name LIKE ? ESCAPE '^'
        AND f.updated_at <= datetime('now', ?)
    `,
      )
      .bind(workspaceId, workspaceId, workspaceId, escapedPrefix, modifier)
      .all<{ id: string; drive_account_id: string; google_file_id: string }>();
  }

  /** Orphan multipart uploads older than 24h (never Completed or Aborted). */
  findOrphanUploads() {
    return this.db
      .prepare(
        "SELECT upload_id, drive_account_id, temp_folder_id FROM s3_multipart_uploads WHERE created_at < datetime('now','-1 day')",
      )
      .all<{ upload_id: string; drive_account_id: string; temp_folder_id: string }>();
  }

  /** Delete an s3_multipart_uploads row (parts cascade via ON DELETE CASCADE). */
  deleteUpload(uploadId: string) {
    return this.db
      .prepare('DELETE FROM s3_multipart_uploads WHERE upload_id = ?')
      .bind(uploadId)
      .run();
  }
}
