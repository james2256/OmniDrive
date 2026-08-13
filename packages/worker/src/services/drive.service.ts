import type { D1Database } from '@cloudflare/workers-types';
import { DriveRepository } from '../repositories/drive.repository';
import type { DriveProvider } from '../types/drive-provider';
import { NotFoundError, ForbiddenError } from '../lib/errors';
import { generateId } from '../lib/id';
import { encodeCursor } from '../lib/cursor';
import { mapDriveRow, mapFileRow, mapDriveFolderRow } from '../types/db';

/**
 * Business logic layer for Google Drive account and folder operations.
 *
 * Drives are user-scoped (not workspace-scoped), so RBAC here is ownership-based:
 * every operation checks `drive_accounts.user_id = ?`.
 */
export class DriveService {
  private driveRepo: DriveRepository;
  private driveProvider: DriveProvider;

  constructor(db: D1Database, driveProvider: DriveProvider) {
    this.driveRepo = new DriveRepository(db);
    this.driveProvider = driveProvider;
  }

  /** Find a drive by ID + user, throw NotFoundError if missing/unauthorized. */
  private async getDriveOrThrow(driveId: string, userId: string) {
    const drive = await this.driveRepo.findByIdAndUser(driveId, userId);
    if (!drive) throw new NotFoundError('Drive not found');
    return drive;
  }

  /** Create a Google Drive folder via the API, then persist to D1 so it appears immediately. */
  async createDriveFolder(
    userId: string,
    driveId: string,
    name: string,
    parentId?: string,
  ): Promise<string> {
    await this.getDriveOrThrow(driveId, userId);

    const googleFolderId = await this.driveProvider.createFolder(
      driveId,
      name,
      parentId || undefined,
    );

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

  /** Rename a Google Drive folder via the API, then update the cache. */
  async renameDriveFolder(
    userId: string,
    driveId: string,
    googleFolderId: string,
    name: string,
  ): Promise<void> {
    await this.getDriveOrThrow(driveId, userId);
    await this.driveProvider.renameFile(driveId, googleFolderId, name);
    await this.driveRepo.renameDriveFolder(driveId, googleFolderId, name);
  }

  /** Trash a Google Drive folder via the API, then update the cache. */
  async trashDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    await this.getDriveOrThrow(driveId, userId);
    await this.driveProvider.trashFolder(driveId, googleFolderId);
    await this.driveRepo.markDriveFolderTrashed(driveId, googleFolderId);
  }

  /** Restore a trashed Google Drive folder. */
  async restoreDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    await this.getDriveOrThrow(driveId, userId);
    await this.driveProvider.untrashFolder(driveId, googleFolderId);
    await this.driveRepo.markDriveFolderUntrashed(driveId, googleFolderId);
  }

  /** Permanently delete a Google Drive folder. Uses deleteFile (Google API treats folders as files). */
  async permanentDeleteDriveFolder(
    userId: string,
    driveId: string,
    googleFolderId: string,
  ): Promise<void> {
    await this.getDriveOrThrow(driveId, userId);
    await this.driveProvider.deleteFile(driveId, googleFolderId);
    await this.driveRepo.deleteDriveFolder(driveId, googleFolderId);
  }

  /** Star a Google Drive folder via the API, then update the cache. */
  async starDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    await this.getDriveOrThrow(driveId, userId);
    await this.driveProvider.starFolder(driveId, googleFolderId);
    await this.driveRepo.starDriveFolder(driveId, googleFolderId);
  }

  /** Unstar a Google Drive folder via the API, then update the cache. */
  async unstarDriveFolder(userId: string, driveId: string, googleFolderId: string): Promise<void> {
    await this.getDriveOrThrow(driveId, userId);
    await this.driveProvider.unstarFolder(driveId, googleFolderId);
    await this.driveRepo.unstarDriveFolder(driveId, googleFolderId);
  }

  // ─── New: listing, external, move, disconnect ───

  /** Find a drive by ID + user (returns {id, email} or null). RBAC: ownership. */
  findByIdAndUser(driveId: string, userId: string) {
    return this.driveRepo.findByIdAndUser(driveId, userId);
  }

  /** Find all drives associated with files in a folder/workspace (for sync). */
  findDrivesForFolder(folderId: string, userId: string) {
    return this.driveRepo.findDrivesForFolder(folderId, userId);
  }

  /** Find the primary drive ID for a user. */
  findPrimaryDriveId(userId: string) {
    return this.driveRepo.findPrimaryDriveId(userId);
  }

  /** Find drives that have tokens, from a list of drive IDs. */
  async findDrivesWithTokens(driveIds: string[]) {
    return this.driveRepo.findDrivesWithTokens(driveIds);
  }

  /** Delete quota cache entries for a drive. */
  deleteQuotaCache(driveId: string) {
    return this.driveRepo.deleteQuotaCache(driveId);
  }

  /** Upsert drive tokens (INSERT ... ON CONFLICT UPDATE). */
  upsertTokens(driveId: string, encryptedTokens: string, updatedAt: number) {
    return this.driveRepo.upsertTokens(driveId, encryptedTokens, updatedAt);
  }

  /** Find a drive by ID (no user check — used after creation). */
  findById(driveId: string) {
    return this.driveRepo.findById(driveId);
  }

  /** List all drives with sync state. RBAC: user ownership. */
  async listDrives(userId: string) {
    const { results } = await this.driveRepo.findAllWithSyncState(userId);
    return results.map(mapDriveRow);
  }

  /** Get folders + files for the external items page. RBAC: user ownership. */
  async listExternal(userId: string, cursor: { name: string; id: string } | null, limit = 50) {
    const { results: folderRows } = await this.driveRepo.findExternalFolders(userId);
    const { results: fileRows } = await this.driveRepo.findExternalFiles(userId, cursor, limit);

    let hasMore = false;
    if (fileRows.length > limit) {
      hasMore = true;
      fileRows.pop();
    }
    const files = fileRows.map((r: Record<string, unknown>) => ({
      ...mapFileRow(r),
      driveEmail: r.driveEmail,
      driveId: r.drive_account_id,
    }));
    let nextCursor: string | null = null;
    if (files.length > 0 && hasMore) {
      const last = files[files.length - 1];
      nextCursor = encodeCursor({ name: last.name, id: last.id });
    }

    return {
      folder: null,
      subfolders: folderRows.map((r: Record<string, unknown>) => ({
        ...mapDriveFolderRow(r),
        driveEmail: r.driveEmail,
        driveId: r.drive_account_id,
      })),
      files,
      breadcrumb: [],
      pagination: { hasMore, nextCursor },
    };
  }

  /**
   * Move a file or folder within the same drive.
   * RBAC: user ownership (drive + item owned_by_me).
   * Google API call + DB parent update.
   */
  async moveItemWithinDrive(
    userId: string,
    driveId: string,
    googleFileId: string,
    targetFolderId: string,
    oldParentId: string | null,
    isFolder: boolean,
  ): Promise<void> {
    const drive = await this.driveRepo.findForMove(driveId, userId);
    if (!drive) throw new NotFoundError('Drive not found');

    // Verify item ownership (can't move files you don't own)
    const item = await this.driveRepo.findItemOwnership(driveId, googleFileId, isFolder);
    if (!item) throw new NotFoundError('Item not found');
    if (item.owned_by_me !== 1) throw new ForbiddenError('You can only move items you own');

    // Resolve root folder ID
    const rootFolderId = drive.root_folder_id || 'root';
    const effectiveTargetId = targetFolderId === 'root' ? rootFolderId : targetFolderId;
    const effectiveOldParentId =
      !oldParentId || oldParentId === '__shared__'
        ? null
        : oldParentId === 'root'
          ? rootFolderId
          : oldParentId;

    await this.driveProvider.moveToFolder(
      driveId,
      googleFileId,
      effectiveTargetId,
      effectiveOldParentId,
    );

    // Update DB — folders at root use NULL, files at root use 'root' (matches resolveParentId convention)
    const dbParentId = targetFolderId === 'root' ? (isFolder ? null : 'root') : targetFolderId;
    await this.driveRepo.updateItemParent(driveId, googleFileId, dbParentId, isFolder);
  }

  /**
   * Disconnect a drive. RBAC: user ownership.
   * Revokes tokens (Google API), deletes drive, sets new primary, deletes tokens.
   */
  async disconnectDrive(userId: string, driveId: string): Promise<void> {
    const row = await this.driveRepo.findFullByIdAndUser(driveId, userId);
    if (!row) throw new NotFoundError('Drive not found');

    const wasPrimary = (row as Record<string, unknown>).is_primary === 1;
    const driveType = (row as Record<string, unknown>).type as string;

    if (driveType === 'oauth') {
      await this.driveProvider.revokeTokens(driveId);
    }

    await this.driveRepo.deleteDrive(driveId, userId);

    if (wasPrimary) {
      const next = await this.driveRepo.findNextDrive(userId);
      if (next) {
        await this.driveRepo.setPrimary(next.id);
      }
    }
  }

  /** Get the DriveProvider instance (for routes that need Google API directly). // ponytail: remove this accessor — lift the delegation onto DriveService so routes don't bypass the service layer. */
  getDriveProvider(): DriveProvider {
    return this.driveProvider;
  }
}
