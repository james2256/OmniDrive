import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { generateId } from '../lib/id';

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

workspacesRouter.post('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const { name } = await c.req.json<{ name?: string }>();

  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

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

workspacesRouter.post('/:id/members', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');
  const { email } = await c.req.json<{ email?: string }>();

  if (!email) {
    return c.json({ error: 'Email is required' }, 400);
  }

  const member = await db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, userId).first<{ role: string }>();
  if (!member || member.role !== 'owner') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const targetUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  const memberId = generateId();
  try {
    await db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').bind(memberId, workspaceId, targetUser.id, 'member').run();
  } catch (e: any) {
    if (e.message.includes('UNIQUE constraint failed')) {
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

  const member = await db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, userId).first<{ role: string }>();
  if (!member || member.role !== 'owner') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, targetUserId).run();

  return c.json({ success: true });
});
