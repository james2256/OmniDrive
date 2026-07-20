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
