import type { D1Database } from '@cloudflare/workers-types';
import type { WorkspaceRole } from './schemas';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import { FolderRepository } from '../repositories/folder.repository';

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

/**
 * Check if the user has editor access to a workspace folder.
 * Returns true if the user is a workspace member with editor+ role;
 * false otherwise (including if the folder doesn't exist or isn't a
 * workspace folder).
 *
 * Used by SharedService.assertCanShare (previously duplicated there
 * as a private method — IMP-35).
 *
 * Pattern matches getWorkspaceRole: free function taking db,
 * orchestrates FolderRepository.findMembership + getWorkspaceRole + hasPermission.
 */
export async function checkFolderEditorAccess(
  db: D1Database,
  folderId: string,
  userId: string,
): Promise<boolean> {
  const folder = await new FolderRepository(db).findMembership(folderId, userId);
  if (!folder) return false;
  const role = await getWorkspaceRole(db, folder.workspace_id, userId);
  return !!role && hasPermission(role, 'editor');
}
