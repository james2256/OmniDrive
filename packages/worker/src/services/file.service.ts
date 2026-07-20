import type { D1Database } from '@cloudflare/workers-types';
import { FileRepository } from '../repositories/file.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { GoogleDriveService } from './google-drive';
import { PolicyService } from './policy.service';
import { getWorkspaceRole, hasPermission } from '../middleware/rbac';
import { AppError } from '../middleware/error-handler';
import type { FileRow } from '../types';

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
  private driveService: GoogleDriveService;
  private policyService: PolicyService;

  constructor(
    private db: D1Database,
    clientId: string,
    clientSecret: string,
    encryptionKey: string,
  ) {
    this.fileRepo = new FileRepository(db);
    this.folderRepo = new FolderRepository(db);
    this.driveService = new GoogleDriveService(db, clientId, clientSecret, encryptionKey);
    this.policyService = new PolicyService(db);
  }

  /**
   * Trash a file. Calls Google Drive API first, then updates D1.
   * RBAC: if file has workspace_id, caller must be 'editor'.
   */
  async trashFile(userId: string, fileId: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    await this.assertCanMutate(file, userId, 'editor');

    await this.driveService.trashFile(file.drive_account_id, file.google_file_id);
    await this.fileRepo.markTrashed(fileId, file.user_id);
  }

  /** Restore a trashed file. RBAC: editor. */
  async restoreFile(userId: string, fileId: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');
    if (file.is_trashed !== 1) throw new AppError(404, 'File not found in trash');

    await this.assertCanMutate(file, userId, 'editor');

    await this.driveService.untrashFile(file.drive_account_id, file.google_file_id);
    await this.fileRepo.markUntrashed(fileId, file.user_id);
  }

  /** Permanently delete a trashed file. RBAC: editor + retention-policy check. */
  async permanentDelete(userId: string, fileId: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');
    if (file.is_trashed !== 1) throw new AppError(404, 'File not found in trash');

    await this.assertCanMutate(file, userId, 'editor');

    if (file.workspace_folder_id) {
      const protectedRet = await this.policyService.checkRetentionProtection(file.workspace_folder_id);
      if (protectedRet) {
        throw new AppError(403, 'Retention policy prevents deletion');
      }
    }

    try {
      await this.driveService.deleteFile(file.drive_account_id, file.google_file_id);
    } catch (error) {
      console.error('Failed to permanently delete file from Google Drive:', error);
      throw new AppError(500, 'Failed to delete file from Google Drive');
    }

    await this.fileRepo.delete(fileId, file.user_id);

    if (file.workspace_id && file.size) {
      await this.policyService.updateWorkspaceStorage(file.workspace_id, -file.size);
    }
  }

  /** Rename a file. RBAC: editor. */
  async renameFile(userId: string, fileId: string, name: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    await this.assertCanMutate(file, userId, 'editor');
    await this.fileRepo.rename(fileId, file.user_id, name);
  }

  /** Star a file. RBAC: viewer. */
  async starFile(userId: string, fileId: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    await this.assertCanMutate(file, userId, 'viewer');
    const changed = await this.fileRepo.star(fileId, file.user_id);
    if (!changed) throw new AppError(404, 'File not found');
  }

  /** Unstar a file. RBAC: viewer. */
  async unstarFile(userId: string, fileId: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    await this.assertCanMutate(file, userId, 'viewer');
    const changed = await this.fileRepo.unstar(fileId, file.user_id);
    if (!changed) throw new AppError(404, 'File not found');
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
    userId: string, fileId: string, workspaceFolderId: string | null,
  ): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    // Source RBAC: editor on source workspace, or owner if personal.
    await this.assertCanMutate(file, userId, 'editor');

    let workspaceId: string | null = null;

    if (workspaceFolderId) {
      const folder = await this.folderRepo.findParentWorkspace(workspaceFolderId, userId);
      if (!folder) throw new AppError(404, 'Folder not found');
      workspaceId = folder.workspace_id;

      // Target RBAC: editor on target workspace.
      // (findParentWorkspace only checks membership, not role.)
      const role = await getWorkspaceRole(this.db, workspaceId, userId);
      if (!role || !hasPermission(role, 'editor')) {
        throw new AppError(403, 'Forbidden');
      }
    } else if (file.workspace_id && file.user_id !== userId) {
      // Exfiltration guard: only the owner can remove a workspace file to personal storage.
      throw new AppError(403, 'Only the file owner can remove it from a workspace');
    }

    // Use file.user_id so the UPDATE affects workspace files owned by other members.
    await this.fileRepo.moveToWorkspaceFolder(fileId, file.user_id, workspaceFolderId, workspaceId);
  }

  /** Update file metadata. RBAC: editor. */
  async updateMetadata(userId: string, fileId: string, metadata: Record<string, string>): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    await this.assertCanMutate(file, userId, 'editor');
    await this.fileRepo.updateMetadata(fileId, JSON.stringify(metadata));
  }

  /** Get file for preview/download — includes RBAC check. Returns the file row or throws. */
  async getFileForRead(userId: string, fileId: string): Promise<FileRow> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new AppError(404, 'File not found');

    if (file.workspace_id) {
      const role = await getWorkspaceRole(this.db, file.workspace_id, userId);
      if (!role || !hasPermission(role, 'viewer')) {
        throw new AppError(403, 'Forbidden');
      }
    } else if (file.user_id !== userId) {
      throw new AppError(403, 'Forbidden');
    }

    return file;
  }

  /** Get the GoogleDriveService instance (for preview/download streaming). */
  getGoogleDriveService(): GoogleDriveService {
    return this.driveService;
  }

  /**
   * Assert that the user can mutate the file.
   * - If file is in a workspace: caller must have the required role
   * - If file is personal: caller must be the owner
   */
  private async assertCanMutate(file: FileRow, userId: string, permission: 'viewer' | 'editor'): Promise<void> {
    if (file.workspace_id) {
      const role = await getWorkspaceRole(this.db, file.workspace_id, userId);
      if (!role || !hasPermission(role, permission)) {
        throw new AppError(403, 'Forbidden');
      }
    } else if (file.user_id !== userId) {
      throw new AppError(403, 'Forbidden');
    }
  }
}
