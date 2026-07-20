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

  // ─── Sync engine support ───

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
