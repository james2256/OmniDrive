import type { D1Database } from '@cloudflare/workers-types';

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
    return this.db.prepare('SELECT id, email FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId).first<{ id: string; email: string }>();
  }

  /** Find all drives for a user with sync state (LEFT JOIN sync_state). */
  findAllWithSyncState(userId: string) {
    return this.db.prepare(
      'SELECT a.*, s.status as sync_status, s.last_synced_at, s.error_message as sync_error_message, CASE WHEN s.next_page_token IS NOT NULL THEN 1 ELSE 0 END as sync_paused FROM drive_accounts a LEFT JOIN sync_state s ON a.id = s.drive_account_id WHERE a.user_id = ?'
    ).bind(userId).all();
  }

  /** Find a drive by ID + user (full row). */
  findFullByIdAndUser(driveId: string, userId: string) {
    return this.db.prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId).first();
  }

  /** Find drive with root_folder_id for move operation. */
  findForMove(driveId: string, userId: string) {
    return this.db.prepare('SELECT id, root_folder_id FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId).first<{ id: string; root_folder_id: string | null }>();
  }

  /** Check if a drive has valid tokens (for health check). */
  findTokenStatus(driveId: string) {
    return this.db.prepare('SELECT 1 as ok FROM drive_tokens WHERE drive_account_id = ?')
      .bind(driveId).first<{ ok: number }>();
  }

  /** Find the next drive (by created_at) to set as primary after deletion. */
  findNextDrive(userId: string) {
    return this.db.prepare('SELECT id FROM drive_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
      .bind(userId).first<{ id: string }>();
  }

  // ─── drive_accounts mutations ───

  /** Update quota (total + used). */
  updateQuota(driveId: string, totalQuota: number, usedQuota: number) {
    return this.db.prepare('UPDATE drive_accounts SET total_quota = ?, used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(totalQuota, usedQuota, driveId).run();
  }

  /** Update used quota only. */
  updateUsedQuota(driveId: string, usedQuota: number) {
    return this.db.prepare('UPDATE drive_accounts SET used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(usedQuota, driveId).run();
  }

  /** Set a drive as primary. */
  setPrimary(driveId: string) {
    return this.db.prepare('UPDATE drive_accounts SET is_primary = 1 WHERE id = ?')
      .bind(driveId).run();
  }

  /** Delete a drive account. */
  deleteDrive(driveId: string, userId: string) {
    return this.db.prepare('DELETE FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId).run();
  }

  /** Delete tokens for a drive. */
  deleteTokens(driveId: string) {
    return this.db.prepare('DELETE FROM drive_tokens WHERE drive_account_id = ?')
      .bind(driveId).run();
  }

  // ─── shared-with-me reads ───

  /** Find shared folders (google_parent_id = '__shared__', owned_by_me = 1). */
  findSharedFolders(userId: string) {
    return this.db.prepare(
      `SELECT df.*, d.email as driveEmail FROM drive_folders df
       JOIN drive_accounts d ON df.drive_account_id = d.id
       WHERE d.user_id = ? AND df.google_parent_id = ? AND df.owned_by_me = 1 AND df.is_trashed = 0
       ORDER BY df.name ASC`
    ).bind(userId, '__shared__').all();
  }

  /** Find shared files (google_parent_id = '__shared__', owned_by_me = 1). */
  findSharedFiles(userId: string) {
    return this.db.prepare(
      `SELECT f.*, d.email as driveEmail FROM files f
       JOIN drive_accounts d ON f.drive_account_id = d.id
       WHERE f.user_id = ? AND f.google_parent_id = ? AND f.owned_by_me = 1 AND f.is_trashed = 0
       ORDER BY f.name ASC`
    ).bind(userId, '__shared__').all();
  }

  // ─── item ownership + parent update (for move within drive) ───

  /** Check item ownership (drive_folders or files table). */
  findItemOwnership(driveId: string, googleId: string, isFolder: boolean) {
    const table = isFolder ? 'drive_folders' : 'files';
    const idCol = isFolder ? 'google_folder_id' : 'google_file_id';
    return this.db.prepare(`SELECT owned_by_me FROM ${table} WHERE drive_account_id = ? AND ${idCol} = ?`)
      .bind(driveId, googleId).first<{ owned_by_me: number }>();
  }

  /** Update item parent (drive_folders or files table). */
  updateItemParent(driveId: string, googleId: string, newParentId: string | null, isFolder: boolean) {
    if (isFolder) {
      return this.db.prepare('UPDATE drive_folders SET google_parent_id = ? WHERE drive_account_id = ? AND google_folder_id = ?')
        .bind(newParentId, driveId, googleId).run();
    }
    return this.db.prepare('UPDATE files SET google_parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE drive_account_id = ? AND google_file_id = ?')
      .bind(newParentId, driveId, googleId).run();
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
    return this.db.prepare(
      `INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, is_synced, owned_by_me)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      params.id, params.driveAccountId, params.googleFolderId,
      params.googleParentId, params.name, params.ownedByMe ? 1 : 0,
    ).run();
  }

  /** Check if the user owns a Drive folder by google_folder_id. */
  findOwnedDriveFolderByGoogleId(googleFolderId: string, userId: string) {
    return this.db.prepare(
      `SELECT df.id FROM drive_folders df
       JOIN drive_accounts d ON df.drive_account_id = d.id
       WHERE d.user_id = ? AND df.google_folder_id = ? AND df.owned_by_me = 1`
    ).bind(userId, googleFolderId).first();
  }

  markDriveFolderTrashed(driveId: string, googleFolderId: string) {
    return this.db.prepare('UPDATE drive_folders SET is_trashed = 1 WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId).run();
  }

  markDriveFolderUntrashed(driveId: string, googleFolderId: string) {
    return this.db.prepare('UPDATE drive_folders SET is_trashed = 0 WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId).run();
  }

  starDriveFolder(driveId: string, googleFolderId: string) {
    return this.db.prepare('UPDATE drive_folders SET is_starred = 1 WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId).run();
  }

  unstarDriveFolder(driveId: string, googleFolderId: string) {
    return this.db.prepare('UPDATE drive_folders SET is_starred = 0 WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId).run();
  }

  renameDriveFolder(driveId: string, googleFolderId: string, name: string) {
    return this.db.prepare('UPDATE drive_folders SET name = ? WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(name, driveId, googleFolderId).run();
  }

  deleteDriveFolder(driveId: string, googleFolderId: string) {
    return this.db.prepare('DELETE FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
      .bind(driveId, googleFolderId).run();
  }
}
