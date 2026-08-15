import type { D1Database } from '@cloudflare/workers-types';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import { AuditRepository } from '../repositories/audit.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { getWorkspaceRole, hasPermission, roleLevel, assertWorkspaceRole } from '../lib/rbac';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors';
import { generateId } from '../lib/id';
import type { WorkspaceRole } from '../lib/schemas';
import { mapAuditLogRow, mapWorkspacePolicyRow } from '../types/db';
import type { AuditLog, WorkspacePolicy } from '../types/domain';

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
 * AuditRepository is used for member.invite + member.remove logging (batched
 * atomically with the membership change so the audit row and the member row
 * commit or roll back together).
 */
export class WorkspaceService {
  private workspaceRepo: WorkspaceRepository;
  private auditRepo: AuditRepository;
  private folderRepo: FolderRepository;

  constructor(private db: D1Database) {
    this.workspaceRepo = new WorkspaceRepository(db);
    this.auditRepo = new AuditRepository(db);
    this.folderRepo = new FolderRepository(db);
  }

  /** List all workspaces a user is a member of, with their role. */
  async listWorkspaces(userId: string) {
    const { results } = await this.workspaceRepo.findWorkspacesWithRole(userId);
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
    return this.workspaceRepo.findById(workspaceId);
  }

  /**
   * Add a member to a workspace.
   * RBAC: manager required + role-escalation check (can't assign ≥ own role).
   * Logs: member.invite audit event.
   */
  async addMember(
    userId: string,
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<void> {
    const currentUserRole = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!currentUserRole || !hasPermission(currentUserRole, 'manager')) {
      throw new ForbiddenError();
    }

    // Prevent role escalation: can't assign role >= own role
    const assignerLevel = roleLevel(currentUserRole);
    const targetLevel = roleLevel(role);
    if (targetLevel >= assignerLevel) {
      throw new ForbiddenError('Cannot assign a role equal to or higher than your own');
    }

    const targetUser = await this.workspaceRepo.findUserByEmail(email);
    if (!targetUser) {
      throw new NotFoundError('User not found');
    }

    try {
      const memberId = generateId();
      const auditStmt = this.auditRepo.insertLogStmt({
        workspaceId,
        actorId: userId,
        actionType: 'member.invite',
        resourceId: targetUser.id,
        resourceName: email,
        metadata: { role },
      });
      await this.db.batch([
        this.workspaceRepo.addMemberStmt(memberId, workspaceId, targetUser.id, role),
        auditStmt,
      ]);
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
      throw new ForbiddenError();
    }

    // Only owners can remove other owners; managers cannot remove owners
    const targetRole = await getWorkspaceRole(this.db, workspaceId, targetUserId);
    if (targetRole === 'owner' && currentUserRole !== 'owner') {
      throw new ForbiddenError('Only an owner can remove another owner');
    }

    // Prevent removing the last owner — would orphan the workspace
    if (targetRole === 'owner') {
      const { count } = (await this.workspaceRepo.countOwners(workspaceId)) ?? { count: 0 };
      if (count <= 1) {
        throw new AppError(400, 'Cannot remove the last owner of the workspace');
      }
    }

    await this.db.batch([
      this.workspaceRepo.removeMemberStmt(workspaceId, targetUserId),
      this.auditRepo.insertLogStmt({
        workspaceId,
        actorId: userId,
        actionType: 'member.remove',
        resourceId: targetUserId,
        metadata: { targetUserId },
      }),
    ]);
  }

  /**
   * Get audit logs for a workspace.
   * RBAC: owner/manager/auditor only (NOT membership — excludes viewers, commenters, editors).
   */
  async getAuditLogs(userId: string, workspaceId: string): Promise<AuditLog[]> {
    const role = await getWorkspaceRole(this.db, workspaceId, userId);
    if (!role || (role !== 'owner' && role !== 'manager' && role !== 'auditor')) {
      throw new ForbiddenError();
    }

    const { results } = await this.workspaceRepo.findAuditLogs(workspaceId);
    return results.map((r: Record<string, unknown>) => mapAuditLogRow(r));
  }

  /**
   * Get policies for a workspace.
   * RBAC: manager required (NOT membership).
   */
  async getPolicies(userId: string, workspaceId: string): Promise<WorkspacePolicy[]> {
    await assertWorkspaceRole(this.db, workspaceId, userId, 'manager');

    const { results } = await this.workspaceRepo.findPolicies(workspaceId);
    return results.map((r: Record<string, unknown>) => mapWorkspacePolicyRow(r));
  }

  /**
   * Create a policy.
   * RBAC: manager required.
   */
  async createPolicy(
    userId: string,
    workspaceId: string,
    params: {
      targetType: string;
      targetId: string | null;
      policyType: string;
      config: Record<string, unknown>;
    },
  ): Promise<WorkspacePolicy | null> {
    await assertWorkspaceRole(this.db, workspaceId, userId, 'manager');

    const row = await this.workspaceRepo.createPolicy({
      workspaceId,
      targetType: params.targetType,
      targetId: params.targetId,
      policyType: params.policyType,
      config: JSON.stringify(params.config),
    });
    return row ? mapWorkspacePolicyRow(row) : null;
  }

  /**
   * Delete a policy.
   * RBAC: manager required.
   */
  async deletePolicy(userId: string, workspaceId: string, policyId: string): Promise<void> {
    await assertWorkspaceRole(this.db, workspaceId, userId, 'manager');

    await this.workspaceRepo.deletePolicy(policyId, workspaceId);
  }

  /**
   * Update folder metadata within a workspace.
   * RBAC: editor required.
   */
  async updateFolderMetadata(
    userId: string,
    workspaceId: string,
    folderId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await assertWorkspaceRole(this.db, workspaceId, userId, 'editor');

    await this.folderRepo.updateMetadata(folderId, workspaceId, metadata);
  }
}
