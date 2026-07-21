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

// Super-admin guard — checks is_super_admin on every admin route
adminRouter.use('*', async (c, next) => {
  const user = await c.get('adminRepo').findSuperAdminStatus(c.get('userId'));
  if (!user || user.is_super_admin !== 1) {
    throw new AppError(403, 'Forbidden: Super Admin access required');
  }
  await next();
});

adminRouter.get('/invitations', async (c) => {
  const { results } = await c.get('adminRepo').findAllInvitations();
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

  await c.get('adminRepo').insertInvitation({ id, code: finalCode, createdBy: userId, maxUses: max_uses || 1 });

  return c.json({ success: true, invitation: { id, code: finalCode, created_by: userId, max_uses: max_uses || 1, used_count: 0 } });
});

adminRouter.delete('/invitations/:id', async (c) => {
  await c.get('adminRepo').deleteInvitation(c.req.param('id'));
  return c.json({ success: true });
});

adminRouter.get('/audit-logs', async (c) => {
  const { results } = await c.get('adminRepo').findRecentAuditLogs();
  return c.json({ logs: results });
});

adminRouter.get('/users', async (c) => {
  const { results } = await c.get('adminRepo').findAllUsers();
  return c.json({
    users: results.map((u: Record<string, unknown>) => ({
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
  const adminRepo = c.get('adminRepo');

  // Duplicate checks (preserved — same behavior as before)
  if (await adminRepo.findByUsername(username)) throw new AppError(400, 'Username already exists');
  if (email && await adminRepo.findByEmail(email)) throw new AppError(400, 'Email already exists');

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const isSuperAdmin = role === 'super_admin' ? 1 : 0;
  await adminRepo.insertUser({ id, username, passwordHash, email: email || null, name: name || username, isSuperAdmin });

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
