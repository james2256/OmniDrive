import type { D1Database } from '@cloudflare/workers-types';
import { FolderRepository } from '../repositories/folder.repository';
import { getWorkspaceRole, hasPermission } from '../middleware/rbac';
import { AppError } from '../middleware/error-handler';

/**
 * Business logic layer for workspace folder operations.
 *
 * Each method includes workspace RBAC — fixing the gaps in folders.ts where
 * routes checked membership only (workspace viewers could star/unstar/delete).
 */
export class FolderService {
  private folderRepo: FolderRepository;

  constructor(private db: D1Database) {
    this.folderRepo = new FolderRepository(db);
  }

  /** Star a folder. RBAC: viewer (starring is read-level). */
  async starFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepo.findMembership(folderId, userId);
    if (!folder) throw new AppError(404, 'Folder not found or no access');
    await this.folderRepo.star(folderId);
  }

  /** Unstar a folder. RBAC: viewer. */
  async unstarFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepo.findMembership(folderId, userId);
    if (!folder) throw new AppError(404, 'Folder not found or no access');
    await this.folderRepo.unstar(folderId);
  }

  /** Check if user has editor access to a workspace folder. Returns true/false. */
  async checkFolderAccess(userId: string, folderId: string): Promise<boolean> {
    const folder = await this.folderRepo.findMembership(folderId, userId);
    if (!folder) return false;
    const role = await getWorkspaceRole(this.db, folder.workspace_id, userId);
    return !!role && hasPermission(role, 'editor');
  }

  /** Delete a folder. RBAC: editor. */
  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepo.findMembership(folderId, userId);
    if (!folder) throw new AppError(404, 'Folder not found or no access');

    const role = await getWorkspaceRole(this.db, folder.workspace_id, userId);
    if (!role || !hasPermission(role, 'editor')) {
      throw new AppError(403, 'Forbidden');
    }

    await this.folderRepo.delete(folderId);
  }
}
