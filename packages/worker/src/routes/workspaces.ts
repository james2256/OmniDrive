import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { generateId } from '../lib/id';
import { getWorkspaceRole, hasPermission } from '../middleware/rbac';
import { zValidator } from '@hono/zod-validator';
import {
  createWorkspaceSchema,
  addWorkspaceMemberSchema,
  workspacePolicySchema,
  updateWorkspaceMetadataSchema,
  zodErrorHook,
} from '../lib/schemas';
import { AuditService } from '../services/audit.service';

export const workspacesRouter = new Hono<AppContext>({ strict: false });

workspacesRouter.use('*', authGuard);

workspacesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const { results } = await db
    .prepare(`
      SELECT w.*, wm.role 
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC
    `)
    .bind(userId)
    .all();

  return c.json({ workspaces: results });
});

workspacesRouter.post('/', zValidator('json', createWorkspaceSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const { name } = c.req.valid('json');

  const workspaceId = generateId();
  const memberId = generateId();

  await db.batch([
    db.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
      .bind(workspaceId, name, userId),
    db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
      .bind(memberId, workspaceId, userId, 'owner')
  ]);

  const workspace = await db
    .prepare('SELECT * FROM workspaces WHERE id = ?')
    .bind(workspaceId)
    .first();

  return c.json({ workspace }, 201);
});

workspacesRouter.post('/:id/members', zValidator('json', addWorkspaceMemberSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');
  const { email, role } = c.req.valid('json');

  const currentUserRole = await getWorkspaceRole(db, workspaceId, userId);
  if (!currentUserRole || !hasPermission(currentUserRole, 'manager')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Prevent role escalation: can't assign role >= own role
  const levels: Record<string, number> = { 'viewer': 1, 'auditor': 1, 'commenter': 2, 'editor': 3, 'manager': 4, 'owner': 5 };
  const assignerLevel = levels[currentUserRole] || 0;
  const targetLevel = levels[role] || 0;
  if (targetLevel >= assignerLevel) {
    return c.json({ error: 'Cannot assign a role equal to or higher than your own' }, 403);
  }

  const targetUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first() as { id: string };
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  const memberId = generateId();
  try {
    await db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').bind(memberId, workspaceId, targetUser.id, role).run();
    
    const auditService = new AuditService(db);
    await auditService.logEvent({
      workspaceId,
      actorId: userId,
      actionType: 'member.invite',
      resourceId: targetUser.id,
      resourceName: email,
      metadata: { role }
    });
  } catch (e: unknown) {
    if ((e instanceof Error ? e.message : String(e)).includes('UNIQUE constraint failed')) {
      return c.json({ error: 'User is already a member' }, 409);
    }
    throw e;
  }

  return c.json({ success: true }, 201);
});

workspacesRouter.delete('/:id/members/:targetUserId', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');
  const targetUserId = c.req.param('targetUserId');

  if (userId === targetUserId) {
    return c.json({ error: 'Cannot remove yourself from the workspace' }, 400);
  }

  const currentUserRole = await getWorkspaceRole(db, workspaceId, userId);
  if (!currentUserRole || !hasPermission(currentUserRole, 'manager')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Only owners can remove other owners; managers cannot remove owners
  const targetRole = await getWorkspaceRole(db, workspaceId, targetUserId);
  if (targetRole === 'owner' && currentUserRole !== 'owner') {
    return c.json({ error: 'Only an owner can remove another owner' }, 403);
  }

  // Prevent removing the last owner — would orphan the workspace
  if (targetRole === 'owner') {
    const { count } = await db.prepare('SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = ? AND role = ?').bind(workspaceId, 'owner').first() as { count: number } || { count: 0 };
    if (count <= 1) {
      return c.json({ error: 'Cannot remove the last owner of the workspace' }, 400);
    }
  }

  await db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, targetUserId).run();

  const auditService = new AuditService(db);
  await auditService.logEvent({
    workspaceId,
    actorId: userId,
    actionType: 'member.remove',
    resourceId: targetUserId,
    metadata: { targetUserId }
  });

  return c.json({ success: true });
});

workspacesRouter.get('/:id/audit-logs', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');

  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role || (role !== 'owner' && role !== 'manager' && role !== 'auditor')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await db.prepare(
    'SELECT a.*, u.email as actor_email FROM audit_logs a JOIN users u ON a.actor_id = u.id WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(workspaceId).all();

  return c.json({ logs: results });
});

workspacesRouter.get('/:id/policies', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');

  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role || !hasPermission(role, 'manager')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await db.prepare(
    'SELECT * FROM workspace_policies WHERE workspace_id = ?'
  ).bind(workspaceId).all();

  return c.json({ policies: results });
});

workspacesRouter.post('/:id/policies', zValidator('json', workspacePolicySchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');

  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role || !hasPermission(role, 'manager')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { targetType, targetId, policyType, config } = c.req.valid('json');

  const policyId = generateId();

  await db.prepare(`
    INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(policyId, workspaceId, targetType, targetId || null, policyType, JSON.stringify(config)).run();

  const policy = await db.prepare('SELECT * FROM workspace_policies WHERE id = ?').bind(policyId).first();

  return c.json({ policy }, 201);
});

workspacesRouter.delete('/:id/policies/:policyId', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');
  const policyId = c.req.param('policyId');

  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role || !hasPermission(role, 'manager')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.prepare('DELETE FROM workspace_policies WHERE id = ? AND workspace_id = ?').bind(policyId, workspaceId).run();

  return c.json({ success: true });
});

workspacesRouter.patch('/:id/folders/:folderId/metadata', zValidator('json', updateWorkspaceMetadataSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');
  const folderId = c.req.param('folderId');
  const { metadata } = c.req.valid('json');

  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role || !hasPermission(role, 'editor')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.prepare('UPDATE workspace_folders SET metadata = ? WHERE id = ? AND workspace_id = ?').bind(JSON.stringify(metadata), folderId, workspaceId).run();

  return c.json({ success: true });
});
