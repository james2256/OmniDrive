import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { hashPassword } from '../lib/password';
import { zValidator } from '@hono/zod-validator';
import { createInvitationSchema, adminCreateUserSchema, zodErrorHook } from '../lib/schemas';

export const adminRouter = new Hono<AppContext>({ strict: false });

adminRouter.use('*', authGuard);

// Middleware to protect admin routes
adminRouter.use('*', async (c, next) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT is_super_admin FROM users WHERE id = ?').bind(userId).first() as { is_super_admin: number };
  if (!user || user.is_super_admin !== 1) {
    throw new AppError(403, 'Forbidden: Super Admin access required');
  }
  await next();
});

adminRouter.get('/invitations', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM invitation_codes ORDER BY created_at DESC').all();
  return c.json({ invitations: results });
});

adminRouter.post('/invitations', zValidator('json', createInvitationSchema, zodErrorHook), async (c) => {
  const { code, max_uses } = c.req.valid('json');

  // ponytail: server-generates a high-entropy code when none given; user-supplied
  // codes must be >= 12 chars so short guessable invites can't be brute-forced.
  let finalCode: string;
  if (code) {
    finalCode = code.trim();
  } else {
    finalCode = generateId().replace(/-/g, '');
  }

  const id = generateId();
  const userId = c.get('userId');
  
  await c.env.DB.prepare(
    'INSERT INTO invitation_codes (id, code, created_by, max_uses) VALUES (?, ?, ?, ?)'
  ).bind(id, finalCode, userId, max_uses || 1).run();
  
  return c.json({ success: true, invitation: { id, code: finalCode, created_by: userId, max_uses: max_uses || 1, used_count: 0 } });
});

adminRouter.delete('/invitations/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM invitation_codes WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

adminRouter.get('/audit-logs', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    'SELECT a.*, u.email as actor_email, w.name as workspace_name FROM audit_logs a JOIN users u ON a.actor_id = u.id LEFT JOIN workspaces w ON a.workspace_id = w.id ORDER BY a.created_at DESC LIMIT 100'
  ).all();

  return c.json({ logs: results });
});

type AdminUserRow = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  is_super_admin: number;
};

adminRouter.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, email, name, avatar_url, is_super_admin FROM users ORDER BY created_at DESC LIMIT 100'
  ).all<AdminUserRow>();
  return c.json({
    users: results.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatar_url,
      role: u.is_super_admin ? 'super_admin' as const : 'member' as const,
      status: 'active' as const,
    })),
  });
});

adminRouter.post('/users', zValidator('json', adminCreateUserSchema, zodErrorHook), async (c) => {
  const { name, username, password, email, role } = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) throw new AppError(400, 'Username already exists');

  if (email) {
    const existingEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existingEmail) throw new AppError(400, 'Email already exists');
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const isSuperAdmin = role === 'super_admin' ? 1 : 0;

  await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, email, name, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, username, passwordHash, email || null, name || username, isSuperAdmin).run();

  return c.json({
    success: true,
    user: {
      id,
      username,
      email,
      name: name || username,
      avatarUrl: null,
      role: isSuperAdmin ? 'super_admin' as const : 'member' as const,
      status: 'active' as const,
    },
  });
});
