import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../../src/index';
import { ensureSchema, clearAllTables } from './helpers';
import { hashPassword } from '../../src/lib/password';
import type { SessionData } from '../../src/types/env';

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database;
    KV: KVNamespace;
    JWT_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    FRONTEND_URL: string;
    WORKER_URL: string;
  }
}

const ORIGIN = 'http://localhost:5173';

/**
 * Insert a user (super admin or member) + session directly via D1, bypassing
 * the register route's rate limiter. Returns the userId + cookie for
 * authenticated requests. Pattern from auth-flow.test.ts.
 */
async function insertUserAndSession(
  username: string,
  isSuperAdmin: boolean,
): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${username}`;
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin, email) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(userId, username, passwordHash, isSuperAdmin ? 1 : 0, `${username}@example.com`)
    .run();

  const now = Date.now();
  const sessionData: SessionData = {
    userId,
    username,
    email: `${username}@example.com`,
    name: username,
    avatarUrl: null,
    role: isSuperAdmin ? 'super_admin' : 'member',
    createdAt: now,
  };
  const sessionId = `session-${username}-${now}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now)
    .run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

/** Insert a user without a session — a target user that is never authenticated. */
async function insertUserOnly(username: string, isSuperAdmin = false): Promise<string> {
  const userId = `user-${username}`;
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin, email) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(userId, username, passwordHash, isSuperAdmin ? 1 : 0, `${username}@example.com`)
    .run();
  return userId;
}

interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  role: 'super_admin' | 'member';
  status: 'active' | 'blocked';
}

describe('Admin users CRUD (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // ─── Auth / RBAC guards ───

  it('GET /api/admin/users returns 401 without a session cookie', async () => {
    const res = await app.request('/api/admin/users', { headers: { Origin: ORIGIN } }, env);
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/users returns 403 for a non-super-admin', async () => {
    const member = await insertUserAndSession('alice', false);
    const res = await app.request(
      '/api/admin/users',
      { headers: { Cookie: member.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /users (list) ───

  it('GET /api/admin/users lists all users with role + status mapped from boolean flags', async () => {
    const admin = await insertUserAndSession('admin1', true);
    await insertUserOnly('member1', false);

    const res = await app.request(
      '/api/admin/users',
      { headers: { Cookie: admin.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { users: AdminUserRow[] };
    expect(body.users).toHaveLength(2);

    const adminRow = body.users.find((u) => u.username === 'admin1');
    expect(adminRow?.role).toBe('super_admin');
    expect(adminRow?.status).toBe('active');

    const memberRow = body.users.find((u) => u.username === 'member1');
    expect(memberRow?.role).toBe('member');
    expect(memberRow?.status).toBe('active');
  });

  it('GET /api/admin/users maps is_blocked=1 to status=blocked', async () => {
    const admin = await insertUserAndSession('admin2', true);
    const blockedId = await insertUserOnly('blocked1', false);
    await env.DB.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').bind(blockedId).run();

    const res = await app.request(
      '/api/admin/users',
      { headers: { Cookie: admin.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { users: AdminUserRow[] };
    const blockedRow = body.users.find((u) => u.username === 'blocked1');
    expect(blockedRow?.status).toBe('blocked');
    expect(blockedRow?.role).toBe('member');
  });

  // ─── POST /users (create) ───

  it('POST /api/admin/users creates a regular member', async () => {
    const admin = await insertUserAndSession('admin3', true);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'newuser',
          password: 'NewPass123!',
          email: 'newuser@example.com',
          name: 'New User',
          role: 'member',
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AdminUserRow };
    expect(body.user.username).toBe('newuser');
    expect(body.user.role).toBe('member');
    expect(body.user.status).toBe('active');
    expect(body.user.email).toBe('newuser@example.com');
    expect(body.user.name).toBe('New User');
  });

  it('POST /api/admin/users creates a super admin when role=super_admin', async () => {
    const admin = await insertUserAndSession('admin4', true);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'newadmin',
          password: 'NewPass123!',
          role: 'super_admin',
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AdminUserRow };
    expect(body.user.role).toBe('super_admin');
  });

  it('POST /api/admin/users defaults name to username when name is omitted', async () => {
    const admin = await insertUserAndSession('admin5', true);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'noname',
          password: 'NewPass123!',
          role: 'member',
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AdminUserRow };
    expect(body.user.name).toBe('noname');
  });

  it('POST /api/admin/users rejects invalid input via zod (short password → 400)', async () => {
    const admin = await insertUserAndSession('admin6', true);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'invalid',
          password: 'short', // < 8 chars, fails passwordSchema
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/users rejects an invalid email via zod (→ 400)', async () => {
    const admin = await insertUserAndSession('admin7', true);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'bademail',
          password: 'NewPass123!',
          email: 'not-an-email',
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/users rejects a duplicate username with 409', async () => {
    const admin = await insertUserAndSession('admin8', true);
    await insertUserOnly('existing', false);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'existing',
          password: 'NewPass123!',
        }),
      },
      env,
    );
    expect(res.status).toBe(409);
  });

  it('POST /api/admin/users rejects a duplicate email with 409', async () => {
    const admin = await insertUserAndSession('admin9', true);
    await insertUserOnly('origuser', false); // origuser@example.com
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'different',
          password: 'NewPass123!',
          email: 'origuser@example.com',
        }),
      },
      env,
    );
    expect(res.status).toBe(409);
  });

  it('POST /api/admin/users returns a specific message for duplicate username', async () => {
    const admin = await insertUserAndSession('admin10', true);
    await insertUserOnly('dupuser', false);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          username: 'dupuser',
          password: 'NewPass123!',
        }),
      },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('already exists');
  });

  it('POST /api/admin/users returns 403 for a non-super-admin', async () => {
    const member = await insertUserAndSession('member2', false);
    const res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: member.cookie, Origin: ORIGIN },
        body: JSON.stringify({ username: 'x', password: 'NewPass123!' }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  // ─── PATCH /users/:id/role ───

  it('PATCH /api/admin/users/:id/role promotes a member to super_admin', async () => {
    const admin = await insertUserAndSession('admin10', true);
    const targetId = await insertUserOnly('promotee', false);

    const res = await app.request(
      `/api/admin/users/${targetId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ role: 'super_admin' }),
      },
      env,
    );
    expect(res.status).toBe(204);

    const user = await env.DB.prepare('SELECT is_super_admin FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ is_super_admin: number }>();
    expect(user?.is_super_admin).toBe(1);
  });

  it('PATCH /api/admin/users/:id/role demotes a super admin to member when >1 admin remains', async () => {
    const admin = await insertUserAndSession('admin11', true);
    const otherAdminId = await insertUserOnly('otheradmin', true);

    const res = await app.request(
      `/api/admin/users/${otherAdminId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ role: 'member' }),
      },
      env,
    );
    expect(res.status).toBe(204);

    const user = await env.DB.prepare('SELECT is_super_admin FROM users WHERE id = ?')
      .bind(otherAdminId)
      .first<{ is_super_admin: number }>();
    expect(user?.is_super_admin).toBe(0);
  });

  it('PATCH /api/admin/users/:id/role: changing your own role returns 400', async () => {
    const admin = await insertUserAndSession('selfrole', true);
    const res = await app.request(
      `/api/admin/users/${admin.userId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ role: 'member' }),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('own role');
  });

  it('PATCH /api/admin/users/:id/role: rejecting zod-invalid role (→ 400)', async () => {
    const admin = await insertUserAndSession('admin12', true);
    const targetId = await insertUserOnly('target4', false);
    const res = await app.request(
      `/api/admin/users/${targetId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ role: 'not-a-real-role' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('PATCH /api/admin/users/:id/role returns 403 for a non-super-admin', async () => {
    const member = await insertUserAndSession('notadmin4', false);
    const targetId = await insertUserOnly('target5', false);
    const res = await app.request(
      `/api/admin/users/${targetId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: member.cookie, Origin: ORIGIN },
        body: JSON.stringify({ role: 'super_admin' }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  // ─── PATCH /users/:id/status ───

  it('PATCH /api/admin/users/:id/status blocks a user and deletes their sessions', async () => {
    const admin = await insertUserAndSession('admin13', true);
    const targetId = await insertUserOnly('blockme', false);
    // Give the target a session that blockUser should delete
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        'session-blockme',
        targetId,
        JSON.stringify({ userId: targetId, username: 'blockme', role: 'member', createdAt: now }),
        now + 7 * 24 * 60 * 60 * 1000,
        now,
      )
      .run();

    const res = await app.request(
      `/api/admin/users/${targetId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ status: 'blocked' }),
      },
      env,
    );
    expect(res.status).toBe(204);

    const user = await env.DB.prepare('SELECT is_blocked FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ is_blocked: number }>();
    expect(user?.is_blocked).toBe(1);

    const session = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
      .bind('session-blockme')
      .first();
    expect(session).toBeNull();
  });

  it('PATCH /api/admin/users/:id/status unblocks a previously blocked user', async () => {
    const admin = await insertUserAndSession('admin14', true);
    const targetId = await insertUserOnly('unblockme', false);
    await env.DB.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').bind(targetId).run();

    const res = await app.request(
      `/api/admin/users/${targetId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ status: 'active' }),
      },
      env,
    );
    expect(res.status).toBe(204);

    const user = await env.DB.prepare('SELECT is_blocked FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ is_blocked: number }>();
    expect(user?.is_blocked).toBe(0);
  });

  it('PATCH /api/admin/users/:id/status: blocking yourself returns 400', async () => {
    const admin = await insertUserAndSession('selfblock', true);
    const res = await app.request(
      `/api/admin/users/${admin.userId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ status: 'blocked' }),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('own account');
  });

  it('PATCH /api/admin/users/:id/status: rejecting zod-invalid status (→ 400)', async () => {
    const admin = await insertUserAndSession('admin15', true);
    const targetId = await insertUserOnly('target6', false);
    const res = await app.request(
      `/api/admin/users/${targetId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: ORIGIN },
        body: JSON.stringify({ status: 'frozen' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('PATCH /api/admin/users/:id/status returns 403 for a non-super-admin', async () => {
    const member = await insertUserAndSession('notadmin5', false);
    const targetId = await insertUserOnly('target7', false);
    const res = await app.request(
      `/api/admin/users/${targetId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: member.cookie, Origin: ORIGIN },
        body: JSON.stringify({ status: 'blocked' }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  // ─── DELETE /users/:id ───

  it('DELETE /api/admin/users/:id deletes a user and cascades to dependent rows', async () => {
    const admin = await insertUserAndSession('admin16', true);
    const targetId = await insertUserOnly('deleteme', false);
    // Give the target a drive account + session that the cascade should remove
    await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
      .bind('drive-deleteme', targetId, 'deleteme@example.com')
      .run();
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('session-deleteme', targetId, '{}', Date.now() + 100000, Date.now())
      .run();

    const res = await app.request(
      `/api/admin/users/${targetId}`,
      {
        method: 'DELETE',
        headers: { Cookie: admin.cookie, Origin: ORIGIN },
      },
      env,
    );
    expect(res.status).toBe(204);

    const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
    expect(user).toBeNull();

    const drive = await env.DB.prepare('SELECT id FROM drive_accounts WHERE id = ?')
      .bind('drive-deleteme')
      .first();
    expect(drive).toBeNull();

    const session = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
      .bind('session-deleteme')
      .first();
    expect(session).toBeNull();
  });

  it('DELETE /api/admin/users/:id: deleting yourself returns 400', async () => {
    const admin = await insertUserAndSession('selfdelete2', true);
    const res = await app.request(
      `/api/admin/users/${admin.userId}`,
      {
        method: 'DELETE',
        headers: { Cookie: admin.cookie, Origin: ORIGIN },
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('own account');
  });

  it('DELETE /api/admin/users/:id returns 403 for a non-super-admin', async () => {
    const member = await insertUserAndSession('notadmin6', false);
    const targetId = await insertUserOnly('target8', false);
    const res = await app.request(
      `/api/admin/users/${targetId}`,
      {
        method: 'DELETE',
        headers: { Cookie: member.cookie, Origin: ORIGIN },
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  // ─── Cross-user isolation: non-admin gets 403 on every admin user endpoint ───

  it('non-super-admin gets 403 on every admin user endpoint (cross-user isolation)', async () => {
    const member = await insertUserAndSession('isolated', false);
    const otherUserId = await insertUserOnly('other', false);

    // GET
    let res = await app.request(
      '/api/admin/users',
      { headers: { Cookie: member.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(403);

    // POST
    res = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: member.cookie, Origin: ORIGIN },
        body: JSON.stringify({ username: 'x', password: 'NewPass123!' }),
      },
      env,
    );
    expect(res.status).toBe(403);

    // PATCH role
    res = await app.request(
      `/api/admin/users/${otherUserId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: member.cookie, Origin: ORIGIN },
        body: JSON.stringify({ role: 'super_admin' }),
      },
      env,
    );
    expect(res.status).toBe(403);

    // PATCH status
    res = await app.request(
      `/api/admin/users/${otherUserId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: member.cookie, Origin: ORIGIN },
        body: JSON.stringify({ status: 'blocked' }),
      },
      env,
    );
    expect(res.status).toBe(403);

    // DELETE
    res = await app.request(
      `/api/admin/users/${otherUserId}`,
      {
        method: 'DELETE',
        headers: { Cookie: member.cookie, Origin: ORIGIN },
      },
      env,
    );
    expect(res.status).toBe(403);

    // The target user is unchanged (no privilege escalation via 403)
    const other = await env.DB.prepare('SELECT is_super_admin, is_blocked FROM users WHERE id = ?')
      .bind(otherUserId)
      .first<{ is_super_admin: number; is_blocked: number }>();
    expect(other?.is_super_admin).toBe(0);
    expect(other?.is_blocked).toBe(0);
  });
});
