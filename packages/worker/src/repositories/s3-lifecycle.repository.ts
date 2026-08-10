import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { S3LifecycleRuleRow } from '../types/db';

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
      SELECT f.id, f.drive_account_id, f.google_file_id, f.user_id, f.mime_type, f.size, f.owned_by_me
      FROM files f
      LEFT JOIN folder_path fp ON f.workspace_folder_id = fp.id
      WHERE f.workspace_id = ? AND f.is_trashed = 0 AND f.owned_by_me = 1
        AND COALESCE(fp.path, '') || f.name LIKE ? ESCAPE '^'
        AND f.created_at <= datetime('now', ?)
    `,
      )
      .bind(workspaceId, workspaceId, workspaceId, escapedPrefix, modifier)
      .all<{
        id: string;
        drive_account_id: string;
        google_file_id: string;
        user_id: string;
        mime_type: string | null;
        size: number;
        owned_by_me: number;
      }>();
  }

  /** Orphan multipart uploads older than 24h (never Completed or Aborted). */
  findOrphanUploads() {
    return this.db
      .prepare(
        "SELECT upload_id, drive_account_id, temp_folder_id FROM s3_multipart_uploads WHERE created_at < datetime('now','-1 day')",
      )
      .all<{ upload_id: string; drive_account_id: string; temp_folder_id: string }>();
  }

  /**
   * Atomically delete an upload session and its parts. Production D1 enforces
   * FK + ON DELETE CASCADE by default (developers.cloudflare.com/d1/sql-api/foreign-keys),
   * so the batch is redundant in production but defensive: it ensures correct
   * behavior on runtimes that don't enforce FK (better-sqlite3-based runtimes —
   * unit tests and the node-server Docker deployment — do not enable
   * PRAGMA foreign_keys) and survives any schema change that drops the FK.
   */
  async deleteUpload(uploadId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM s3_multipart_parts WHERE upload_id = ?').bind(uploadId),
      this.db.prepare('DELETE FROM s3_multipart_uploads WHERE upload_id = ?').bind(uploadId),
    ]);
  }

  // ─── S3 Lifecycle Rule CRUD (used by S3 protocol route) ───

  /** Find all lifecycle rules for a workspace. */
  findRules(workspaceId: string) {
    return this.db
      .prepare(
        'SELECT prefix, expiration_days, enabled FROM s3_lifecycle_rules WHERE workspace_id = ?',
      )
      .bind(workspaceId)
      .all<S3LifecycleRuleRow>();
  }

  /** Delete all lifecycle rules for a workspace (before replacing). */
  deleteRules(workspaceId: string) {
    return this.db
      .prepare('DELETE FROM s3_lifecycle_rules WHERE workspace_id = ?')
      .bind(workspaceId)
      .run();
  }

  /** Prepared statement: Delete all lifecycle rules for a workspace (for atomic batch). */
  deleteRulesStmt(workspaceId: string): D1PreparedStatement {
    return this.db
      .prepare('DELETE FROM s3_lifecycle_rules WHERE workspace_id = ?')
      .bind(workspaceId);
  }

  /** Prepared statement: Insert or replace a single lifecycle rule (for atomic batch). */
  replaceRuleStmt(
    id: string,
    workspaceId: string,
    prefix: string,
    expirationDays: number,
    enabled: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        'INSERT OR REPLACE INTO s3_lifecycle_rules (id, workspace_id, prefix, expiration_days, enabled) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, workspaceId, prefix, expirationDays, enabled);
  }
}
