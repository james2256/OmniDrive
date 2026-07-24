import type { WorkspaceRole } from './schemas';

const ROLE_LEVELS: Record<WorkspaceRole, number> = {
  'viewer': 1,
  'auditor': 1,
  'commenter': 2,
  'editor': 3,
  'manager': 4,
  'owner': 5
};

/** Returns the numeric hierarchy level of a workspace role (1=lowest, 5=highest). */
export function roleLevel(role: WorkspaceRole): number {
  return ROLE_LEVELS[role];
}

export async function getWorkspaceRole(db: D1Database, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const member = await db.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  return member ? member.role : null;
}

export function hasPermission(role: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return roleLevel(role) >= roleLevel(requiredRole);
}
