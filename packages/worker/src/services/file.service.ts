import type { D1Database } from '@cloudflare/workers-types';
import { FileRepository } from '../repositories/file.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { DriveRepository } from '../repositories/drive.repository';
import type { DriveProvider } from '../types/drive-provider';
import { createDriveService } from '../lib/drive-factory';
import { PolicyService } from './policy.service';
import { getWorkspaceRole, hasPermission } from '../lib/rbac';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { logErrorNoCtx } from '../lib/logger';
import {
  mapFileRow,
  mapFolderRow,
  mapDriveFolderRow,
  mapWorkspaceFolderRow,
  type FileRow,
} from '../types/db';

/**
 * Business logic layer for file operations.
 *
 * All mutation methods include workspace RBAC via assertCanMutate — fixing
 * the 8 gaps in files.ts where routes filtered by `user_id` only (workspace
 * collaborators couldn't act on each other's files). The service uses a
 * **static** import of rbac instead of the dynamic `await import()` the
 * routes previously used.
 */
export class FileService {
  private fileRepo: FileRepository;
  private folderRepo: FolderRepository;
  private driveRepo: DriveRepository;
  private driveProvider: DriveProvider;
  private policyService: PolicyService;

  constructor(
    private db: D1Database,
    clientId: string,
    clientSecret: string,
    encryptionKey: string,
  ) {
    this.fileRepo = new FileRepository(db);
    this.folderRepo = new FolderRepository(db);
    this.driveRepo = new DriveRepository(db);
    this.driveProvider = createDriveService({
      DB: db,
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      TOKEN_ENCRYPTION_KEY: encryptionKey,
    });
    this.policyService = new PolicyService(db, this.driveProvider);
  }

  /**
   * Trash a file. Calls Google Drive API first, then updates D1.
   * RBAC: if file has workspace_id, caller must be 'editor'.
   */
  async trashFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'editor');
    if (file.is_trashed === 1) return; // Idempotent — sync may have already trashed + applied stats delta

    await this.driveProvider.trashFile(file.drive_account_id, file.google_file_id);
    await this.fileRepo.markTrashed(fileId, file.user_id);
    await this.fileRepo.applyStorageDeltas([
      { userId: file.user_id, mimeType: file.mime_type ?? '', delta: -file.size },
    ]);
  }

  /** Restore a trashed file. RBAC: editor. */
  async restoreFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'editor');
    if (file.is_trashed !== 1) throw new NotFoundError('File not found in trash');

    await this.driveProvider.untrashFile(file.drive_account_id, file.google_file_id);
    await this.fileRepo.markUntrashed(fileId, file.user_id);
    await this.fileRepo.applyStorageDeltas([
      { userId: file.user_id, mimeType: file.mime_type ?? '', delta: file.size },
    ]);
  }

  /** Permanently delete a trashed file. RBAC: editor + retention-policy check. */
  async permanentDelete(userId: string, fileId: string): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'editor');
    if (file.is_trashed !== 1) throw new NotFoundError('File not found in trash');

    if (file.workspace_folder_id) {
      const protectedRet = await this.policyService.checkRetentionProtection(
        file.workspace_folder_id,
      );
      if (protectedRet) {
        throw new ForbiddenError('Retention policy prevents deletion');
      }
    }

    try {
      await this.driveProvider.deleteFile(file.drive_account_id, file.google_file_id);
    } catch (error) {
      logErrorNoCtx('Failed to permanently delete file from Google Drive', error, { fileId });
      throw new AppError(500, 'Failed to delete file from Google Drive');
    }

    await this.fileRepo.delete(fileId, file.user_id);

    if (file.workspace_id && file.size) {
      await this.policyService.updateWorkspaceStorage(file.workspace_id, -file.size);
    }
  }

  /** Rename a file. RBAC: editor. Calls Google Drive API first, then updates D1. */
  async renameFile(userId: string, fileId: string, name: string): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'editor');
    await this.driveProvider.renameFile(file.drive_account_id, file.google_file_id, name);
    await this.fileRepo.rename(fileId, file.user_id, name);
  }

  /** Star a file. RBAC: viewer. */
  async starFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'viewer');
    const changed = await this.fileRepo.star(fileId, file.user_id);
    if (!changed) throw new NotFoundError('File not found');
  }

  /** Unstar a file. RBAC: viewer. */
  async unstarFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'viewer');
    const changed = await this.fileRepo.unstar(fileId, file.user_id);
    if (!changed) throw new NotFoundError('File not found');
  }

  /**
   * Move file to a workspace folder (or to personal storage if null).
   *
   * RBAC:
   * - Source: editor on the file's workspace (or owner if personal)
   * - Target: editor on the target workspace
   * - Exfiltration guard: only the file owner can remove a workspace file
   *   to personal storage (prevents editors from exfiltrating shared files)
   */
  async moveToWorkspaceFolder(
    userId: string,
    fileId: string,
    workspaceFolderId: string | null,
  ): Promise<void> {
    const file = await this.getFileOrThrow(fileId, userId, 'editor');

    let workspaceId: string | null = null;

    if (workspaceFolderId) {
      const folder = await this.folderRepo.findParentWorkspace(workspaceFolderId, userId);
      if (!folder) throw new NotFoundError('Folder not found');
      workspaceId = folder.workspace_id;

      // Target RBAC: editor on target workspace.
      // (findParentWorkspace only checks membership, not role.)
      const role = await getWorkspaceRole(this.db, workspaceId, userId);
      if (!role || !hasPermission(role, 'editor')) {
        throw new ForbiddenError();
      }
    } else if (file.workspace_id && file.user_id !== userId) {
      // Exfiltration guard: only the owner can remove a workspace file to personal storage.
      throw new ForbiddenError('Only the file owner can remove it from a workspace');
    }

    // Use file.user_id so the UPDATE affects workspace files owned by other members.
    await this.fileRepo.moveToWorkspaceFolder(fileId, file.user_id, workspaceFolderId, workspaceId);
  }

  /** Update file metadata. RBAC: editor. */
  async updateMetadata(
    userId: string,
    fileId: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.getFileOrThrow(fileId, userId, 'editor');
    await this.fileRepo.updateMetadata(fileId, JSON.stringify(metadata));
  }

  /** Get file for preview/download — includes RBAC check. Returns the file row or throws. */
  async getFileForRead(userId: string, fileId: string): Promise<FileRow> {
    return this.getFileOrThrow(fileId, userId, 'viewer');
  }

  /** Get the DriveProvider instance (for preview/download streaming). // ponytail: remove this accessor — lift downloadFile delegation onto FileService so routes don't bypass the service layer. */
  getDriveProvider(): DriveProvider {
    return this.driveProvider;
  }

  // ─── Listing / search / overview (no RBAC — scoped by user_id + EXISTS) ───

  /** Find the first drive ID associated with files in a folder/workspace. */
  findDriveIdForFolder(folderId: string, userId: string) {
    return this.fileRepo.findDriveIdForFolder(folderId, userId);
  }

  /** Find a file by ID (no RBAC — caller must check ownership). */
  findById(fileId: string) {
    return this.fileRepo.findById(fileId);
  }

  /** Update a file's drive assignment after a move-drive operation. */
  updateDriveAssignment(fileId: string, driveAccountId: string, googleFileId: string) {
    return this.fileRepo.updateDriveAssignment(fileId, driveAccountId, googleFileId);
  }

  /** List recent files + folders for the dashboard. */
  async listRecent(userId: string) {
    const { results: fileRows } = await this.fileRepo.findRecent(userId);
    const { results: folderRows } = await this.folderRepo.findRecentFolders(userId);

    return {
      folder: null,
      subfolders: folderRows.map(mapWorkspaceFolderRow),
      files: fileRows.map((r: Record<string, unknown>) => ({
        ...mapFileRow(r),
        driveEmail: r.driveEmail,
      })),
      breadcrumb: [],
    };
  }

  /** Get file size grouped by category (images, videos, documents, etc.). */
  async getCategoryOverview(userId: string) {
    const { results } = await this.fileRepo.getStorageStats(userId);

    const overview = {
      images: 0,
      videos: 0,
      documents: 0,
      audio: 0,
      archives: 0,
      others: 0,
    };

    for (const row of results) {
      const mime = row.mime_type || '';
      const size = row.total_size || 0;

      if (mime.startsWith('image/') || mime === 'application/vnd.google-apps.photo') {
        overview.images += size;
      } else if (mime.startsWith('video/') || mime === 'application/vnd.google-apps.video') {
        overview.videos += size;
      } else if (mime.startsWith('audio/') || mime === 'application/vnd.google-apps.audio') {
        overview.audio += size;
      } else if (
        mime.includes('pdf') ||
        mime.includes('document') ||
        mime.includes('msword') ||
        mime.includes('excel') ||
        mime.includes('spreadsheet') ||
        mime.includes('powerpoint') ||
        mime.includes('presentation') ||
        mime.startsWith('text/') ||
        mime === 'application/vnd.google-apps.document' ||
        mime === 'application/vnd.google-apps.spreadsheet' ||
        mime === 'application/vnd.google-apps.presentation' ||
        mime === 'application/vnd.google-apps.jam' ||
        mime === 'application/vnd.google-apps.form'
      ) {
        overview.documents += size;
      } else if (
        mime.includes('zip') ||
        mime.includes('rar') ||
        mime.includes('tar') ||
        mime.includes('gzip') ||
        mime === 'application/x-7z-compressed' ||
        mime === 'application/vnd.rar' ||
        mime === 'application/x-zip-compressed'
      ) {
        overview.archives += size;
      } else if (
        mime === 'application/vnd.google-apps.folder' ||
        mime === 'application/vnd.google-apps.shortcut'
      ) {
        // ignore folders and shortcuts
      } else {
        overview.others += size;
      }
    }

    return overview;
  }

  /** Search files + folders by name, workspace, and metadata. */
  async searchFiles(
    userId: string,
    query: string | null,
    workspaceId: string | null,
    metadataRaw: string | null,
  ) {
    let metadata: Record<string, string> | null = null;
    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        // ignore invalid json
      }
    }

    const { results: fileRows } = await this.fileRepo.searchFiles(
      userId,
      query,
      workspaceId,
      metadata,
    );

    // Folders are only searched when there's a text query — metadata-only
    // search doesn't apply to folders.
    const trimmedQuery = query?.trim() ?? '';
    let folderRows: Record<string, unknown>[] = [];
    let driveFolderRows: Record<string, unknown>[] = [];

    if (trimmedQuery) {
      const folderResult = await this.folderRepo.searchFolders(userId, trimmedQuery);
      folderRows = folderResult.results as Record<string, unknown>[];

      const driveFolderResult = await this.driveRepo.searchFolders(userId, trimmedQuery);
      driveFolderRows = driveFolderResult.results as Record<string, unknown>[];
    }

    return {
      folder: null,
      subfolders: [
        ...folderRows.map(mapFolderRow),
        ...driveFolderRows.map((r: Record<string, unknown>) => ({
          ...mapDriveFolderRow(r),
          driveEmail: r.driveEmail,
        })),
      ],
      files: fileRows.map((r: Record<string, unknown>) => ({
        ...mapFileRow(r),
        driveEmail: r.driveEmail,
      })),
      breadcrumb: [],
      query: query || '',
    };
  }

  /** Get starred files + folders + drive folders. */
  async getStarred(userId: string) {
    const { results: fileRows } = await this.fileRepo.findStarred(userId);

    const { results: folderRows } = await this.folderRepo.findStarredFolders(userId);

    const { results: driveFolderRows } = await this.driveRepo.findStarredDriveFolders(userId);

    return {
      folder: null,
      subfolders: [
        ...folderRows.map(mapFolderRow),
        ...driveFolderRows.map((r: Record<string, unknown>) => ({
          ...mapDriveFolderRow(r),
          driveEmail: r.driveEmail,
        })),
      ],
      files: fileRows.map((r: Record<string, unknown>) => ({
        ...mapFileRow(r),
        driveEmail: r.driveEmail,
      })),
      breadcrumb: [],
    };
  }

  /** Get trashed files + drive folders. */
  async getTrash(userId: string) {
    const { results: fileRows } = await this.fileRepo.findTrashed(userId);

    const { results: folderRows } = await this.driveRepo.findTrashedDriveFolders(userId);

    return {
      folder: null,
      subfolders: folderRows.map((r: Record<string, unknown>) => ({
        ...mapDriveFolderRow(r),
        driveEmail: r.driveEmail,
      })),
      files: fileRows.map((r: Record<string, unknown>) => ({
        ...mapFileRow(r),
        driveEmail: r.driveEmail,
      })),
      breadcrumb: [],
    };
  }

  /**
   * Get file + source drive info for move-drive operation.
   * RBAC: user ownership (f.user_id = ?).
   * Google API orchestration (share/copy/trash/rollback) stays in the route.
   */
  async getForMoveDrive(userId: string, fileId: string) {
    const file = await this.fileRepo.findForMoveDrive(fileId, userId);
    if (!file) throw new NotFoundError('File not found');
    return file;
  }

  /**
   * Finalize upload: insert the uploaded file into D1.
   * Returns the created file row.
   */
  async finalizeUpload(
    userId: string,
    params: {
      id: string;
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
    },
  ): Promise<FileRow | null> {
    const created = await this.fileRepo.insertUploaded({
      ...params,
      userId,
    });
    // Best-effort — a failure here only affects the "Storage by type" chart,
    // not the file record or quota. recomputeStorageStats() is the backstop.
    try {
      await this.fileRepo.applyStorageDeltas([
        { userId, mimeType: params.mimeType ?? '', delta: params.size },
      ]);
    } catch (err) {
      logErrorNoCtx('applyStorageDeltas failed (non-fatal)', err);
    }
    return created;
  }

  /**
   * Find a file by ID, throw NotFoundError if missing, then assert RBAC.
   * Collapses the repeated findById → 404 → assertCanMutate pattern.
   */
  private async getFileOrThrow(
    fileId: string,
    userId: string,
    permission: 'viewer' | 'editor',
  ): Promise<FileRow> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new NotFoundError('File not found');
    await this.assertCanMutate(file, userId, permission);
    return file;
  }

  /**
   * Assert that the user can mutate the file.
   * - If file is in a workspace: caller must have the required role
   * - If file is personal: caller must be the owner
   */
  private async assertCanMutate(
    file: FileRow,
    userId: string,
    permission: 'viewer' | 'editor',
  ): Promise<void> {
    if (file.workspace_id) {
      const role = await getWorkspaceRole(this.db, file.workspace_id, userId);
      if (!role || !hasPermission(role, permission)) {
        throw new ForbiddenError();
      }
    } else if (file.user_id !== userId) {
      throw new ForbiddenError();
    }
  }
}
