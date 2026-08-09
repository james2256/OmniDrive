import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';
import { batchInChunks } from '../lib/d1-batch';
import { D1_MAX_BIND_VARIABLES, assertWithinD1Limit } from '../lib/d1-constants';
import type { FileRow } from '../types/db';
import type { DriveAccount } from '../types/domain';
import type { GDriveFile } from '../types/google';

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
    return this.db.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first<FileRow>();
  }

  /**
   * Batch-lookup files by ID, scoped to the caller. Returns only the fields
   * needed for cross-workspace membership validation in addFilesToFolder.
   * Chunks to stay under D1's bind-variable limit.
   */
  async findByIds(
    fileIds: string[],
    userId: string,
  ): Promise<{ id: string; workspace_id: string | null }[]> {
    if (fileIds.length === 0) return [];
    const results: { id: string; workspace_id: string | null }[] = [];
    const CHUNK = D1_MAX_BIND_VARIABLES - 1; // 1 bind for userId
    for (let i = 0; i < fileIds.length; i += CHUNK) {
      const chunk = fileIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      assertWithinD1Limit(1 + chunk.length, 'findByIds');
      const { results: rows } = await this.db
        .prepare(`SELECT id, workspace_id FROM files WHERE user_id = ? AND id IN (${placeholders})`)
        .bind(userId, ...chunk)
        .all<{ id: string; workspace_id: string | null }>();
      results.push(...(rows ?? []));
    }
    return results;
  }

  /**
   * Find recent files across user's own files + workspace files.
   * CTE form with per-branch LIMIT so each branch reads at most `limit` rows
   * instead of ALL user files. Branch 1 (user_id filter) seeks
   * idx_files_user_trashed_sort (expression index — no temp B-tree sort).
   * Branch 2 (workspace_id via JOIN) seeks idx_files_workspace_trashed and
   * sorts ~limit rows (acceptable). UNION (not UNION ALL) dedupes files the
   * user both owns and accesses via a workspace.
   *
   * SQLite does not support parenthesized subqueries in a UNION — CTEs are
   * the correct syntax for per-branch LIMIT.
   */
  findRecent(userId: string, limit = 20) {
    return this.db
      .prepare(
        `
      WITH branch1 AS (
        SELECT f.*, d.email as driveEmail
        FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id
        WHERE f.is_trashed = 0 AND f.user_id = ?
        ORDER BY COALESCE(f.google_modified_at, f.synced_at, f.updated_at) DESC
        LIMIT ?
      ),
      branch2 AS (
        SELECT f.*, d.email as driveEmail
        FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id
        JOIN workspace_members wm ON wm.workspace_id = f.workspace_id AND wm.user_id = ?
        WHERE f.is_trashed = 0
        ORDER BY COALESCE(f.google_modified_at, f.synced_at, f.updated_at) DESC
        LIMIT ?
      )
      SELECT * FROM (SELECT * FROM branch1 UNION SELECT * FROM branch2)
      ORDER BY COALESCE(google_modified_at, synced_at, updated_at) DESC
      LIMIT ?
    `,
      )
      .bind(userId, limit, userId, limit, limit)
      .all<Record<string, unknown>>();
  }

  // ─── Storage stats (delta-maintained, replaces category_cache) ───

  /**
   * Read per-mime-type running sums for a user (~20 rows). Feeds
   * FileService.getCategoryOverview for the dashboard donut chart.
   * Replaces the old getCategoryOverviewCached which scanned 100K+ rows
   * on every cache miss.
   */
  getStorageStats(userId: string) {
    return this.db
      .prepare('SELECT mime_type, total_size FROM file_storage_stats WHERE user_id = ?')
      .bind(userId)
      .all<{ mime_type: string; total_size: number }>();
  }

  /**
   * Return a prepared stats delta UPSERT statement (not run) for batch
   * composition. Uses MAX(0, total_size + ?) to prevent negative totals
   * from drift (a missed delta would otherwise produce a negative value
   * that breaks the frontend donut chart — DashboardPage.tsx filters
   * `c.value > 0`, which would silently drop the negative bucket and
   * inflate the total). The recomputeStorageStats admin endpoint is the
   * real drift fix; MAX(0) prevents UI breakage in the meantime.
   */
  applyStorageDeltaStmt(userId: string, mimeType: string, delta: number): D1PreparedStatement {
    // INSERT stores the raw delta. On first insert, a negative delta would
    // create a negative row — but applyStorageDeltas only calls this when
    // delta !== 0, and the first delta for a (user, mime) pair is always
    // positive (you can't subtract from something that doesn't exist).
    // The CASE WHEN in ON CONFLICT clamps at zero for subsequent updates.
    return this.db
      .prepare(
        `INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES (?, ?, ?)
         ON CONFLICT(user_id, mime_type) DO UPDATE SET total_size = CASE WHEN total_size + excluded.total_size < 0 THEN 0 ELSE total_size + excluded.total_size END`,
      )
      .bind(userId, mimeType, delta);
  }

  /**
   * Batch-apply multiple deltas (used by sync + service mutations).
   * Filters out zero deltas (e.g. rename-only changes produce no stats delta).
   */
  async applyStorageDeltas(
    deltas: { userId: string; mimeType: string; delta: number }[],
  ): Promise<void> {
    const stmts = deltas
      .filter((d) => d.delta !== 0)
      .map((d) => this.applyStorageDeltaStmt(d.userId, d.mimeType, d.delta));
    if (stmts.length > 0) {
      await batchInChunks(this.db, stmts);
    }
  }

  /**
   * Fetch existing file rows for a set of Google file IDs — used by the sync
   * loop to compute deltas before upserting. Returns Map<googleFileId, state>.
   * One query per page (not per file) — stays within D1's subrequest budget.
   * Chunks IN(?) lists at 500 to stay under D1's variable limit.
   */
  async findExistingForDelta(
    driveAccountId: string,
    googleFileIds: string[],
  ): Promise<Map<string, { size: number; mimeType: string; isTrashed: boolean }>> {
    const out = new Map<string, { size: number; mimeType: string; isTrashed: boolean }>();
    if (googleFileIds.length === 0) return out;

    // 99 file IDs + 1 driveAccountId = 100 = D1's max bind variables per query
    const CHUNK = D1_MAX_BIND_VARIABLES - 1;
    for (let i = 0; i < googleFileIds.length; i += CHUNK) {
      const chunk = googleFileIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      assertWithinD1Limit(1 + chunk.length, 'findExistingForDelta');
      const { results } = await this.db
        .prepare(
          `SELECT google_file_id, size, mime_type, is_trashed
           FROM files WHERE drive_account_id = ? AND google_file_id IN (${placeholders})`,
        )
        .bind(driveAccountId, ...chunk)
        .all<{
          google_file_id: string;
          size: number;
          mime_type: string | null;
          is_trashed: number;
        }>();
      for (const r of results) {
        out.set(r.google_file_id, {
          size: r.size ?? 0,
          mimeType: r.mime_type ?? '',
          isTrashed: r.is_trashed === 1,
        });
      }
    }
    return out;
  }

  /**
   * Full recompute for admin reconcile / initial-sync fallback.
   * DELETE + re-INSERT in a single batch (atomic).
   */
  async recomputeStorageStats(userId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM file_storage_stats WHERE user_id = ?').bind(userId),
      this.db
        .prepare(
          `INSERT INTO file_storage_stats (user_id, mime_type, total_size)
           SELECT ?, COALESCE(mime_type, ''), SUM(size) FROM files
           WHERE user_id = ? AND is_trashed = 0 GROUP BY COALESCE(mime_type, '')`,
        )
        .bind(userId, userId),
    ]);
  }

  /**
   * Search files with optional query, workspace filter, and metadata filter.
   * UNION form (not `OR EXISTS`) so each branch uses a different index:
   * branch 1 seeks idx_files_user_trashed_name_id (user_id), branch 2 seeks
   * idx_files_workspace_trashed via a workspace_members drive. UNION dedupes
   * files the user both owns and accesses via a workspace. The shared filter
   * fragment (name LIKE, workspace_id, metadata) is built once and injected
   * into both branches so semantics match the prior OR-EXISTS form exactly.
   */
  async searchFiles(
    userId: string,
    query: string | null,
    workspaceId: string | null,
    metadata: Record<string, string> | null,
    limit = 50,
  ) {
    let filterSql = ``;
    const filterBinds: (string | number)[] = [];

    if (query?.trim()) {
      filterSql += ` AND f.name LIKE ?`;
      filterBinds.push(`%${query.trim()}%`);
    }

    if (workspaceId) {
      filterSql += ` AND f.workspace_id = ?`;
      filterBinds.push(workspaceId);
    }

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        if (!/^[a-zA-Z0-9_.]+$/.test(key)) continue; // ponytail: L11 — reject JSON-path injection
        filterSql += ` AND json_extract(f.metadata, '$.' || ?) = ?`;
        filterBinds.push(key, String(value));
      }
    }

    const sql = `
      SELECT * FROM (
        SELECT f.*, d.email as driveEmail
        FROM files f
        JOIN drive_accounts d ON f.drive_account_id = d.id
        WHERE f.is_trashed = 0 AND f.user_id = ?${filterSql}
        UNION
        SELECT f.*, d.email as driveEmail
        FROM files f
        JOIN drive_accounts d ON f.drive_account_id = d.id
        JOIN workspace_members wm ON wm.workspace_id = f.workspace_id AND wm.user_id = ?
        WHERE f.is_trashed = 0${filterSql}
      )
      ORDER BY created_at DESC LIMIT ?
    `;
    const binds: (string | number)[] = [userId, ...filterBinds, userId, ...filterBinds, limit];

    const { results } = await this.db
      .prepare(sql)
      .bind(...binds)
      .all<Record<string, unknown>>();
    return { results };
  }

  /** Find starred files for a user. */
  findStarred(userId: string) {
    return this.db
      .prepare(
        'SELECT f.*, d.email as driveEmail FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id WHERE f.user_id = ? AND f.is_starred = 1 AND f.is_trashed = 0 ORDER BY f.created_at DESC',
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /** Find trashed files for a user. */
  findTrashed(userId: string) {
    return this.db
      .prepare(
        `SELECT f.*, d.email as driveEmail FROM files f
       JOIN drive_accounts d ON f.drive_account_id = d.id
       WHERE f.user_id = ? AND f.is_trashed = 1
       ORDER BY f.updated_at DESC`,
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /** Find a file with drive email + source drive ID for move-drive operation. */
  findForMoveDrive(fileId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT f.*, d.email as driveEmail, d.id as sourceDriveId FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id WHERE f.id = ? AND f.user_id = ?`,
      )
      .bind(fileId, userId)
      .first<Record<string, unknown>>();
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
    metadata: string;
  }): Promise<FileRow | null> {
    await this.db
      .prepare(
        `
      INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, google_file_id, google_parent_id, name, mime_type, size, thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at, metadata, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
      )
      .bind(
        params.id,
        params.userId,
        params.driveAccountId,
        params.workspaceId,
        params.workspaceFolderId,
        params.googleFileId,
        params.googleParentId,
        params.name,
        params.mimeType,
        params.size,
        params.thumbnailUrl,
        params.webViewLink,
        params.webContentLink,
        params.googleCreatedAt,
        params.googleModifiedAt,
        params.metadata,
      )
      .run();
    return this.db.prepare('SELECT * FROM files WHERE id = ?').bind(params.id).first<FileRow>();
  }

  // ─── Mutations ───

  markTrashed(fileId: string, userId: string) {
    return this.db
      .prepare('UPDATE files SET is_trashed = 1 WHERE id = ? AND user_id = ?')
      .bind(fileId, userId)
      .run();
  }

  /**
   * Mark a file trashed without user scoping — for system operations (lifecycle
   * cron, automation engine) that don't have a userId. Updates updated_at.
   */
  markTrashedSystem(fileId: string) {
    return this.db
      .prepare('UPDATE files SET is_trashed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(fileId)
      .run();
  }

  /**
   * Return a prepared mark-trashed statement (not run) for batch composition.
   * Mirrors `markTrashedSystem` SQL (including `updated_at`) so lifecycle-trashed
   * files sort correctly in the Trash page (which orders by `updated_at DESC`).
   */
  markTrashedSystemStmt(fileId: string): D1PreparedStatement {
    return this.db
      .prepare('UPDATE files SET is_trashed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(fileId);
  }

  markUntrashed(fileId: string, userId: string) {
    return this.db
      .prepare(
        'UPDATE files SET is_trashed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      )
      .bind(fileId, userId)
      .run();
  }

  rename(fileId: string, userId: string, name: string) {
    return this.db
      .prepare(
        'UPDATE files SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      )
      .bind(name, fileId, userId)
      .run();
  }

  async star(fileId: string, userId: string): Promise<boolean> {
    const { meta } = await this.db
      .prepare('UPDATE files SET is_starred = 1 WHERE id = ? AND user_id = ?')
      .bind(fileId, userId)
      .run();
    return meta.changes > 0;
  }

  async unstar(fileId: string, userId: string): Promise<boolean> {
    const { meta } = await this.db
      .prepare('UPDATE files SET is_starred = 0 WHERE id = ? AND user_id = ?')
      .bind(fileId, userId)
      .run();
    return meta.changes > 0;
  }

  delete(fileId: string, userId: string) {
    return this.db
      .prepare('DELETE FROM files WHERE id = ? AND user_id = ?')
      .bind(fileId, userId)
      .run();
  }

  /**
   * Return a prepared DELETE statement (not run) for batch operations.
   * Used by PolicyService retention auto-delete to batch DELETE + used_bytes
   * UPDATE atomically. No userId scoping — system operation.
   */
  deleteByIdStmt(fileId: string): D1PreparedStatement {
    return this.db.prepare('DELETE FROM files WHERE id = ?').bind(fileId);
  }

  /**
   * Return a prepared workspace_folder_id UPDATE statement (not run) for batch
   * operations. Used by AutomationEngine to batch move actions.
   */
  updateWorkspaceFolderStmt(fileId: string, folderId: string): D1PreparedStatement {
    return this.db
      .prepare(
        'UPDATE files SET workspace_folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(folderId, fileId);
  }

  /**
   * Return a prepared is_trashed UPDATE statement (not run) for batch operations.
   * Used by AutomationEngine to batch delete (trash) actions. No userId scoping.
   */
  markTrashedStmt(fileId: string, isTrashed: number): D1PreparedStatement {
    return this.db.prepare('UPDATE files SET is_trashed = ? WHERE id = ?').bind(isTrashed, fileId);
  }

  /**
   * Return a prepared DELETE statement scoped by drive_account_id + google_file_id
   * (not run), for batch composition. Used by the sync engine to batch
   * incremental-sync deletions — both "removed from Google" and "no longer
   * owned" cleanup — with drive-folder deletions via `batchInChunks`. Distinct
   * from `deleteByIdStmt` (scoped by file `id`) and `delete` (scoped by
   * id + user_id): the sync engine only knows the Google file id, not the D1
   * row id. No userId scoping — system op.
   */
  deleteByDriveAndGoogleIdStmt(driveAccountId: string, googleFileId: string): D1PreparedStatement {
    return this.db
      .prepare('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?')
      .bind(driveAccountId, googleFileId);
  }

  /**
   * Return a prepared "mark trashed" statement scoped by drive_account_id +
   * google_file_id (not run), for batch composition. Used by the sync engine
   * to batch incremental-sync trash updates (owned + trashed on Google) with
   * drive-folder trash updates via `batchInChunks`. Distinct from
   * `markTrashedStmt` (scoped by file `id`, takes a trashed flag): the sync
   * engine only knows the Google file id and always sets is_trashed = 1. No
   * userId scoping — system op.
   */
  markTrashedByDriveAndGoogleIdStmt(
    driveAccountId: string,
    googleFileId: string,
  ): D1PreparedStatement {
    return this.db
      .prepare('UPDATE files SET is_trashed = 1 WHERE drive_account_id = ? AND google_file_id = ?')
      .bind(driveAccountId, googleFileId);
  }

  updateMetadata(fileId: string, metadata: string) {
    return this.db
      .prepare('UPDATE files SET metadata = ? WHERE id = ?')
      .bind(metadata, fileId)
      .run();
  }

  moveToWorkspaceFolder(
    fileId: string,
    userId: string,
    workspaceFolderId: string | null,
    workspaceId: string | null,
  ) {
    return this.db
      .prepare(
        'UPDATE files SET workspace_folder_id = ?, workspace_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      )
      .bind(workspaceFolderId, workspaceId, fileId, userId)
      .run();
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
    // 97 file IDs + 3 WHERE binds (workspaceId, workspaceFolderId, userId) = 100
    const CHUNK_SIZE = D1_MAX_BIND_VARIABLES - 3;
    for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
      const chunk = fileIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      assertWithinD1Limit(3 + chunk.length, 'batchAssignToFolder');
      await this.db
        .prepare(
          `UPDATE files SET workspace_id = ?, workspace_folder_id = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`,
        )
        .bind(workspaceId, workspaceFolderId, userId, ...chunk)
        .run();
    }
  }

  /** Detach all files from a workspace (set workspace_id + workspace_folder_id to NULL). */
  detachFromWorkspace(workspaceId: string) {
    return this.db
      .prepare(
        'UPDATE files SET workspace_id = NULL, workspace_folder_id = NULL WHERE workspace_id = ?',
      )
      .bind(workspaceId)
      .run();
  }

  /**
   * Find files in a workspace root (workspace_folder_id IS NULL), with cursor pagination.
   * Returns files with drive email via JOIN. Used by GET /:id? (workspace case).
   */
  async findFilesInWorkspaceRoot(
    workspaceId: string,
    cursor: { name: string; id: string } | null,
    limit: number,
  ) {
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
    const { results } = await this.db
      .prepare(sql)
      .bind(...binds)
      .all<Record<string, unknown>>();
    return { results };
  }

  /**
   * Find files in a workspace folder, with cursor pagination.
   * Returns files with drive email via JOIN. Used by GET /:id? (folder case).
   */
  async findFilesInFolder(
    folderId: string,
    cursor: { name: string; id: string } | null,
    limit: number,
  ) {
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
    const { results } = await this.db
      .prepare(sql)
      .bind(...binds)
      .all<Record<string, unknown>>();
    return { results };
  }

  // ─── Sync engine support ───

  /**
   * Find files that have expired under a data-retention auto-delete policy,
   * joined to their drive for the Google file id + drive id needed to call the
   * Drive API. The `target` discriminator selects the scope:
   *  - `{ kind: 'workspace', workspaceId, cutoffStr }` → all non-trashed files in the workspace
   *  - `{ kind: 'folder', workspaceId, folderId, cutoffStr }` → scoped to one folder
   *
   * The two flavors differ only in the WHERE clause (the folder branch adds
   * `AND workspace_folder_id = ?`), so this method builds the SQL internally
   * rather than letting the caller assemble it. Bind count differs by branch,
   * but every value is still a bound parameter — no string interpolation.
   */
  findExpiredForRetention(
    target:
      | { kind: 'workspace'; workspaceId: string; cutoffStr: string }
      | { kind: 'folder'; workspaceId: string; folderId: string; cutoffStr: string },
  ) {
    const base = `SELECT f.id, f.user_id, f.google_file_id, f.size, f.mime_type, f.workspace_id, d.id as driveId
                 FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id
                 WHERE f.workspace_id = ? AND f.created_at < ? AND f.is_trashed = 0`;
    if (target.kind === 'workspace') {
      return this.db.prepare(base).bind(target.workspaceId, target.cutoffStr).all<{
        id: string;
        user_id: string;
        google_file_id: string;
        size: number;
        mime_type: string | null;
        workspace_id: string;
        driveId: string;
      }>();
    }
    return this.db
      .prepare(`${base} AND f.workspace_folder_id = ?`)
      .bind(target.workspaceId, target.cutoffStr, target.folderId)
      .all<{
        id: string;
        user_id: string;
        google_file_id: string;
        size: number;
        mime_type: string | null;
        workspace_id: string;
        driveId: string;
      }>();
  }

  /**
   * Cursor-paginated scan of a user's non-trashed files for the automation cron.
   * Mirrors the cursor pattern used by `findFilesInFolder` / `findExternalFiles`:
   * the optional `AND (name, id) > (?, ?)` clause is appended only when a cursor
   * is present, and the repo owns the SQL construction (the caller passes a
   * structured cursor, not a SQL fragment).
   */
  findBatchForCron(
    userId: string,
    isTrashed: number,
    cursor: { name: string; id: string } | null,
    limit: number,
  ) {
    let sql = `SELECT * FROM files WHERE user_id = ? AND is_trashed = ?`;
    const binds: (string | number)[] = [userId, isTrashed];
    if (cursor) {
      sql += ` AND (name, id) > (?, ?)`;
      binds.push(cursor.name, cursor.id);
    }
    sql += ` ORDER BY name ASC, id ASC LIMIT ?`;
    binds.push(limit);
    return this.db
      .prepare(sql)
      .bind(...binds)
      .all<FileRow>();
  }

  /**
   * Find the first drive ID associated with files in a folder/workspace.
   * Used by GET /:id? and POST /:id/force-sync for drive lookup.
   *
   * CTE with LIMIT 1 in each branch (not UNION with outer LIMIT 1).
   * SQLite/D1 cannot push an outer LIMIT 1 into UNION branches — the UNION
   * materializes ALL matching rows before applying the limit. For a workspace
   * with 43K files, this caused 43K rows_read per call (46% of D1 runtime).
   * The CTE pattern (matching findRecent) lets SQLite stop after 1 row/branch.
   *
   * The JOIN to drive_accounts is eliminated — files.drive_account_id is
   * TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE (FK-enforced
   * in all runtimes via polyfills/d1.ts:93). No need to validate the FK at
   * read time; reading drive_account_id directly saves 1 row per match.
   *
   * Branch 2 uses COALESCE to resolve workspace_id internally (handles both
   * folder IDs and workspace IDs — see the prior comment for details).
   */
  findDriveIdForFolder(folderId: string, userId: string) {
    return this.db
      .prepare(
        `
      WITH branch1 AS (
        SELECT drive_account_id as id FROM files
        WHERE workspace_folder_id = ? AND user_id = ? LIMIT 1
      ), branch2 AS (
        SELECT drive_account_id as id FROM files
        WHERE workspace_id = COALESCE(
          (SELECT workspace_id FROM workspace_folders WHERE id = ?), ?
        ) AND user_id = ? LIMIT 1
      )
      SELECT id FROM (SELECT * FROM branch1 UNION SELECT * FROM branch2) LIMIT 1
    `,
      )
      .bind(folderId, userId, folderId, folderId, userId)
      .first<{ id: string }>();
  }

  /**
   * Update a file's drive assignment after a move-drive operation.
   * Sets the new drive_account_id, google_file_id, and resets parent to 'root'.
   */
  updateDriveAssignment(fileId: string, driveAccountId: string, googleFileId: string) {
    return this.db
      .prepare(
        `UPDATE files
       SET drive_account_id = ?, google_file_id = ?, google_parent_id = 'root', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      )
      .bind(driveAccountId, googleFileId, fileId)
      .run();
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
      owned_by_me = excluded.owned_by_me,
      is_trashed = 0
    WHERE excluded.name IS NOT files.name
       OR excluded.mime_type IS NOT files.mime_type
       OR excluded.size IS NOT files.size
       OR excluded.thumbnail_url IS NOT files.thumbnail_url
       OR excluded.web_view_link IS NOT files.web_view_link
       OR excluded.web_content_link IS NOT files.web_content_link
       OR excluded.google_modified_at IS NOT files.google_modified_at
       OR excluded.google_parent_id IS NOT files.google_parent_id
       OR excluded.owned_by_me IS NOT files.owned_by_me
       OR files.is_trashed = 1`;

  buildUpsertStmt(
    drive: DriveAccount,
    file: GDriveFile,
    googleParentId: string | null,
    ownedByMe: boolean,
  ): D1PreparedStatement {
    return this.db
      .prepare(FileRepository.UPSERT_FILE_SQL)
      .bind(
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

  // ─── S3 protocol support ───

  /**
   * Find a file by workspace + name + folder (full row). Used by S3
   * HeadObject, DeleteObject, and AbortMultipartUpload where the full
   * file metadata is needed.
   */
  findByWorkspaceKeyFull(workspaceId: string, name: string, folderId: string | null) {
    return this.db
      .prepare(
        `SELECT * FROM files 
         WHERE workspace_id = ? AND name = ? AND (workspace_folder_id = ? OR (workspace_folder_id IS NULL AND ? IS NULL))
           AND is_trashed = 0`,
      )
      .bind(workspaceId, name, folderId, folderId)
      .first<FileRow>();
  }

  /**
   * Find a file by workspace + name + folder (minimal columns). Used by S3
   * PutObject and CompleteMultipartUpload where only id, drive_account_id,
   * and google_file_id are needed for the atomic replace.
   */
  findByWorkspaceKeyMinimal(workspaceId: string, name: string, folderId: string | null) {
    return this.db
      .prepare(
        `SELECT id, drive_account_id, google_file_id FROM files
         WHERE workspace_id = ? AND name = ? AND (workspace_folder_id = ? OR (workspace_folder_id IS NULL AND ? IS NULL))
           AND is_trashed = 0`,
      )
      .bind(workspaceId, name, folderId, folderId)
      .first<FileRow>();
  }

  /**
   * Return a prepared INSERT statement (not run) for S3 object creation.
   * Used in db.batch([deleteStmt, insertStmt]) for atomic object-replace.
   */
  insertS3ObjectStmt(params: {
    id: string;
    userId: string;
    driveAccountId: string;
    workspaceId: string;
    folderId: string | null;
    googleFileId: string;
    name: string;
    mimeType: string;
    size: number;
    metadata: string;
    thumbnailUrl: string | null;
    webViewLink: string | null;
    webContentLink: string | null;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO files (
          id, user_id, drive_account_id, workspace_id, workspace_folder_id, 
          google_file_id, name, mime_type, size, metadata,
          thumbnail_url, web_view_link, web_content_link,
          google_created_at, google_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .bind(
        params.id,
        params.userId,
        params.driveAccountId,
        params.workspaceId,
        params.folderId,
        params.googleFileId,
        params.name,
        params.mimeType,
        params.size,
        params.metadata,
        params.thumbnailUrl,
        params.webViewLink,
        params.webContentLink,
      );
  }
}
