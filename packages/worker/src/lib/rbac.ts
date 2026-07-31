import type { D1Database } from '@cloudflare/workers-types';
import type { WorkspaceRole } from './schemas';
import { WorkspaceRepository } from '../repositories/workspace.repository';

const ROLE_LEVELS: Record<WorkspaceRole, number> = {
  viewer: 1,
  auditor: 1,
  commenter: 2,
  editor: 3,
  manager: 4,
  owner: 5,
};

/** Returns the numeric hierarchy level of a workspace role (1=lowest, 5=highest). */
export function roleLevel(role: WorkspaceRole): number {
  return ROLE_LEVELS[role];
}

/**
 * Read a user's workspace role — the RBAC primitive used by 18 call sites
 * across services + routes. Delegates to `WorkspaceRepository.findMemberRole`
 * so the `workspace_members` SQL has a single owner (ADR-0003). The signature
 * stays `(db, workspaceId, userId)` so the 18 callers don't change — this is
 * correct layering for a lib utility (orchestrates db → repo), not a shim.
 */
export async function getWorkspaceRole(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const member = await new WorkspaceRepository(db).findMemberRole(workspaceId, userId);
  return member ? (member.role as WorkspaceRole) : null;
}

export function hasPermission(role: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return roleLevel(role) >= roleLevel(requiredRole);
}
