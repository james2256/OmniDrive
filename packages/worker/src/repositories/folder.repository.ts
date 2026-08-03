import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';
import { batchInChunks } from '../lib/d1-batch';
import type { DriveAccount } from '../types/domain';
import type { GDriveFolder } from '../types/google';
import type { WorkspaceFolderRow, FileRow } from '../types/db';

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
    return this.db
      .prepare(
        `SELECT f.workspace_id FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE f.id = ?`,
      )
      .bind(userId, parentId)
      .first<{ workspace_id: string }>();
  }

  /** Check membership (used by star/unstar/delete — RBAC is checked by the service). */
  findMembership(folderId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT f.id, f.workspace_id FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE f.id = ?`,
      )
      .bind(userId, folderId)
      .first<{ id: string; workspace_id: string }>();
  }

  /** Search workspace folders by name (for global search). */
  searchFolders(userId: string, query: string, limit = 20) {
    return this.db
      .prepare(
        `SELECT f.*, w.name as workspaceName FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE f.name LIKE ?
       ORDER BY f.updated_at DESC LIMIT ?`,
      )
      .bind(userId, `%${query}%`, limit)
      .all<Record<string, unknown>>();
  }

  /** Find a folder by ID + user membership, with workspace name. */
  findByIdWithWorkspace(folderId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT f.*, w.name as ws_name FROM workspace_folders f
       JOIN workspaces w ON f.workspace_id = w.id
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE f.id = ?`,
      )
      .bind(userId, folderId)
      .first<Record<string, unknown>>();
  }

  /** Find root folders in a workspace (parent_id IS NULL). */
  findRootFoldersByWorkspace(workspaceId: string) {
    return this.db
      .prepare(
        'SELECT * FROM workspace_folders WHERE workspace_id = ? AND parent_id IS NULL ORDER BY name ASC',
      )
      .bind(workspaceId)
      .all<WorkspaceFolderRow>();
  }

  /** Find subfolders of a specific parent folder. */
  findSubfoldersByParent(parentId: string) {
    return this.db
      .prepare('SELECT * FROM workspace_folders WHERE parent_id = ? ORDER BY name ASC')
      .bind(parentId)
      .all<WorkspaceFolderRow>();
  }

  /** Find all folders a user has access to (via workspace membership). */
  findAllByUser(userId: string) {
    return this.db
      .prepare(
        `SELECT f.* FROM workspace_folders f
       JOIN workspace_members wm ON f.workspace_id = wm.workspace_id
       WHERE wm.user_id = ? ORDER BY f.name ASC`,
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  // ─── workspace_folders mutations ───

  star(folderId: string) {
    return this.db
      .prepare(
        'UPDATE workspace_folders SET is_starred = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(folderId)
      .run();
  }

  unstar(folderId: string) {
    return this.db
      .prepare(
        'UPDATE workspace_folders SET is_starred = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(folderId)
      .run();
  }

  /**
   * Delete a workspace folder with manual cascade. D1 FKs are OFF, so
   * ON DELETE CASCADE / SET NULL are documentation-only.
   *
   * Cascade order (children before parents):
   * 1. Recursively delete subfolders (self-FK parent_id, arbitrary depth via CTE)
   * 2. Delete folder-scoped policies (workspace_policies.target_id)
   * 3. Detach files (ON DELETE SET NULL intent → UPDATE to NULL)
   * 4. Delete the folder row itself
   *
   * The recursive CTE is repeated in 3 statements because db.batch() cannot
   * share variables across prepared statements. This keeps the cascade atomic
   * (single round-trip) at the cost of repeated SQL — the right tradeoff.
   */
  async delete(folderId: string) {
    await this.db.batch([
      // 1. Recursively delete all descendant subfolders (arbitrary depth).
      this.db
        .prepare(
          `DELETE FROM workspace_folders WHERE id IN (
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM workspace_folders WHERE parent_id = ?
            UNION ALL
            SELECT wf.id FROM workspace_folders wf JOIN descendants d ON wf.parent_id = d.id
          )
          SELECT id FROM descendants
        )`,
        )
        .bind(folderId),
      // 2. Delete folder-scoped policies pointing at this folder or its descendants.
      this.db
        .prepare(
          `DELETE FROM workspace_policies WHERE target_type = 'folder' AND target_id IN (
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM workspace_folders WHERE id = ?
            UNION ALL
            SELECT wf.id FROM workspace_folders wf JOIN descendants d ON wf.parent_id = d.id
          )
          SELECT id FROM descendants
        )`,
        )
        .bind(folderId),
      // 3. Detach files from this folder and all descendants (ON DELETE SET NULL intent).
      this.db
        .prepare(
          `UPDATE files SET workspace_folder_id = NULL WHERE workspace_folder_id IN (
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM workspace_folders WHERE id = ?
            UNION ALL
            SELECT wf.id FROM workspace_folders wf JOIN descendants d ON wf.parent_id = d.id
          )
          SELECT id FROM descendants
        )`,
        )
        .bind(folderId),
      // 4. Delete the folder itself.
      this.db.prepare('DELETE FROM workspace_folders WHERE id = ?').bind(folderId),
    ]);
  }

  /** Update sync status (syncing / idle / error). */
  updateSyncStatus(folderId: string, status: 'syncing' | 'idle' | 'error') {
    return this.db
      .prepare('UPDATE workspace_folders SET sync_status = ? WHERE id = ?')
      .bind(status, folderId)
      .run();
  }

  /** Mark sync complete (idle + last_synced_at). */
  updateSyncComplete(folderId: string) {
    return this.db
      .prepare(
        "UPDATE workspace_folders SET sync_status = 'idle', last_synced_at = datetime('now') WHERE id = ?",
      )
      .bind(folderId)
      .run();
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
    return this.db
      .prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id, icon, color) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(params.id, params.workspaceId, params.name, params.parentId, params.icon, params.color)
      .run();
  }

  /** Update folder fields (name, icon, color, parent_id, workspace_id). */
  updateFields(
    folderId: string,
    fields: {
      name?: string;
      icon?: string;
      color?: string;
      parentId?: string | null;
      workspaceId?: string;
    },
  ) {
    const updateFields: string[] = [];
    const params: (string | null)[] = [];
    if (fields.name !== undefined) {
      updateFields.push('name = ?');
      params.push(fields.name);
    }
    if (fields.icon !== undefined) {
      updateFields.push('icon = ?');
      params.push(fields.icon);
    }
    if (fields.color !== undefined) {
      updateFields.push('color = ?');
      params.push(fields.color);
    }
    if (fields.parentId !== undefined) {
      updateFields.push('parent_id = ?');
      params.push(fields.parentId ?? null);
    }
    if (fields.workspaceId !== undefined) {
      updateFields.push('workspace_id = ?');
      params.push(fields.workspaceId);
    }
    if (updateFields.length === 0) return Promise.resolve();
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(folderId);
    return this.db
      .prepare(`UPDATE workspace_folders SET ${updateFields.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  /**
   * Update a workspace folder's `metadata` JSON column, scoped by id + workspace.
   * The `workspace_id` scope is a defense-in-depth guard: even if a caller
   * passes a folder id from another workspace, the UPDATE is a no-op.
   */
  updateMetadata(folderId: string, workspaceId: string, metadata: Record<string, unknown>) {
    return this.db
      .prepare('UPDATE workspace_folders SET metadata = ? WHERE id = ? AND workspace_id = ?')
      .bind(JSON.stringify(metadata), folderId, workspaceId)
      .run();
  }

  /**
   * Find recent workspace folders for the dashboard — the folders a user can
   * access (via workspace membership), most-recently-updated first, capped at 20.
   * LEFT JOINs `workspaces` for the workspace name (`ws_name`). Mirrors the
   * `findRecent` shape on FileRepository (folders + ws_name).
   */
  findRecentFolders(userId: string, limit = 20) {
    return this.db
      .prepare(
        `
      SELECT f.*, w.name as ws_name
      FROM workspace_folders f
      JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?
      LEFT JOIN workspaces w ON f.workspace_id = w.id
      ORDER BY f.updated_at DESC
      LIMIT ?
    `,
      )
      .bind(userId, limit)
      .all<Record<string, unknown>>();
  }

  /**
   * Find starred workspace folders for a user, with the workspace name JOIN.
   * Mirrors `findStarred` on FileRepository (folders + ws_name).
   */
  findStarredFolders(userId: string) {
    return this.db
      .prepare(
        'SELECT f.*, w.name as ws_name FROM workspace_folders f JOIN workspace_members wm ON f.workspace_id = wm.workspace_id JOIN workspaces w ON f.workspace_id = w.id WHERE wm.user_id = ? AND f.is_starred = 1 ORDER BY f.updated_at DESC',
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  // ─── drive_folders UPSERT (sync engine) ───

  static readonly UPSERT_FOLDER_SQL = `INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, is_synced, owned_by_me)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(drive_account_id, google_folder_id) DO UPDATE SET
      name = excluded.name,
      google_parent_id = excluded.google_parent_id,
      owned_by_me = excluded.owned_by_me,
      is_trashed = 0
    WHERE excluded.name IS NOT drive_folders.name
       OR excluded.google_parent_id IS NOT drive_folders.google_parent_id
       OR excluded.owned_by_me IS NOT drive_folders.owned_by_me
       OR drive_folders.is_trashed = 1`;

  buildDriveFolderUpsertStmt(
    drive: DriveAccount,
    folder: GDriveFolder,
    googleParentId: string | null,
    ownedByMe: boolean,
  ): D1PreparedStatement {
    return this.db
      .prepare(FolderRepository.UPSERT_FOLDER_SQL)
      .bind(generateId(), drive.id, folder.id, googleParentId, folder.name, ownedByMe ? 1 : 0);
  }

  async upsertMany(stmts: D1PreparedStatement[]): Promise<void> {
    await batchInChunks(this.db, stmts);
  }

  // ─── S3 protocol support ───

  /**
   * Find a workspace folder by workspace + name + parent (S3 key path resolution).
   * Returns { id } or null. Used by getOrCreateWorkspaceFolder.
   */
  findFolderByPath(workspaceId: string, name: string, parentId: string | null) {
    return this.db
      .prepare(
        `SELECT id FROM workspace_folders 
         WHERE workspace_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))`,
      )
      .bind(workspaceId, name, parentId, parentId)
      .first<{ id: string }>();
  }

  /** Insert a workspace folder (S3 key path creation). */
  insertFolder(id: string, workspaceId: string, name: string, parentId: string | null) {
    return this.db
      .prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
      .bind(id, workspaceId, name, parentId)
      .run();
  }

  /**
   * List files as flat S3 keys using a recursive CTE. Used by S3 ListObjectsV2.
   * The caller provides the escaped prefix and optional cursor; the repo owns
   * the SQL (including the dynamic cursor clause construction).
   */
  listFilesAsS3Keys(
    workspaceId: string,
    escapedPrefix: string,
    cursor: { key: string; id: string } | null,
    maxKeys: number,
  ) {
    const cursorClause = cursor ? " AND (COALESCE(fp.path, '') || f.name, f.id) > (?, ?)" : '';
    const binds: (string | number)[] = [workspaceId, workspaceId, workspaceId, escapedPrefix];
    if (cursor) binds.push(cursor.key, cursor.id);
    binds.push(maxKeys + 1); // +1 to detect truncation

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
      SELECT f.id, f.name, f.size, f.updated_at, f.metadata, COALESCE(fp.path, '') || f.name as s3_key
      FROM files f
      LEFT JOIN folder_path fp ON f.workspace_folder_id = fp.id
      WHERE f.workspace_id = ? AND f.is_trashed = 0
        AND COALESCE(fp.path, '') || f.name LIKE ? ESCAPE '^'${cursorClause}
      ORDER BY COALESCE(fp.path, '') || f.name, f.id
      LIMIT ?
    `,
      )
      .bind(...binds)
      .all<FileRow>();
  }
}
