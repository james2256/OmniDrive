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
