import type { D1Database } from '@cloudflare/workers-types';
import { SharedRepository } from '../repositories/shared.repository';
import { FileRepository } from '../repositories/file.repository';
import { DriveRepository } from '../repositories/drive.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { hashSharedPassword } from '../lib/password';
import { validateWebhookUrlAsync } from '../lib/validation';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { getWorkspaceRole, hasPermission } from '../lib/rbac';
import { mapSharedLinkRow, mapFileRow } from '../types';
import type { SharedLink, FileRow, FileEntry } from '../types';

/**
 * Business logic layer for shared links.
 *
 * Owns: RBAC (ownership + workspace editor), password hashing, webhook
 * validation, unique slug generation (delegated to repo), download count
 * enforcement.
 *
 * Does NOT own: SQL (that's SharedRepository), HTTP parsing (that's the
 * route), Google Drive streaming (that's GoogleDriveService, called by
 * the route for download).
 *
 * Uses the same RBAC pattern as FileService.assertCanMutate (replicated
 * inline because assertCanMutate is private).
 */
export class SharedService {
  private sharedRepo: SharedRepository;
  private fileRepo: FileRepository;
  private folderRepo: FolderRepository;
  private driveRepo: DriveRepository;

  constructor(private db: D1Database) {
    this.sharedRepo = new SharedRepository(db);
    this.fileRepo = new FileRepository(db);
    this.folderRepo = new FolderRepository(db);
    this.driveRepo = new DriveRepository(db);
  }

  // ─── Management endpoints (require auth) ───

  /**
   * Create a shared link.
   * RBAC: caller must own the file OR be an editor of the file's workspace.
   * Returns the generated link ID (route builds the full URL).
   */
  async createLink(userId: string, params: {
    targetType: 'file' | 'folder';
    targetId: string;
    password?: string;
    expiresAt?: string | null;
    allowDownloads: boolean;
    allowUploads: boolean;
    maxDownloads?: number | null;
    requireEmail: boolean;
    webhookUrl?: string | null;
  }): Promise<string> {
    // RBAC: verify ownership/workspace access
    await this.assertCanShare(userId, params.targetType, params.targetId);

    // Webhook validation
    if (params.webhookUrl) {
      const err = await validateWebhookUrlAsync(params.webhookUrl);
      if (err) throw new AppError(400, err);
    }

    // Password hashing
    const passwordHash = params.password ? await hashSharedPassword(params.password) : null;

    // Insert with unique slug retry
    return this.sharedRepo.insertWithUniqueSlug({
      userId,
      targetType: params.targetType,
      targetId: params.targetId,
      passwordHash,
      expiresAt: params.expiresAt ?? null,
      allowDownloads: params.allowDownloads,
      allowUploads: params.allowUploads,
      maxDownloads: params.maxDownloads ?? null,
      requireEmail: params.requireEmail,
      webhookUrl: params.webhookUrl ?? null,
    });
  }

  /** List all shared links for a user. */
  async listLinks(userId: string): Promise<SharedLink[]> {
    const { results } = await this.sharedRepo.findAllByUserWithTargetName(userId);
    return results.map(r => mapSharedLinkRow(r as Record<string, unknown>));
  }

  /**
   * Update a shared link.
   * Handles the null=clear vs undefined=keep distinction.
   */
  async updateLink(userId: string, id: string, body: {
    password?: string | null;
    expiresAt?: string | null;
    allowDownloads?: boolean;
    allowUploads?: boolean;
    maxDownloads?: number | null;
    requireEmail?: boolean;
    webhookUrl?: string | null;
  }): Promise<void> {
    const existing = await this.sharedRepo.findByIdAndUser(id, userId);
    if (!existing) throw new NotFoundError('Link not found');

    // Distinguish undefined (keep existing) from null (clear) from value (set new)
    const expiresAt = body.expiresAt === undefined ? existing.expires_at : body.expiresAt;
    const allowDownloads = body.allowDownloads ?? (existing.allow_downloads === 1);
    const allowUploads = body.allowUploads ?? (existing.allow_uploads === 1);
    const maxDownloads = body.maxDownloads === undefined ? existing.max_downloads : body.maxDownloads;
    const requireEmail = body.requireEmail ?? (existing.require_email === 1);
    const webhookUrl = body.webhookUrl === undefined ? existing.webhook_url : body.webhookUrl;

    if (allowUploads) {
      throw new AppError(400, 'Uploads via shared links are not yet supported');
    }

    if (webhookUrl && webhookUrl !== existing.webhook_url) {
      const err = await validateWebhookUrlAsync(webhookUrl);
      if (err) throw new AppError(400, err);
    }

    let passwordHash = existing.password_hash;
    if (body.password !== undefined) {
      passwordHash = (body.password === null || body.password === '')
        ? null
        : await hashSharedPassword(body.password);
    }

    const changes = await this.sharedRepo.update(id, userId, {
      expiresAt: expiresAt || null,
      allowDownloads,
      allowUploads,
      maxDownloads,
      requireEmail,
      webhookUrl,
      passwordHash,
    });

    if (changes === 0) throw new NotFoundError('Link not found or no changes made');
  }

  /** Delete a shared link. */
  async deleteLink(userId: string, id: string): Promise<void> {
    await this.sharedRepo.delete(id, userId);
  }

  // ─── Public endpoints (no auth) ───

  /** Get shared link metadata + target file/folder name (for public preview). */
  async getPublicMeta(id: string): Promise<{ link: SharedLink; target?: FileEntry; targetName?: string }> {
    const row = await this.sharedRepo.findById(id);
    if (!row) throw new NotFoundError('Link not found');

    const link = mapSharedLinkRow(row as unknown as Record<string, unknown>);

    if (link.targetType === 'file') {
      const file = await this.fileRepo.findById(link.targetId);
      if (!file) throw new NotFoundError('File not found');
      return { link, target: mapFileRow(file as unknown as Record<string, unknown>) };
    }
    const folderName = await this.sharedRepo.findFolderName(link.targetId);
    return { link, targetName: folderName ?? undefined };
  }

  /** Get shared link for validation (no target fetch). */
  async getLinkForValidation(id: string): Promise<SharedLink | null> {
    const row = await this.sharedRepo.findById(id);
    return row ? mapSharedLinkRow(row as unknown as Record<string, unknown>) : null;
  }

  /**
   * Get file + drive account ID for download (public route).
   * Uses the same RBAC as assertCanShare: owner OR workspace editor.
   * This ensures links created by workspace editors (who can share files
   * owned by other members) also work at download time.
   */
  async getDownloadContext(link: SharedLink): Promise<{ file: FileRow; driveAccountId: string } | null> {
    const file = await this.fileRepo.findById(link.targetId);
    if (!file) return null;

    // Same RBAC as assertCanShare: owner OR workspace editor
    if (file.user_id !== link.userId) {
      if (!file.workspace_id) return null;
      const role = await getWorkspaceRole(this.db, file.workspace_id, link.userId);
      if (!role || !hasPermission(role, 'editor')) return null;
    }

    const drive = await this.driveRepo.findByIdAndUser(file.drive_account_id, link.userId);
    if (!drive) return null;

    return { file, driveAccountId: file.drive_account_id };
  }

  // ─── Fire-and-forget counters (caller wraps in waitUntil) ───

  incrementViewCount(id: string) { return this.sharedRepo.incrementViewCount(id); }
  incrementDownloadCount(id: string) { return this.sharedRepo.incrementDownloadCount(id); }

  /**
   * Atomically increment download count with maxDownloads enforcement.
   * Returns the new count if allowed, null if limit reached.
   * Call BEFORE streaming — not in waitUntil.
   */
  incrementDownloadCountWithLimit(id: string): Promise<number | null> {
    return this.sharedRepo.incrementDownloadCountWithLimit(id);
  }

  logAction(linkId: string, action: string, visitorEmail?: string) {
    return this.sharedRepo.logAction(linkId, action, visitorEmail);
  }

  // ─── RBAC ───

  /**
   * Assert that the user can share the target.
   * - File: owner OR editor of the file's workspace (same pattern as
   *   FileService.assertCanMutate, replicated inline because that method
   *   is private).
   * - Folder: workspace editor OR drive folder owner
   */
  private async assertCanShare(userId: string, targetType: 'file' | 'folder', targetId: string): Promise<void> {
    if (targetType === 'file') {
      const file = await this.fileRepo.findById(targetId);
      if (!file) throw new NotFoundError('File not found');

      if (file.workspace_id) {
        const role = await getWorkspaceRole(this.db, file.workspace_id, userId);
        if (!role || !hasPermission(role, 'editor')) {
          throw new ForbiddenError('Forbidden');
        }
      } else if (file.user_id !== userId) {
        throw new ForbiddenError('Forbidden');
      }
    } else {
      // Folder: check workspace membership first, then drive folder ownership
      const wsOk = await this.checkFolderAccess(userId, targetId);
      if (!wsOk) {
        const driveOk = !!(await this.driveRepo.findOwnedDriveFolderByGoogleId(targetId, userId));
        if (!driveOk) throw new ForbiddenError('You do not own this folder');
      }
    }
  }

  /** Check if user has editor access to a workspace folder. */
  private async checkFolderAccess(userId: string, folderId: string): Promise<boolean> {
    const folder = await this.folderRepo.findMembership(folderId, userId);
    if (!folder) return false;
    const role = await getWorkspaceRole(this.db, folder.workspace_id, userId);
    return !!role && hasPermission(role, 'editor');
  }
}
