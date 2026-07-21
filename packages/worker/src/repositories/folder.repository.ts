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

  /** Find a folder by ID + user membership, with workspace name. */
  findByIdWithWorkspace(folderId: string, userId: string) {
    return this.db.prepare(
      `SELECT f.*, w.name as ws_name FROM workspace_folders f
       JOIN workspaces w ON f.workspace_id = w.id
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE f.id = ?`
    ).bind(userId, folderId).first();
  }

  /** Find root folders in a workspace (parent_id IS NULL). */
  findRootFoldersByWorkspace(workspaceId: string) {
    return this.db.prepare(
      'SELECT * FROM workspace_folders WHERE workspace_id = ? AND parent_id IS NULL ORDER BY name ASC'
    ).bind(workspaceId).all();
  }

  /** Find subfolders of a specific parent folder. */
  findSubfoldersByParent(parentId: string) {
    return this.db.prepare(
      'SELECT * FROM workspace_folders WHERE parent_id = ? ORDER BY name ASC'
    ).bind(parentId).all();
  }

  /** Find all folders a user has access to (via workspace membership). */
  findAllByUser(userId: string) {
    return this.db.prepare(
      `SELECT f.* FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id
       WHERE wm.user_id = ? ORDER BY f.name ASC`
    ).bind(userId).all();
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

  /** Update sync status (syncing / idle / error). */
  updateSyncStatus(folderId: string, status: 'syncing' | 'idle' | 'error') {
    return this.db.prepare('UPDATE workspace_folders SET sync_status = ? WHERE id = ?')
      .bind(status, folderId).run();
  }

  /** Mark sync complete (idle + last_synced_at). */
  updateSyncComplete(folderId: string) {
    return this.db.prepare(
      "UPDATE workspace_folders SET sync_status = 'idle', last_synced_at = datetime('now') WHERE id = ?"
    ).bind(folderId).run();
  }

  /** Insert a new workspace folder. */
  insert(params: {
    id: string;
    workspaceId: string;
    name: string;
    parentId: string | null;
    icon: string;
    color: string;
  }) {
    return this.db.prepare(
      'INSERT INTO workspace_folders (id, workspace_id, name, parent_id, icon, color) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(params.id, params.workspaceId, params.name, params.parentId, params.icon, params.color).run();
  }

  /** Update folder fields (name, icon, color, parent_id). */
  updateFields(folderId: string, fields: {
    name?: string;
    icon?: string;
    color?: string;
    parentId?: string | null;
  }) {
    const updateFields: string[] = [];
    const params: (string | null)[] = [];
    if (fields.name !== undefined) { updateFields.push('name = ?'); params.push(fields.name); }
    if (fields.icon !== undefined) { updateFields.push('icon = ?'); params.push(fields.icon); }
    if (fields.color !== undefined) { updateFields.push('color = ?'); params.push(fields.color); }
    if (fields.parentId !== undefined) { updateFields.push('parent_id = ?'); params.push(fields.parentId ?? null); }
    if (updateFields.length === 0) return Promise.resolve();
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(folderId);
    return this.db.prepare(`UPDATE workspace_folders SET ${updateFields.join(', ')} WHERE id = ?`)
      .bind(...params).run();
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
