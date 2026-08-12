import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { D1_MAX_BIND_VARIABLES, assertWithinD1Limit } from '../lib/d1-constants';
import type { DriveAccountRow, DriveFolderRow, FileRow } from '../types/db';

/**
 * Data access layer for `drive_accounts` and `drive_folders` tables.
 *
 * All SQL for Google Drive accounts and their cached folder metadata lives
 * here. Routes and services never write inline SQL for these tables.
 */
export class DriveRepository {
  constructor(private db: D1Database) {}

  // ─── drive_accounts reads ───

  findByIdAndUser(driveId: string, userId: string) {
    return this.db
      .prepare('SELECT id, email FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId)
      .first<{ id: string; email: string }>();
  }

  /** Find all drives for a user with sync state (LEFT JOIN sync_state). */
  findAllWithSyncState(userId: string) {
    return this.db
      .prepare(
        'SELECT a.*, s.status as sync_status, s.last_synced_at, s.error_message as sync_error_message, CASE WHEN s.next_page_token IS NOT NULL THEN 1 ELSE 0 END as sync_paused FROM drive_accounts a LEFT JOIN sync_state s ON a.id = s.drive_account_id WHERE a.user_id = ?',
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /** Find a drive by ID + user (full row, with sync_state JOIN). */
  findFullByIdAndUser(driveId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT a.*, s.status as sync_status, s.last_synced_at, s.error_message as sync_error_message,
                CASE WHEN s.next_page_token IS NOT NULL THEN 1 ELSE 0 END as sync_paused
         FROM drive_accounts a
         LEFT JOIN sync_state s ON a.id = s.drive_account_id
         WHERE a.id = ? AND a.user_id = ?`,
      )
      .bind(driveId, userId)
      .first<Record<string, unknown>>();
  }

  /** Find drive with root_folder_id for move operation. */
  findForMove(driveId: string, userId: string) {
    return this.db
      .prepare('SELECT id, root_folder_id FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId)
      .first<{ id: string; root_folder_id: string | null }>();
  }

  /**
   * Read the encrypted token blob for a drive. Used by `GoogleDriveService.loadTokens`
   * (the first call per sync — subsequent calls hit the in-memory token cache).
   * Returns `null` if no tokens row exists (the caller throws NotFoundError).
   */
  findEncryptedTokens(driveAccountId: string) {
    return this.db
      .prepare('SELECT encrypted_tokens FROM drive_tokens WHERE drive_account_id = ?')
      .bind(driveAccountId)
      .first<{ encrypted_tokens: string }>();
  }

  /** Find the next drive (by created_at) to set as primary after deletion. */
  findNextDrive(userId: string) {
    return this.db
      .prepare('SELECT id FROM drive_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
      .bind(userId)
      .first<{ id: string }>();
  }

  /** Find the primary drive ID for a user (highest is_primary, first by created_at). */
  findPrimaryDriveId(userId: string) {
    return this.db
      .prepare('SELECT id FROM drive_accounts WHERE user_id = ? ORDER BY is_primary DESC LIMIT 1')
      .bind(userId)
      .first<{ id: string }>();
  }

  /**
   * Find a drive by ID (NO user check — RBAC bypass).
   *
   * Only safe when the driveId is trusted (server-generated, from an
   * already-authorized file, or from the queue consumer's internal message).
   * NEVER call with a user-supplied driveId — use findFullByIdAndUser instead.
   */
  findById(driveId: string) {
    return this.db
      .prepare('SELECT * FROM drive_accounts WHERE id = ?')
      .bind(driveId)
      .first<DriveAccountRow>();
  }

  /** Find all drives for a user (no sync_state JOIN — plain SELECT *). */
  findAllByUser(userId: string) {
    return this.db
      .prepare('SELECT * FROM drive_accounts WHERE user_id = ?')
      .bind(userId)
      .all<DriveAccountRow>();
  }

  /**
   * Find all drives whose `type` is in the given list.
   *
   * Used by the scheduled sync runner to select the syncable drive types
   * (`'oauth'`, `'service_account'`). Builds an `IN (?, ?, ...)` placeholder
   * list like `findDrivesWithTokens` — callers must pass a non-empty array
   * (an empty array yields `IN ()`, which is a SQLite syntax error).
   */
  findAllByType(types: readonly string[]) {
    const placeholders = types.map(() => '?').join(',');
    assertWithinD1Limit(types.length, 'findAllByType');
    return this.db
      .prepare(`SELECT * FROM drive_accounts WHERE type IN (${placeholders})`)
      .bind(...types)
      .all<DriveAccountRow>();
  }

  /**
   * Find all drives that have tokens, from a list of drive IDs.
   * Used by upload/init to verify at least one drive has valid tokens.
   * Chunks at D1's max bind variables to prevent overflow on users with
   * >100 drives.
   */
  async findDrivesWithTokens(driveIds: string[]) {
    if (driveIds.length === 0) return { results: [] };
    const found = new Set<string>();
    const CHUNK = D1_MAX_BIND_VARIABLES;
    for (let i = 0; i < driveIds.length; i += CHUNK) {
      const chunk = driveIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      assertWithinD1Limit(chunk.length, 'findDrivesWithTokens');
      const { results } = await this.db
        .prepare(
          `SELECT DISTINCT drive_account_id FROM drive_tokens WHERE drive_account_id IN (${placeholders})`,
        )
        .bind(...chunk)
        .all<{ drive_account_id: string }>();
      for (const r of results) found.add(r.drive_account_id);
    }
    return {
      results: Array.from(found).map((id) => ({ drive_account_id: id })),
    };
  }

  /** Delete quota cache entries for a drive. */
  deleteQuotaCache(driveId: string) {
    return this.db
      .prepare('DELETE FROM quota_cache WHERE drive_account_id = ?')
      .bind(driveId)
      .run();
  }

  /**
   * Read the cached quota payload + its `updated_at` timestamp. Used by
   * `GoogleDriveService.getQuota` to check the 5-min TTL before hitting the
   * Google API. Returns `null` if no cache row exists (cache miss).
   */
  findQuotaCache(driveAccountId: string) {
    return this.db
      .prepare('SELECT payload, updated_at FROM quota_cache WHERE drive_account_id = ?')
      .bind(driveAccountId)
      .first<{ payload: string; updated_at: number }>();
  }

  /**
   * UPSERT a quota cache entry. The cache is keyed by `drive_account_id`
   * (PRIMARY KEY), so `ON CONFLICT DO UPDATE` refreshes the payload + timestamp.
   * Used by `GoogleDriveService.getQuota` after a fresh Google API fetch.
   */
  upsertQuotaCache(driveAccountId: string, payload: string, updatedAt: number) {
    return this.db
      .prepare(
        'INSERT INTO quota_cache (drive_account_id, payload, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(drive_account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      )
      .bind(driveAccountId, payload, updatedAt)
      .run();
  }

  /** Delete quota cache entries older than `cutoff` (cron cleanup, 1h TTL). */
  deleteExpiredQuotaCache(cutoff: number) {
    return this.db.prepare('DELETE FROM quota_cache WHERE updated_at < ?').bind(cutoff).run();
  }

  /**
   * Upsert drive tokens (INSERT ... ON CONFLICT UPDATE).
   * Used by the service-account route to store encrypted tokens.
   */
  upsertTokens(driveId: string, encryptedTokens: string, updatedAt: number) {
    return this.db
      .prepare(
        'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(drive_account_id) DO UPDATE SET encrypted_tokens = excluded.encrypted_tokens, updated_at = excluded.updated_at',
      )
      .bind(driveId, encryptedTokens, updatedAt)
      .run();
  }

  /**
   * Find all drives associated with files in a folder/workspace (for sync).
   * Returns full drive rows joined via the files table.
   */
  findDrivesForFolder(folderId: string, userId: string) {
    // UNION (not OR) so each branch uses its own index — the OR form forced a
    // full table scan because D1/SQLite can't use a single index for OR conditions.
    // UNION also deduplicates, so no outer DISTINCT is needed.
    //
    // Branch 2 uses COALESCE to resolve the workspace_id internally (same pattern
    // as findDriveIdForFolder): handles both folder IDs and workspace IDs without
    // a signature change.
    return this.db
      .prepare(
        `
      SELECT * FROM (
        SELECT d.* FROM files f
        JOIN drive_accounts d ON f.drive_account_id = d.id
        WHERE f.workspace_folder_id = ? AND f.user_id = ?
        UNION
        SELECT d.* FROM files f
        JOIN drive_accounts d ON f.drive_account_id = d.id
        WHERE f.workspace_id = COALESCE(
          (SELECT workspace_id FROM workspace_folders WHERE id = ?),
          ?
        ) AND f.user_id = ?
      )
    `,
      )
      .bind(folderId, userId, folderId, folderId, userId)
      .all<DriveAccountRow>();
  }

  /**
   * Build a breadcrumb path using a recursive CTE.
   * Returns folder IDs + names from the current folder up to root.
   */
  findBreadcrumbPath(driveId: string, googleFolderId: string) {
    const query = `
      WITH RECURSIVE breadcrumb_path(id, google_parent_id, name, lvl) AS (
        SELECT google_folder_id, google_parent_id, name, 0 as lvl
        FROM drive_folders
        WHERE drive_account_id = ? AND google_folder_id = ?
        UNION ALL
        SELECT d.google_folder_id, d.google_parent_id, d.name, bp.lvl + 1
        FROM drive_folders d
        JOIN breadcrumb_path bp ON d.google_folder_id = bp.google_parent_id
        WHERE d.drive_account_id = ?
      )
      SELECT id, name FROM breadcrumb_path ORDER BY lvl DESC
    `;
    return this.db
      .prepare(query)
      .bind(driveId, googleFolderId, driveId)
      .all<{ id: string; name: string }>();
  }

  // ─── drive_accounts mutations ───

  /** Update quota (total + used). */
  updateQuota(driveId: string, totalQuota: number, usedQuota: number) {
    return this.db
      .prepare(
        'UPDATE drive_accounts SET total_quota = ?, used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(totalQuota, usedQuota, driveId)
      .run();
  }

  /** Update used quota only. */
  updateUsedQuota(driveId: string, usedQuota: number) {
    return this.db
      .prepare(
        'UPDATE drive_accounts SET used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(usedQuota, driveId)
      .run();
  }

  /** Set a drive as primary. */
  setPrimary(driveId: string) {
    return this.db
      .prepare('UPDATE drive_accounts SET is_primary = 1 WHERE id = ?')
      .bind(driveId)
      .run();
  }

  /**
   * Delete a drive account with manual cascade. Production D1 enforces FK +
   * ON DELETE CASCADE by default (developers.cloudflare.com/d1/sql-api/foreign-keys),
   * so the batch is redundant in production but defensive: it ensures correct
   * behavior on runtimes that don't enforce FK (better-sqlite3-based runtimes —
   * unit tests and the node-server Docker deployment — do not enable
   * PRAGMA foreign_keys) and survives any schema change that drops the FK.
   *
   * Cascade order (children before parents):
   * 1. s3_multipart_parts (via uploads subquery)
   * 2. s3_multipart_uploads (drive_account_id FK)
   * 3. sync_state (drive_account_id FK)
   * 4. quota_cache (drive_account_id FK)
   * 5. drive_folders (drive_account_id FK)
   * 6. files (drive_account_id FK)
   * 7. drive_tokens (drive_account_id FK)
   * 8. drive_accounts (the row itself)
   *
   * Uses db.batch() for atomicity (single round-trip).
   */
  async deleteDrive(driveId: string, userId: string) {
    await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM s3_multipart_parts WHERE upload_id IN (SELECT upload_id FROM s3_multipart_uploads WHERE drive_account_id = ?)',
        )
        .bind(driveId),
      this.db.prepare('DELETE FROM s3_multipart_uploads WHERE drive_account_id = ?').bind(driveId),
      this.db.prepare('DELETE FROM sync_state WHERE drive_account_id = ?').bind(driveId),
      this.db.prepare('DELETE FROM quota_cache WHERE drive_account_id = ?').bind(driveId),
      this.db.prepare('DELETE FROM drive_folders WHERE drive_account_id = ?').bind(driveId),
      this.db.prepare('DELETE FROM files WHERE drive_account_id = ?').bind(driveId),
      this.db.prepare('DELETE FROM drive_tokens WHERE drive_account_id = ?').bind(driveId),
      this.db
        .prepare('DELETE FROM drive_accounts WHERE id = ? AND user_id = ?')
        .bind(driveId, userId),
    ]);
  }

  // ─── external reads ───

  /**
   * Find folders visible at the top level of the External page: only folders
   * you OWN whose immediate parent is the '__shared__' sentinel — computer-backup
   * roots ("My Laptop") and top-level folders you created at the shared root.
   * Items shared WITH you by others (owned_by_me = 0) are excluded. Deeper items
   * are reached by navigating into them (the drill-in route uses the live
   * Google API at any depth).
   */
  findExternalFolders(userId: string) {
    return this.db
      .prepare(
        `SELECT df.*, d.email as driveEmail FROM drive_folders df
       JOIN drive_accounts d ON df.drive_account_id = d.id
       WHERE d.user_id = ? AND df.google_parent_id = '__shared__' AND df.owned_by_me = 1 AND df.is_trashed = 0
       ORDER BY df.name ASC`,
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /**
   * Find files visible at the top level of the External page: files you OWN
   * that are not in My Drive. Two cases:
   *   1. Loose files at the '__shared__' sentinel (direct shared-root files).
   *   2. Files inside non-owned shared folders (your files nested in someone
   *      else's shared folder — reachable because you own the file, even
   *      though the parent folder is filtered out of findExternalFolders).
   *
   * Files shared WITH you by others (owned_by_me = 0) are excluded. Files
   * inside OWNED folders (e.g., inside "My Laptop" backup root) are reached
   * by navigating into the folder via findExternalFolders + drill-in.
   *
   * The IN subquery is non-correlated (materialized once per call).
   * Index coverage (EXPLAIN-verified):
   *   - Outer: idx_files_external_cursor (user_id, google_parent_id, is_trashed, owned_by_me, name, id)
   *   - Inner: idx_drive_folders_drive_trashed_parent_name (drive_account_id, is_trashed, google_parent_id, name)
   * Cursor pagination (name, id) > (?, ?) is preserved via the covering index.
   */
  findExternalFiles(userId: string, cursor: { name: string; id: string } | null, limit: number) {
    let sql = `
      SELECT f.*, d.email as driveEmail FROM files f
      JOIN drive_accounts d ON f.drive_account_id = d.id
      WHERE f.user_id = ? AND f.owned_by_me = 1 AND f.is_trashed = 0
        AND (
          f.google_parent_id = '__shared__'
          OR f.google_parent_id IN (
            SELECT df.google_folder_id FROM drive_folders df
            JOIN drive_accounts d2 ON df.drive_account_id = d2.id
            WHERE d2.user_id = ? AND df.google_parent_id = '__shared__'
              AND df.owned_by_me = 0 AND df.is_trashed = 0
          )
        )
    `;
    const binds: (string | number)[] = [userId, userId];
    if (cursor && cursor.name !== undefined && cursor.id !== undefined) {
      sql += ` AND (f.name, f.id) > (?, ?)`;
      binds.push(cursor.name, cursor.id);
    }
    sql += ` ORDER BY f.name ASC, f.id ASC LIMIT ?`;
    binds.push(limit + 1);
    return this.db
      .prepare(sql)
      .bind(...binds)
      .all<Record<string, unknown>>();
  }

  /** Search drive folders by name (for global search). */
  searchFolders(userId: string, query: string, limit = 20) {
    return this.db
      .prepare(
        `SELECT df.*, d.email as driveEmail FROM drive_folders df
       JOIN drive_accounts d ON df.drive_account_id = d.id
       WHERE d.user_id = ? AND df.is_trashed = 0 AND df.name LIKE ?
       ORDER BY df.name ASC LIMIT ?`,
      )
      .bind(userId, `%${query}%`, limit)
      .all<Record<string, unknown>>();
  }

  // ─── item ownership + parent update (for move within drive) ───

  /** Check item ownership (drive_folders or files table). */
  findItemOwnership(driveId: string, googleId: string, isFolder: boolean) {
    const table = isFolder ? 'drive_folders' : 'files';
    const idCol = isFolder ? 'google_folder_id' : 'google_file_id';
    return this.db
      .prepare(`SELECT owned_by_me FROM ${table} WHERE drive_account_id = ? AND ${idCol} = ?`)
      .bind(driveId, googleId)
      .first<{ owned_by_me: number }>();
  }

  /** Update item parent (drive_folders or files table). */
  updateItemParent(
    driveId: string,
    googleId: string,
    newParentId: string | null,
    isFolder: boolean,
  ) {
    if (isFolder) {
      return this.db
        .prepare(
          'UPDATE drive_folders SET google_parent_id = ? WHERE drive_account_id = ? AND google_folder_id = ?',
        )
        .bind(newParentId, driveId, googleId)
        .run();
    }
    return this.db
      .prepare(
        'UPDATE files SET google_parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE drive_account_id = ? AND google_file_id = ?',
      )
      .bind(newParentId, driveId, googleId)
      .run();
  }

  // ─── drive_folders mutations ───

  /** Insert a newly-created Drive folder into D1 so it appears without requiring sync. */
  insertDriveFolder(params: {
    id: string;
    driveAccountId: string;
    googleFolderId: string;
    googleParentId: string | null;
    name: string;
    ownedByMe: boolean;
  }) {
    return this.db
      .prepare(
        `INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, is_synced, owned_by_me)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .bind(
        params.id,
        params.driveAccountId,
        params.googleFolderId,
        params.googleParentId,
        params.name,
        params.ownedByMe ? 1 : 0,
      )
      .run();
  }

  /** Check if the user owns a Drive folder by google_folder_id. */
  findOwnedDriveFolderByGoogleId(googleFolderId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT df.id FROM drive_folders df
       JOIN drive_accounts d ON df.drive_account_id = d.id
       WHERE d.user_id = ? AND df.google_folder_id = ? AND df.owned_by_me = 1`,
      )
      .bind(userId, googleFolderId)
      .first<Record<string, unknown>>();
  }

  markDriveFolderTrashed(driveId: string, googleFolderId: string) {
    return this.db
      .prepare(
        'UPDATE drive_folders SET is_trashed = 1 WHERE drive_account_id = ? AND google_folder_id = ?',
      )
      .bind(driveId, googleFolderId)
      .run();
  }

  /**
   * Return a prepared "mark drive folder trashed" statement (not run) for
   * batch composition. This is the `Stmt` variant of `markDriveFolderTrashed`
   * — used by the sync engine to batch incremental-sync trash updates with
   * file trash updates via `batchInChunks`. No userId scoping — system op.
   */
  markDriveFolderTrashedStmt(driveId: string, googleFolderId: string): D1PreparedStatement {
    return this.db
      .prepare(
        'UPDATE drive_folders SET is_trashed = 1 WHERE drive_account_id = ? AND google_folder_id = ?',
      )
      .bind(driveId, googleFolderId);
  }

  markDriveFolderUntrashed(driveId: string, googleFolderId: string) {
    return this.db
      .prepare(
        'UPDATE drive_folders SET is_trashed = 0 WHERE drive_account_id = ? AND google_folder_id = ?',
      )
      .bind(driveId, googleFolderId)
      .run();
  }

  starDriveFolder(driveId: string, googleFolderId: string) {
    return this.db
      .prepare(
        'UPDATE drive_folders SET is_starred = 1 WHERE drive_account_id = ? AND google_folder_id = ?',
      )
      .bind(driveId, googleFolderId)
      .run();
  }

  unstarDriveFolder(driveId: string, googleFolderId: string) {
    return this.db
      .prepare(
        'UPDATE drive_folders SET is_starred = 0 WHERE drive_account_id = ? AND google_folder_id = ?',
      )
      .bind(driveId, googleFolderId)
      .run();
  }

  renameDriveFolder(driveId: string, googleFolderId: string, name: string) {
    return this.db
      .prepare(
        'UPDATE drive_folders SET name = ? WHERE drive_account_id = ? AND google_folder_id = ?',
      )
      .bind(name, driveId, googleFolderId)
      .run();
  }

  deleteDriveFolder(driveId: string, googleFolderId: string) {
    return this.db
      .prepare('DELETE FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId)
      .run();
  }

  /**
   * Return a prepared "delete drive folder" statement (not run) for batch
   * composition. This is the `Stmt` variant of `deleteDriveFolder` — used by
   * the sync engine to batch incremental-sync deletions (removed-from-Google
   * and not-owned cleanup) with file deletions via `batchInChunks`. No userId
   * scoping — system op.
   */
  deleteDriveFolderStmt(driveId: string, googleFolderId: string): D1PreparedStatement {
    return this.db
      .prepare('DELETE FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId);
  }

  /** Find a drive by Google account ID + user (dedup check for OAuth connect). */
  findDriveByGoogleAccountId(userId: string, googleAccountId: string) {
    return this.db
      .prepare('SELECT id FROM drive_accounts WHERE user_id = ? AND google_account_id = ?')
      .bind(userId, googleAccountId)
      .first<{ id: string }>();
  }

  /** Count drives for a user (primary-drive promotion logic). */
  countDrivesByUser(userId: string) {
    return this.db
      .prepare('SELECT COUNT(*) as count FROM drive_accounts WHERE user_id = ?')
      .bind(userId)
      .first<{ count: number }>();
  }

  /** Find drive folders by parent (folder browsing). */
  findDriveFoldersByParent(
    driveId: string,
    parentId: string | null,
  ): Promise<D1Result<Record<string, unknown>>> {
    const base = 'SELECT * FROM drive_folders WHERE drive_account_id = ? AND is_trashed = 0';
    if (parentId === null) {
      return this.db
        .prepare(`${base} AND google_parent_id IS NULL ORDER BY name ASC LIMIT 1000`)
        .bind(driveId)
        .all<DriveFolderRow>();
    }
    return this.db
      .prepare(`${base} AND google_parent_id = ? ORDER BY name ASC LIMIT 1000`)
      .bind(driveId, parentId)
      .all<DriveFolderRow>();
  }

  /** Find files by Google parent ID (folder browsing). */
  findFilesByParent(driveId: string, parentId: string): Promise<D1Result<Record<string, unknown>>> {
    return this.db
      .prepare(
        'SELECT * FROM files WHERE drive_account_id = ? AND google_parent_id = ? AND is_trashed = 0 ORDER BY name ASC LIMIT 1000',
      )
      .bind(driveId, parentId)
      .all<FileRow>();
  }

  /** Mark a drive folder as synced (lazy-load completion). */
  markDriveFolderSynced(driveId: string, googleFolderId: string) {
    return this.db
      .prepare(
        `UPDATE drive_folders SET is_synced = 1, synced_at = datetime('now') WHERE drive_account_id = ? AND google_folder_id = ?`,
      )
      .bind(driveId, googleFolderId)
      .run();
  }

  /** Find a drive folder by Google folder ID. */
  findDriveFolderByGoogleId(driveId: string, googleFolderId: string) {
    return this.db
      .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId)
      .first<DriveFolderRow>();
  }

  /**
   * Find a drive folder by name + parent (within one drive). Used by the
   * `/folders/ensure` endpoint to check whether a folder already exists before
   * creating it — so folder upload doesn't create duplicate folders on retry.
   * `googleParentId` is null for root-level folders.
   */
  findDriveFolderByParentAndName(driveId: string, googleParentId: string | null, name: string) {
    if (googleParentId === null) {
      return this.db
        .prepare(
          'SELECT google_folder_id FROM drive_folders WHERE drive_account_id = ? AND google_parent_id IS NULL AND name = ? AND is_trashed = 0',
        )
        .bind(driveId, name)
        .first<{ google_folder_id: string }>();
    }
    return this.db
      .prepare(
        'SELECT google_folder_id FROM drive_folders WHERE drive_account_id = ? AND google_parent_id = ? AND name = ? AND is_trashed = 0',
      )
      .bind(driveId, googleParentId, name)
      .first<{ google_folder_id: string }>();
  }

  /**
   * Batch-lookup existing folders by parent + names. Returns matching rows.
   * Chunks the names array to respect D1's 100-bind-variable limit
   * (same pattern as file.repository.ts:findExistingForDelta, commit 43ecf57).
   * 2 fixed binds (driveId + googleParentId) + N name binds ≤ 100.
   */
  async findDriveFoldersByParentAndNames(
    driveId: string,
    googleParentId: string | null,
    names: string[],
  ): Promise<{ google_folder_id: string; name: string }[]> {
    if (names.length === 0) return [];

    const CHUNK = D1_MAX_BIND_VARIABLES - 2; // 98 names per query max
    const out: { google_folder_id: string; name: string }[] = [];

    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      assertWithinD1Limit(2 + chunk.length, 'findDriveFoldersByParentAndNames');

      const sql =
        googleParentId === null
          ? `SELECT google_folder_id, name FROM drive_folders
             WHERE drive_account_id = ? AND google_parent_id IS NULL
               AND name IN (${placeholders}) AND is_trashed = 0`
          : `SELECT google_folder_id, name FROM drive_folders
             WHERE drive_account_id = ? AND google_parent_id = ?
               AND name IN (${placeholders}) AND is_trashed = 0`;
      const binds =
        googleParentId === null ? [driveId, ...chunk] : [driveId, googleParentId, ...chunk];
      const { results } = await this.db
        .prepare(sql)
        .bind(...binds)
        .all<{ google_folder_id: string; name: string }>();
      out.push(...(results ?? []));
    }
    return out;
  }

  /**
   * Find a drive folder's `drive_account_id` + `name` by `google_folder_id`,
   * scoped to drives owned by `userId`. Used by `SharedService.resolveFolderTarget`
   * for public shared-link download — the `userId` scope prevents a link from
   * resolving to another user's drive folder (cross-drive leak).
   *
   * Distinct from `findDriveFolderByGoogleId`: that requires `driveId` (scoping
   * to one drive); this scopes by user and returns minimal columns.
   */
  findDriveFolderMetaByGoogleId(googleFolderId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT df.drive_account_id, df.name
         FROM drive_folders df
         JOIN drive_accounts da ON df.drive_account_id = da.id
         WHERE df.google_folder_id = ? AND da.user_id = ?`,
      )
      .bind(googleFolderId, userId)
      .first<{ drive_account_id: string; name: string }>();
  }

  /**
   * Find starred drive folders for a user, with the drive email JOIN.
   * Mirrors `FileRepository.findStarred` (files) for the drive-folders axis.
   * Ordered by `synced_at DESC` (most-recently-synced first).
   */
  findStarredDriveFolders(userId: string) {
    return this.db
      .prepare(
        'SELECT df.*, d.email as driveEmail FROM drive_folders df JOIN drive_accounts d ON df.drive_account_id = d.id WHERE d.user_id = ? AND df.is_starred = 1 AND df.is_trashed = 0 ORDER BY df.synced_at DESC',
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /**
   * Find trashed drive folders for a user, with the drive email JOIN.
   * Mirrors `FileRepository.findTrashed` (files) for the drive-folders axis.
   * Ordered by `created_at DESC`.
   */
  findTrashedDriveFolders(userId: string) {
    return this.db
      .prepare(
        `SELECT df.*, d.email as driveEmail FROM drive_folders df
       JOIN drive_accounts d ON df.drive_account_id = d.id
       WHERE d.user_id = ? AND df.is_trashed = 1
       ORDER BY df.created_at DESC`,
      )
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /** Insert a new drive account (service account flow). */
  insertDriveAccount(params: {
    id: string;
    userId: string;
    googleAccountId: string;
    email: string;
    name: string;
    isPrimary: number;
    rootFolderId: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary, root_folder_id)
       VALUES (?, ?, ?, ?, ?, 'service_account', ?, ?)`,
      )
      .bind(
        params.id,
        params.userId,
        params.googleAccountId,
        params.email,
        params.name,
        params.isPrimary,
        params.rootFolderId,
      )
      .run();
  }
}
