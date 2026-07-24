import type { D1Database } from '@cloudflare/workers-types';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import { AuditService } from './audit.service';
import { getWorkspaceRole, hasPermission, roleLevel } from '../lib/rbac';
import { AppError, ConflictError } from '../lib/errors';
import type { WorkspaceRole } from '../lib/schemas';
import { mapAuditLogRow, type AuditLog } from '../types';

/**
 * Business logic layer for workspace management.
 *
 * RBAC is preserved EXACTLY as the original routes:
 * - addMember: manager + role-escalation check (can't assign ≥ own role)
 * - removeMember: self-removal check + manager + owner-removal check + last-owner check
 * - getAuditLogs: owner/manager/auditor only (NOT membership)
 * - getPolicies/createPolicy/deletePolicy: manager required
 * - updateFolderMetadata: editor required
 *
 * AuditService is included for member.invite + member.remove logging.
 */
export class WorkspaceService {
  private workspaceRepo: WorkspaceRepository;
  private auditService: AuditService;

  constructor(private db: D1Database) {
    this.workspaceRepo = new WorkspaceRepository(db);
    this.auditService = new AuditService(db);
  }

  /** List all workspaces a user is a member of, with their role. */
  async listWorkspaces(userId: string) {
    const { results } = await this.db.prepare(`
      SELECT w.*, wm.role
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC
    `).bind(userId).all();
    return results;
  }

  /** Find a workspace by ID + membership (returns null if not a member). */
  findByIdAndMember(workspaceId: string, userId: string) {
    return this.workspaceRepo.findByIdAndMember(workspaceId, userId);
  }

  /** Get the sync TTL for a workspace. */
  findSyncTtl(workspaceId: string) {
    return this.workspaceRepo.findSyncTtl(workspaceId);
  }

  /** Create a workspace + add the creator as 'owner'. Returns the workspace row. */
  async createWorkspace(userId: string, name: string): Promise<unknown> {
    const workspaceId = await this.workspaceRepo.createWorkspace(name, userId);
    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').bind(workspaceId).first();
  }

  /**
   * Add a member to a workspace.
   * RBAC: manager required + role-escalation check (can't assign ≥ own role).
   * Logs: member.invite audit event.
   */
  async addMember(userId: string, workspaceId: string, email: string, role: WorkspaceRole): Promise<void> {
    const currentUserRole = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!currentUserRole || !hasPermission(currentUserRole, 'manager')) {
      throw new AppError(403, 'Forbidden');
    }

    // Prevent role escalation: can't assign role >= own role
    const assignerLevel = roleLevel(currentUserRole);
    const targetLevel = roleLevel(role);
    if (targetLevel >= assignerLevel) {
      throw new AppError(403, 'Cannot assign a role equal to or higher than your own');
    }

    const targetUser = await this.workspaceRepo.findUserByEmail(email);
    if (!targetUser) {
      throw new AppError(404, 'User not found');
    }

    try {
      await this.workspaceRepo.addMember(workspaceId, targetUser.id, role);

      await this.auditService.logEvent({
        workspaceId,
        actorId: userId,
        actionType: 'member.invite',
        resourceId: targetUser.id,
        resourceName: email,
        metadata: { role }
      });
    } catch (e: unknown) {
      if ((e instanceof Error ? e.message : String(e)).includes('UNIQUE constraint failed')) {
        throw new ConflictError('User is already a member');
      }
      throw e;
    }
  }

  /**
   * Remove a member from a workspace.
   * RBAC: self-removal check (400) + manager required + owner-removal check + last-owner check.
   * Logs: member.remove audit event.
   */
  async removeMember(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
    if (userId === targetUserId) {
      throw new AppError(400, 'Cannot remove yourself from the workspace');
    }

    const currentUserRole = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!currentUserRole || !hasPermission(currentUserRole, 'manager')) {
      throw new AppError(403, 'Forbidden');
    }

    // Only owners can remove other owners; managers cannot remove owners
    const targetRole = await getWorkspaceRole(this.db, workspaceId, targetUserId);
    if (targetRole === 'owner' && currentUserRole !== 'owner') {
      throw new AppError(403, 'Only an owner can remove another owner');
    }

    // Prevent removing the last owner — would orphan the workspace
    if (targetRole === 'owner') {
      const { count } = (await this.workspaceRepo.countOwners(workspaceId)) ?? { count: 0 };
      if (count <= 1) {
        throw new AppError(400, 'Cannot remove the last owner of the workspace');
      }
    }

    await this.workspaceRepo.removeMember(workspaceId, targetUserId);

    await this.auditService.logEvent({
      workspaceId,
      actorId: userId,
      actionType: 'member.remove',
      resourceId: targetUserId,
      metadata: { targetUserId }
    });
  }

  /**
   * Get audit logs for a workspace.
   * RBAC: owner/manager/auditor only (NOT membership — excludes viewers, commenters, editors).
   */
  async getAuditLogs(userId: string, workspaceId: string): Promise<AuditLog[]> {
    const role = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!role || (role !== 'owner' && role !== 'manager' && role !== 'auditor')) {
      throw new AppError(403, 'Forbidden');
    }

    const { results } = await this.workspaceRepo.findAuditLogs(workspaceId);
    return results.map((r: Record<string, unknown>) => mapAuditLogRow(r));
  }

  /**
   * Get policies for a workspace.
   * RBAC: manager required (NOT membership).
   */
  async getPolicies(userId: string, workspaceId: string) {
    const role = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!role || !hasPermission(role, 'manager')) {
      throw new AppError(403, 'Forbidden');
    }

    const { results } = await this.workspaceRepo.findPolicies(workspaceId);
    return results;
  }

  /**
   * Create a policy.
   * RBAC: manager required.
   */
  async createPolicy(userId: string, workspaceId: string, params: {
    targetType: string;
    targetId: string | null;
    policyType: string;
    config: Record<string, unknown>;
  }): Promise<unknown> {
    const role = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!role || !hasPermission(role, 'manager')) {
      throw new AppError(403, 'Forbidden');
    }

    return this.workspaceRepo.createPolicy({
      workspaceId,
      targetType: params.targetType,
      targetId: params.targetId,
      policyType: params.policyType,
      config: JSON.stringify(params.config),
    });
  }

  /**
   * Delete a policy.
   * RBAC: manager required.
   */
  async deletePolicy(userId: string, workspaceId: string, policyId: string): Promise<void> {
    const role = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!role || !hasPermission(role, 'manager')) {
      throw new AppError(403, 'Forbidden');
    }

    await this.workspaceRepo.deletePolicy(policyId, workspaceId);
  }

  /**
   * Update folder metadata within a workspace.
   * RBAC: editor required.
   */
  async updateFolderMetadata(userId: string, workspaceId: string, folderId: string, metadata: Record<string, unknown>): Promise<void> {
    const role = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!role || !hasPermission(role, 'editor')) {
      throw new AppError(403, 'Forbidden');
    }

    await this.db.prepare('UPDATE workspace_folders SET metadata = ? WHERE id = ? AND workspace_id = ?')
      .bind(JSON.stringify(metadata), folderId, workspaceId).run();
  }
}
