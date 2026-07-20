import type { D1Database } from '@cloudflare/workers-types';
import { DriveRepository } from '../repositories/drive.repository';
import { GoogleDriveService } from './google-drive';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';

/**
 * Business logic layer for Google Drive account and folder operations.
 *
 * Drives are user-scoped (not workspace-scoped), so RBAC here is ownership-based:
 * every operation checks `drive_accounts.user_id = ?`.
 */
export class DriveService {
  private driveRepo: DriveRepository;
  private googleDriveService: GoogleDriveService;

  constructor(
    db: D1Database,
    clientId: string,
    clientSecret: string,
    encryptionKey: string,
  ) {
    this.driveRepo = new DriveRepository(db);
    this.googleDriveService = new GoogleDriveService(db, clientId, clientSecret, encryptionKey);
  }

  /** Create a Google Drive folder via the API, then persist to D1 so it appears immediately. */
  async createDriveFolder(userId: string, driveId: string, name: string, parentId?: string): Promise<string> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');

    const googleFolderId = await this.googleDriveService.createFolder(driveId, name, parentId || undefined);

    await this.driveRepo.insertDriveFolder({
      id: generateId(),
      driveAccountId: driveId,
      googleFolderId,
      googleParentId: parentId ?? null,
      name,
      ownedByMe: true,
    });

    return googleFolderId;
  }

  /** Check if the user owns a Drive folder by google_folder_id. Returns true/false. */
  async checkDriveFolderOwnership(userId: string, googleFolderId: string): Promise<boolean> {
    const folder = await this.driveRepo.findOwnedDriveFolderByGoogleId(googleFolderId, userId);
    return !!folder;
  }

  /** Rename a Google Drive folder via the API, then update the cache. */
  async renameDriveFolder(userId: string, driveId: string, googleFolderId: string, name: string): Promise<void> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');

    await this.googleDriveService.renameFile(driveId, googleFolderId, name);
    await this.driveRepo.renameDriveFolder(driveId, googleFolderId, name);
  }

  /** Trash a Google Drive folder via the API, then update the cache. */
  async trashDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');

    await this.googleDriveService.trashFolder(driveId, googleFolderId);
    await this.driveRepo.markDriveFolderTrashed(driveId, googleFolderId);
  }

  /** Restore a trashed Google Drive folder. */
  async restoreDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');

    await this.googleDriveService.untrashFolder(driveId, googleFolderId);
    await this.driveRepo.markDriveFolderUntrashed(driveId, googleFolderId);
  }

  /** Permanently delete a Google Drive folder. Uses deleteFile (Google API treats folders as files). */
  async permanentDeleteDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');

    await this.googleDriveService.deleteFile(driveId, googleFolderId);
    await this.driveRepo.deleteDriveFolder(driveId, googleFolderId);
  }

  /** Star a Google Drive folder (DB only — no Google API call needed). */
  async starDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');
    await this.driveRepo.starDriveFolder(driveId, googleFolderId);
  }

  /** Unstar a Google Drive folder. */
  async unstarDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new AppError(404, 'Drive not found');
    await this.driveRepo.unstarDriveFolder(driveId, googleFolderId);
  }
}
