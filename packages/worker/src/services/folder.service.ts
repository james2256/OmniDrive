import type { D1Database } from '@cloudflare/workers-types';
import { FolderRepository } from '../repositories/folder.repository';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import { FileRepository } from '../repositories/file.repository';
import { getWorkspaceRole, hasPermission } from '../middleware/rbac';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { mapFileRow } from '../types';
import type { FileEntry } from '../types';

/**
 * Business logic layer for workspace folder operations.
 *
 * RBAC is preserved exactly as the original routes:
 * - star/unstar: membership only (any role)
 * - deleteFolder: editor
 * - createFolder: membership only (any role can create folders)
 * - addFiles: membership only (any role can add files)
 * - list/getContents: membership only (any role can view)
 *
 * Sync TTL + background sync + GoogleDriveService stay in the route
 * (they use c.executionCtx.waitUntil, which the service can't call).
 */
export class FolderService {
  private folderRepo: FolderRepository;
  private workspaceRepo: WorkspaceRepository;
  private fileRepo: FileRepository;

  constructor(private db: D1Database) {
    this.folderRepo = new FolderRepository(db);
    this.workspaceRepo = new WorkspaceRepository(db);
    this.fileRepo = new FileRepository(db);
  }

  // ─── Existing methods (star/unstar/checkFolderAccess/deleteFolder) ───

  /** Find all folders a user has access to (for GET /tree). */
  findAllFoldersByUser(userId: string) {
    return this.folderRepo.findAllByUser(userId);
  }

  /** Star a folder. RBAC: membership (any role). */
  async starFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepo.findMembership(folderId, userId);
    if (!folder) throw new AppError(404, 'Folder not found or no access');
    await this.folderRepo.star(folderId);
  }

  /** Unstar a folder. RBAC: membership. */
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

  // ─── New: list / get contents (split from GET /:id?) ───

  /** List workspaces as root folders (the no-folderId case). */
  async listWorkspacesAsRootFolders(userId: string) {
    const { results: workspaces } = await this.workspaceRepo.findWorkspacesByUser(userId);
    return workspaces.map((w: Record<string, unknown>) => ({
      id: w.id as string,
      workspaceId: w.id as string,
      name: w.name as string,
      parentId: null,
      icon: '🏢',
      color: '#4A90D9',
      isStarred: false,
      createdAt: w.created_at as string,
      updatedAt: w.updated_at as string,
      lastSyncedAt: null,
      syncStatus: 'idle' as const,
    }));
  }

  /**
   * Get workspace contents (root folders + root files).
   * RBAC: membership only (any role can view).
   */
  async getWorkspaceContents(userId: string, workspaceId: string, cursor: { name: string; id: string } | null, limit: number) {
    const ws = await this.workspaceRepo.findByIdAndMember(workspaceId, userId);
    if (!ws) throw new AppError(404, 'Folder not found or no access');

    const currentFolder = {
      id: (ws as Record<string, unknown>).id as string,
      workspaceId: (ws as Record<string, unknown>).id as string,
      name: (ws as Record<string, unknown>).name as string,
      parentId: null,
      icon: '🏢',
      color: '#4A90D9',
      isStarred: false,
      createdAt: (ws as Record<string, unknown>).created_at as string,
      updatedAt: (ws as Record<string, unknown>).updated_at as string,
      lastSyncedAt: null as string | null,
      syncStatus: 'idle' as 'idle' | 'syncing' | 'error',
    };

    const { results: subRows } = await this.folderRepo.findRootFoldersByWorkspace(workspaceId);
    const subfolders = subRows.map((f: Record<string, unknown>) => ({
      id: f.id as string,
      workspaceId: f.workspace_id as string,
      name: f.name as string,
      parentId: workspaceId,
      icon: (f.icon as string) || '📁',
      color: (f.color as string) || '#4A90D9',
      isStarred: !!f.is_starred,
      metadata: f.metadata,
      createdAt: f.created_at as string,
      updatedAt: f.updated_at as string,
      lastSyncedAt: (f.last_synced_at as string) || null,
      syncStatus: (f.sync_status as 'idle' | 'syncing' | 'error') || 'idle',
    }));

    const { results: fileRows } = await this.fileRepo.findFilesInWorkspaceRoot(workspaceId, cursor, limit);
    let hasMore = false;
    if (fileRows.length > limit) {
      hasMore = true;
      fileRows.pop();
    }
    const files: (FileEntry & { driveEmail: string })[] = fileRows.map((r: Record<string, unknown>) => ({
      ...mapFileRow(r),
      driveEmail: (r.driveEmail as string) || '',
    }));
    let nextCursor: string | null = null;
    if (files.length > 0 && hasMore) {
      const lastFile = files[files.length - 1];
      nextCursor = btoa(JSON.stringify({ name: lastFile.name, id: lastFile.id }));
    }

    const breadcrumb = [
      { id: null, name: 'Home' },
      { id: (ws as Record<string, unknown>).id as string, name: (ws as Record<string, unknown>).name as string },
    ];

    return { currentFolder, subfolders, files, breadcrumb, hasMore, nextCursor };
  }

  /**
   * Get folder contents (subfolders + files).
   * RBAC: membership only (any role can view).
   */
  async getFolderContents(userId: string, folderId: string, cursor: { name: string; id: string } | null, limit: number) {
    const folder = await this.folderRepo.findByIdWithWorkspace(folderId, userId);
    if (!folder) throw new AppError(404, 'Folder not found or no access');

    const f = folder as Record<string, unknown>;
    const currentFolder = {
      id: f.id as string,
      workspaceId: f.workspace_id as string,
      name: f.name as string,
      parentId: (f.parent_id as string) || (f.workspace_id as string),
      icon: (f.icon as string) || '📁',
      color: (f.color as string) || '#4A90D9',
      isStarred: !!f.is_starred,
      metadata: f.metadata,
      createdAt: f.created_at as string,
      updatedAt: f.updated_at as string,
      lastSyncedAt: (f.last_synced_at as string) || null,
      syncStatus: (f.sync_status as string) || 'idle',
    };

    const { results: subRows } = await this.folderRepo.findSubfoldersByParent(folderId);
    const subfolders = subRows.map((sf: Record<string, unknown>) => ({
      id: sf.id as string,
      workspaceId: sf.workspace_id as string,
      name: sf.name as string,
      parentId: folderId,
      icon: (sf.icon as string) || '📁',
      color: (sf.color as string) || '#4A90D9',
      isStarred: !!sf.is_starred,
      metadata: sf.metadata,
      createdAt: sf.created_at as string,
      updatedAt: sf.updated_at as string,
      lastSyncedAt: (sf.last_synced_at as string) || null,
      syncStatus: (sf.sync_status as 'idle' | 'syncing' | 'error') || 'idle',
    }));

    const { results: fileRows } = await this.fileRepo.findFilesInFolder(folderId, cursor, limit);
    let hasMore = false;
    if (fileRows.length > limit) {
      hasMore = true;
      fileRows.pop();
    }
    const files: (FileEntry & { driveEmail: string })[] = fileRows.map((r: Record<string, unknown>) => ({
      ...mapFileRow(r),
      driveEmail: (r.driveEmail as string) || '',
    }));
    let nextCursor: string | null = null;
    if (files.length > 0 && hasMore) {
      const lastFile = files[files.length - 1];
      nextCursor = btoa(JSON.stringify({ name: lastFile.name, id: lastFile.id }));
    }

    const breadcrumb = [
      { id: null, name: 'Home' },
      { id: f.workspace_id as string, name: f.ws_name as string },
      { id: f.id as string, name: f.name as string },
    ];

    return { currentFolder, subfolders, files, breadcrumb, hasMore, nextCursor };
  }

  // ─── New: create / update / addFiles ───

  /**
   * Create a folder or workspace. If no parentId: create workspace.
   * RBAC: membership only (any member can create folders — preserves current behavior).
   */
  async createFolderOrWorkspace(userId: string, params: {
    name: string;
    parentId?: string | null;
    icon?: string;
    color?: string;
  }): Promise<{ id: string; name: string; parentId: string | null }> {
    const { name, parentId, icon, color } = params;

    if (!parentId) {
      const workspaceId = await this.workspaceRepo.createWorkspace(name, userId);
      return { id: workspaceId, name, parentId: null };
    }

    // Check if parentId is a workspace
    const ws = await this.workspaceRepo.findByIdAndMember(parentId, userId);
    let workspaceId = parentId;
    let actualParentId: string | null = null;

    if (!ws) {
      // parentId is a folder — get its workspace_id
      const folder = await this.folderRepo.findParentWorkspace(parentId, userId);
      if (!folder) throw new AppError(404, 'Parent not found or no access');
      workspaceId = folder.workspace_id;
      actualParentId = parentId;
    }

    const id = generateId();
    await this.folderRepo.insert({
      id,
      workspaceId,
      name,
      parentId: actualParentId,
      icon: icon || '📁',
      color: color || '#4A90D9',
    });

    return { id, name, parentId: parentId };
  }

  /**
   * Update a folder or workspace.
   * RBAC: owner (workspace) / membership (folder — preserves current behavior).
   */
  async updateFolderOrWorkspace(userId: string, folderId: string, params: {
    name?: string;
    parentId?: string | null;
    icon?: string;
    color?: string;
  }): Promise<void> {
    // Check if it's a workspace (owner check)
    const ws = await this.workspaceRepo.findByIdAndOwner(folderId, userId);
    if (ws) {
      if (params.name) await this.workspaceRepo.rename(folderId, params.name);
      return;
    }

    // It's a folder — check membership
    const folderMember = await this.folderRepo.findMembership(folderId, userId);
    if (!folderMember) throw new AppError(404, 'Folder not found or no access');

    // Resolve parentId: null means clear (set to null), string means move to that parent
    let resolvedParentId: string | null | undefined = undefined;
    if (params.parentId !== undefined) {
      if (params.parentId === null) {
        resolvedParentId = null;
      } else {
        const parentWs = await this.workspaceRepo.exists(params.parentId);
        resolvedParentId = parentWs ? null : params.parentId;
      }
    }

    await this.folderRepo.updateFields(folderId, {
      name: params.name,
      icon: params.icon,
      color: params.color,
      parentId: resolvedParentId,
    });
  }

  /**
   * Add files to a folder or workspace.
   * RBAC: membership only (any member can add files — preserves current behavior).
   */
  async addFilesToFolder(userId: string, folderId: string, fileIds: string[]): Promise<void> {
    // Check if folderId is a workspace
    const ws = await this.workspaceRepo.findByIdAndMember(folderId, userId);
    let workspaceId = folderId;
    let workspaceFolderId: string | null = null;
    if (!ws) {
      // folderId is a folder — get its workspace_id
      const f = await this.folderRepo.findParentWorkspace(folderId, userId);
      if (f) {
        workspaceId = f.workspace_id;
        workspaceFolderId = folderId;
      }
    }

    await this.fileRepo.batchAssignToFolder(fileIds, userId, workspaceId, workspaceFolderId);
  }

  // ─── New: delete workspace (with file detach) ───

  /**
   * Delete a workspace (owner only). Detaches files first to prevent cascade.
   */
  async deleteWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const ws = await this.workspaceRepo.findByIdAndOwner(workspaceId, userId);
    if (!ws) return false;
    await this.fileRepo.detachFromWorkspace(workspaceId);
    await this.workspaceRepo.delete(workspaceId);
    return true;
  }

  // ─── New: sync helpers (SQL only — waitUntil stays in route) ───

  /** Update sync status to 'syncing'. */
  async markSyncing(folderId: string): Promise<void> {
    await this.folderRepo.updateSyncStatus(folderId, 'syncing');
  }

  /** Update sync status to 'idle' + set last_synced_at. */
  async markSyncComplete(folderId: string): Promise<void> {
    await this.folderRepo.updateSyncComplete(folderId);
  }

  /** Update sync status to 'error'. */
  async markSyncError(folderId: string): Promise<void> {
    await this.folderRepo.updateSyncStatus(folderId, 'error');
  }
}
