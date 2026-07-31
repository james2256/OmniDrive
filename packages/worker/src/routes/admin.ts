import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { AppError, ConflictError, ForbiddenError } from '../lib/errors';
import { generateId } from '../lib/id';
import { hashPassword } from '../lib/password';
import { zValidator } from '@hono/zod-validator';
import {
  createInvitationSchema,
  adminCreateUserSchema,
  adminUpdateRoleSchema,
  adminUpdateStatusSchema,
  zodErrorHook,
} from '../lib/schemas';
import { mapAuditLogRow } from '../types/db';

export const adminRouter = new Hono<AppContext>({ strict: false });

adminRouter.use('*', authGuard);

// Super-admin guard — checks is_super_admin on every admin route
adminRouter.use('*', async (c, next) => {
  const user = await c.get('adminRepo').findSuperAdminStatus(c.get('userId'));
  if (!user || user.is_super_admin !== 1) {
    throw new ForbiddenError('Super Admin access required');
  }
  await next();
});

adminRouter.get('/invitations', async (c) => {
  const { results } = await c.get('adminRepo').findAllInvitations();
  return c.json({ invitations: results });
});

adminRouter.post(
  '/invitations',
  zValidator('json', createInvitationSchema, zodErrorHook),
  async (c) => {
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

    await c
      .get('adminRepo')
      .insertInvitation({ id, code: finalCode, createdBy: userId, maxUses: max_uses || 1 });

    return c.json({
      invitation: {
        id,
        code: finalCode,
        created_by: userId,
        max_uses: max_uses || 1,
        used_count: 0,
      },
    });
  },
);

adminRouter.delete('/invitations/:id', async (c) => {
  await c.get('adminRepo').deleteInvitation(c.req.param('id'));
  return c.body(null, 204);
});

adminRouter.get('/audit-logs', async (c) => {
  const { results } = await c.get('adminRepo').findRecentAuditLogs();
  return c.json({ logs: results.map((r: Record<string, unknown>) => mapAuditLogRow(r)) });
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
      role: u.is_super_admin ? ('super_admin' as const) : ('member' as const),
      status: u.is_blocked ? ('blocked' as const) : ('active' as const),
    })),
  });
});

adminRouter.post('/users', zValidator('json', adminCreateUserSchema, zodErrorHook), async (c) => {
  const { name, username, password, email, role } = c.req.valid('json');
  const adminRepo = c.get('adminRepo');

  // Duplicate checks (preserved — same behavior as before)
  if (await adminRepo.findByUsername(username)) throw new ConflictError('Username already exists');
  if (email && (await adminRepo.findByEmail(email))) {
    throw new ConflictError('Email already exists');
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const isSuperAdmin = role === 'super_admin' ? 1 : 0;
  await adminRepo.insertUser({
    id,
    username,
    passwordHash,
    email: email || null,
    name: name || username,
    isSuperAdmin,
  });

  return c.json({
    user: {
      id,
      username,
      email,
      name: name || username,
      avatarUrl: null,
      role: isSuperAdmin ? ('super_admin' as const) : ('member' as const),
      status: 'active' as const,
    },
  });
});

// PATCH /users/:id/role — promote/demote (self-protection + last-admin protection)
adminRouter.patch(
  '/users/:id/role',
  zValidator('json', adminUpdateRoleSchema, zodErrorHook),
  async (c) => {
    const { role } = c.req.valid('json');
    const targetUserId = c.req.param('id');
    const currentUserId = c.get('userId');

    if (targetUserId === currentUserId) {
      throw new AppError(400, 'Cannot change your own role');
    }

    if (role === 'super_admin') {
      await c.get('adminRepo').promoteToAdmin(targetUserId);
    } else {
      const result = await c.get('adminRepo').demoteFromAdmin(targetUserId);
      if (!result.meta.changes) {
        throw new AppError(400, 'Cannot demote the last super admin');
      }
    }

    return c.body(null, 204);
  },
);

// PATCH /users/:id/status — block/unblock (self-protection; block deletes sessions)
adminRouter.patch(
  '/users/:id/status',
  zValidator('json', adminUpdateStatusSchema, zodErrorHook),
  async (c) => {
    const { status } = c.req.valid('json');
    const targetUserId = c.req.param('id');
    const currentUserId = c.get('userId');

    if (targetUserId === currentUserId) {
      throw new AppError(400, 'Cannot block your own account');
    }

    if (status === 'blocked') {
      await c.get('adminRepo').blockUser(targetUserId);
    } else {
      await c.get('adminRepo').unblockUser(targetUserId);
    }

    return c.body(null, 204);
  },
);

// DELETE /users/:id — permanently delete (self-protection; manual cascade)
adminRouter.delete('/users/:id', async (c) => {
  const targetUserId = c.req.param('id');
  const currentUserId = c.get('userId');

  if (targetUserId === currentUserId) {
    throw new AppError(400, 'Cannot delete your own account');
  }

  // Last-super-admin protection (defense-in-depth): if the target is a super admin,
  // block the delete if they're the only one. Prevents lockout (no one left to
  // manage users). With the current super-admin guard on all admin routes, this
  // is unreachable via normal API calls (self-delete guard fires first for the
  // last admin, and non-super-admins can't access the route). Kept as a safety
  // net in case the admin guard is ever relaxed or bypassed.
  const target = await c.get('adminRepo').findSuperAdminStatus(targetUserId);
  if (target?.is_super_admin) {
    const count = await c.get('adminRepo').countSuperAdmins();
    if (count <= 1) {
      throw new AppError(400, 'Cannot delete the last super admin');
    }
  }

  await c.get('adminRepo').deleteUser(targetUserId);
  return c.body(null, 204);
});
