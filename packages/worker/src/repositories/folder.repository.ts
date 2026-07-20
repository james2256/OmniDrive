import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';
import { batchInChunks } from '../lib/d1-batch';
import type { DriveAccount } from '../types';
import type { GDriveFolder } from '../services/google-drive';

/**
 * Data access layer for the `workspace_folders` and `drive_folders` tables.
 *
 * All SQL for workspace folders lives here. The repository also owns the
 * UPSERT SQL for `drive_folders` used by the sync engine.
 */
export class FolderRepository {
  constructor(private db: D1Database) {}

  // ─── workspace_folders reads ───

  /** Find the workspace_id for a folder, checking membership. */
  findParentWorkspace(parentId: string, userId: string) {
    return this.db.prepare(
      `SELECT f.workspace_id FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE f.id = ?`
    ).bind(userId, parentId).first<{ workspace_id: string }>();
  }

  /** Check membership (used by star/unstar/delete — RBAC is checked by the service). */
  findMembership(folderId: string, userId: string) {
    return this.db.prepare(
      `SELECT f.id, f.workspace_id FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE f.id = ?`
    ).bind(userId, folderId).first<{ id: string; workspace_id: string }>();
  }

  // ─── workspace_folders mutations ───

  star(folderId: string) {
    return this.db.prepare('UPDATE workspace_folders SET is_starred = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(folderId).run();
  }

  unstar(folderId: string) {
    return this.db.prepare('UPDATE workspace_folders SET is_starred = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(folderId).run();
  }

  delete(folderId: string) {
    return this.db.prepare('DELETE FROM workspace_folders WHERE id = ?')
      .bind(folderId).run();
  }

  // ─── drive_folders UPSERT (sync engine) ───

  static readonly UPSERT_FOLDER_SQL = `INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, is_synced, owned_by_me)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(drive_account_id, google_folder_id) DO UPDATE SET
      name = excluded.name,
      google_parent_id = excluded.google_parent_id,
      owned_by_me = excluded.owned_by_me`;

  buildDriveFolderUpsertStmt(
    drive: DriveAccount,
    folder: GDriveFolder,
    googleParentId: string | null,
    ownedByMe: boolean,
  ): D1PreparedStatement {
    return this.db.prepare(FolderRepository.UPSERT_FOLDER_SQL)
      .bind(generateId(), drive.id, folder.id, googleParentId, folder.name, ownedByMe ? 1 : 0);
  }

  async upsertMany(stmts: D1PreparedStatement[]): Promise<void> {
    await batchInChunks(this.db, stmts);
  }
}
