import type { WorkspaceRole } from './schemas';

export async function getWorkspaceRole(db: D1Database, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const member = await db.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  return member ? member.role : null;
}

export function hasPermission(role: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  const levels: Record<WorkspaceRole, number> = {
    'viewer': 1,
    'auditor': 1,
    'commenter': 2,
    'editor': 3,
    'manager': 4,
    'owner': 5
  };
  return levels[role] >= levels[requiredRole];
}
