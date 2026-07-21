import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';
import { batchInChunks } from '../lib/d1-batch';
import type { FileRow } from '../types';
import type { DriveAccount } from '../types';
import type { GDriveFile } from '../services/google-drive';

/**
 * Data access layer for the `files` table.
 *
 * All SQL for files lives here — routes and services never write inline SQL.
 * The repository also owns the UPSERT SQL used by the sync engine, so there
 * is exactly one source of truth for how files are inserted/upserted.
 */
export class FileRepository {
  constructor(private db: D1Database) {}

  // ─── Reads ───

  findById(fileId: string): Promise<FileRow | null> {
    return this.db.prepare('SELECT * FROM files WHERE id = ?')
      .bind(fileId).first<FileRow>();
  }

  /** Find recent files across user's own files + workspace files (via EXISTS). */
  findRecent(userId: string, limit = 20) {
    return this.db.prepare(`
      SELECT f.*, d.email as driveEmail
      FROM files f
      JOIN drive_accounts d ON f.drive_account_id = d.id
      WHERE f.is_trashed = 0
        AND (
          f.user_id = ?
          OR EXISTS (
            SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = f.workspace_id AND wm.user_id = ?
          )
        )
      ORDER BY COALESCE(f.google_modified_at, f.synced_at, f.updated_at) DESC
      LIMIT ?
    `).bind(userId, userId, limit).all();
  }

  /** Find files grouped by mime_type for category overview. */
  findCategoryOverview(userId: string) {
    return this.db.prepare(`
      SELECT mime_type, SUM(size) as total_size
      FROM files
      WHERE user_id = ? AND is_trashed = 0
      GROUP BY mime_type
    `).bind(userId).all<{ mime_type: string; total_size: number }>();
  }

  /** Search files with optional query, workspace filter, and metadata filter. */
  async searchFiles(
    userId: string,
    query: string | null,
    workspaceId: string | null,
    metadata: Record<string, string> | null,
    limit = 50,
  ) {
    let sql = `
      SELECT f.*, d.email as driveEmail
      FROM files f
      JOIN drive_accounts d ON f.drive_account_id = d.id
      WHERE f.is_trashed = 0
        AND (
          f.user_id = ?
          OR EXISTS (
            SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = f.workspace_id AND wm.user_id = ?
          )
        )
    `;
    const binds: (string | number)[] = [userId, userId];

    if (query?.trim()) {
      sql += ` AND f.name LIKE ?`;
      binds.push(`%${query.trim()}%`);
    }

    if (workspaceId) {
      sql += ` AND f.workspace_id = ?`;
      binds.push(workspaceId);
    }

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        if (!/^[a-zA-Z0-9_.]+$/.test(key)) continue; // ponytail: L11 — reject JSON-path injection
        sql += ` AND json_extract(f.metadata, '$.' || ?) = ?`;
        binds.push(key, String(value));
      }
    }

    sql += ` ORDER BY f.created_at DESC LIMIT ?`;
    binds.push(limit);

    const { results } = await this.db.prepare(sql).bind(...binds).all();
    return { results };
  }

  /** Find starred files for a user. */
  findStarred(userId: string) {
    return this.db.prepare(
      'SELECT f.*, d.email as driveEmail FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id WHERE f.user_id = ? AND f.is_starred = 1 AND f.is_trashed = 0 ORDER BY f.created_at DESC'
    ).bind(userId).all();
  }

  /** Find trashed files for a user. */
  findTrashed(userId: string) {
    return this.db.prepare(
      `SELECT f.*, d.email as driveEmail FROM files f
       JOIN drive_accounts d ON f.drive_account_id = d.id
       WHERE f.user_id = ? AND f.is_trashed = 1
       ORDER BY f.updated_at DESC`
    ).bind(userId).all();
  }

  /** Find a file with drive email + source drive ID for move-drive operation. */
  findForMoveDrive(fileId: string, userId: string) {
    return this.db.prepare(
      `SELECT f.*, d.email as driveEmail, d.id as sourceDriveId FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id WHERE f.id = ? AND f.user_id = ?`
    ).bind(fileId, userId).first();
  }

  /** Insert an uploaded file. Returns the created file row. */
  async insertUploaded(params: {
    id: string;
    userId: string;
    driveAccountId: string;
    workspaceId: string | null;
    workspaceFolderId: string | null;
    googleFileId: string;
    googleParentId: string | null;
    name: string;
    mimeType: string | null;
    size: number;
    thumbnailUrl: string | null;
    webViewLink: string | null;
    webContentLink: string | null;
    googleCreatedAt: string | null;
    googleModifiedAt: string | null;
  }): Promise<unknown> {
    await this.db.prepare(`
      INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, google_file_id, google_parent_id, name, mime_type, size, thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      params.id, params.userId, params.driveAccountId, params.workspaceId, params.workspaceFolderId,
      params.googleFileId, params.googleParentId, params.name, params.mimeType, params.size,
      params.thumbnailUrl, params.webViewLink, params.webContentLink,
      params.googleCreatedAt, params.googleModifiedAt,
    ).run();
    return this.db.prepare('SELECT * FROM files WHERE id = ?').bind(params.id).first();
  }

  // ─── Mutations ───

  markTrashed(fileId: string, userId: string) {
    return this.db.prepare('UPDATE files SET is_trashed = 1 WHERE id = ? AND user_id = ?')
      .bind(fileId, userId).run();
  }

  markUntrashed(fileId: string, userId: string) {
    return this.db.prepare('UPDATE files SET is_trashed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(fileId, userId).run();
  }

  rename(fileId: string, userId: string, name: string) {
    return this.db.prepare('UPDATE files SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(name, fileId, userId).run();
  }

  async star(fileId: string, userId: string): Promise<boolean> {
    const { meta } = await this.db.prepare('UPDATE files SET is_starred = 1 WHERE id = ? AND user_id = ?')
      .bind(fileId, userId).run();
    return meta.changes > 0;
  }

  async unstar(fileId: string, userId: string): Promise<boolean> {
    const { meta } = await this.db.prepare('UPDATE files SET is_starred = 0 WHERE id = ? AND user_id = ?')
      .bind(fileId, userId).run();
    return meta.changes > 0;
  }

  delete(fileId: string, userId: string) {
    return this.db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?')
      .bind(fileId, userId).run();
  }

  updateMetadata(fileId: string, metadata: string) {
    return this.db.prepare('UPDATE files SET metadata = ? WHERE id = ?')
      .bind(metadata, fileId).run();
  }

  moveToWorkspaceFolder(
    fileId: string, userId: string,
    workspaceFolderId: string | null, workspaceId: string | null,
  ) {
    return this.db.prepare(
      'UPDATE files SET workspace_folder_id = ?, workspace_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
    ).bind(workspaceFolderId, workspaceId, fileId, userId).run();
  }

  /**
   * Batch-assign multiple files to a workspace folder.
   * Used by POST /:id/files — preserves current behavior: membership only (no editor check).
   * Chunks in batches of 50 to stay within D1's variable limit.
   */
  async batchAssignToFolder(
    fileIds: string[],
    userId: string,
    workspaceId: string,
    workspaceFolderId: string | null,
  ): Promise<void> {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
      const chunk = fileIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      await this.db.prepare(
        `UPDATE files SET workspace_id = ?, workspace_folder_id = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`
      ).bind(workspaceId, workspaceFolderId, userId, ...chunk).run();
    }
  }

  /** Detach all files from a workspace (set workspace_id + workspace_folder_id to NULL). */
  detachFromWorkspace(workspaceId: string) {
    return this.db.prepare(
      'UPDATE files SET workspace_id = NULL, workspace_folder_id = NULL WHERE workspace_id = ?'
    ).bind(workspaceId).run();
  }

  /**
   * Find files in a workspace root (workspace_folder_id IS NULL), with cursor pagination.
   * Returns files with drive email via JOIN. Used by GET /:id? (workspace case).
   */
  async findFilesInWorkspaceRoot(workspaceId: string, cursor: { name: string; id: string } | null, limit: number) {
    let sql = `
      SELECT f.*, d.email as driveEmail
      FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id
      WHERE f.workspace_id = ? AND f.workspace_folder_id IS NULL AND f.is_trashed = 0
    `;
    const binds: (string | number)[] = [workspaceId];
    if (cursor && cursor.name !== undefined && cursor.id !== undefined) {
      sql += ` AND (f.name, f.id) > (?, ?)`;
      binds.push(cursor.name, cursor.id);
    }
    sql += ` ORDER BY f.name ASC, f.id ASC LIMIT ?`;
    binds.push(limit + 1);
    const { results } = await this.db.prepare(sql).bind(...binds).all();
    return { results };
  }

  /**
   * Find files in a workspace folder, with cursor pagination.
   * Returns files with drive email via JOIN. Used by GET /:id? (folder case).
   */
  async findFilesInFolder(folderId: string, cursor: { name: string; id: string } | null, limit: number) {
    let sql = `
      SELECT f.*, d.email as driveEmail
      FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id
      WHERE f.workspace_folder_id = ? AND f.is_trashed = 0
    `;
    const binds: (string | number)[] = [folderId];
    if (cursor && cursor.name !== undefined && cursor.id !== undefined) {
      sql += ` AND (f.name, f.id) > (?, ?)`;
      binds.push(cursor.name, cursor.id);
    }
    sql += ` ORDER BY f.name ASC, f.id ASC LIMIT ?`;
    binds.push(limit + 1);
    const { results } = await this.db.prepare(sql).bind(...binds).all();
    return { results };
  }

  // ─── Sync engine support ───

  /**
   * Find the first drive ID associated with files in a folder/workspace.
   * Used by GET /:id? and POST /:id/force-sync for drive lookup.
   */
  findDriveIdForFolder(folderId: string, userId: string) {
    return this.db.prepare(`
      SELECT DISTINCT d.id
      FROM files f
      JOIN drive_accounts d ON f.drive_account_id = d.id
      WHERE (f.workspace_folder_id = ? OR f.workspace_id = ?) AND f.user_id = ? LIMIT 1
    `).bind(folderId, folderId, userId).first<{ id: string }>();
  }

  /**
   * Update a file's drive assignment after a move-drive operation.
   * Sets the new drive_account_id, google_file_id, and resets parent to 'root'.
   */
  updateDriveAssignment(fileId: string, driveAccountId: string, googleFileId: string) {
    return this.db.prepare(
      `UPDATE files
       SET drive_account_id = ?, google_file_id = ?, google_parent_id = 'root', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(driveAccountId, googleFileId, fileId).run();
  }

  static readonly UPSERT_FILE_SQL = `INSERT INTO files
    (id, user_id, drive_account_id, google_file_id, google_parent_id, name, mime_type, size,
     thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at, synced_at, owned_by_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(drive_account_id, google_file_id) DO UPDATE SET
      name = excluded.name,
      mime_type = excluded.mime_type,
      size = excluded.size,
      thumbnail_url = excluded.thumbnail_url,
      web_view_link = excluded.web_view_link,
      web_content_link = excluded.web_content_link,
      google_modified_at = excluded.google_modified_at,
      google_parent_id = excluded.google_parent_id,
      synced_at = excluded.synced_at,
      owned_by_me = excluded.owned_by_me`;

  buildUpsertStmt(
    drive: DriveAccount,
    file: GDriveFile,
    googleParentId: string | null,
    ownedByMe: boolean,
  ): D1PreparedStatement {
    return this.db.prepare(FileRepository.UPSERT_FILE_SQL).bind(
      generateId(),
      drive.userId,
      drive.id,
      file.id,
      googleParentId,
      file.name,
      file.mimeType,
      parseInt(file.size ?? '0', 10),
      file.thumbnailLink ?? null,
      file.webViewLink ?? null,
      file.webContentLink ?? null,
      file.createdTime,
      file.modifiedTime,
      ownedByMe ? 1 : 0,
    );
  }

  async upsertMany(stmts: D1PreparedStatement[]): Promise<void> {
    await batchInChunks(this.db, stmts);
  }
}
