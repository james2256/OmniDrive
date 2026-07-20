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
