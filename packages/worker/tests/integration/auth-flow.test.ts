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
 * Insert a user + session directly via D1 (bypasses the register route's
 * rate limiter — 10 calls per 10 min). Used by session-security tests that
 * need a pre-authenticated user without consuming a register call.
 * Uses a real password hash so verifyPassword works in change-password tests.
 */
async function insertUserAndSession(username: string, password = 'TestPass123!'): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${username}`;
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)'
  ).bind(userId, username, passwordHash, 1).run();

  const now = Date.now();
  const sessionData: SessionData = {
    userId, username, email: null, name: username, avatarUrl: null,
    role: 'super_admin', createdAt: now,
  };
  const sessionId = `session-${username}-${now}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now).run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

describe('Auth flow (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  it('registers a new user and returns SessionData', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'alice', password: 'TestPass123!' }),
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; user: { userId: string; username: string; role: string }; isSuperAdmin: boolean };
    expect(body.success).toBe(true);
    expect(body.user.username).toBe('alice');
    expect(body.user.role).toBe('super_admin');
    expect(body.isSuperAdmin).toBe(true);
  });

  it('response includes x-request-id header', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'bob', password: 'TestPass123!' }),
    }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('logs in with registered credentials', async () => {
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'carol', password: 'TestPass123!' }),
    }, env);

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'carol', password: 'TestPass123!' }),
    }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('omnidrive_sid=');
  });

  it('GET /me returns the logged-in user', async () => {
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'dave', password: 'TestPass123!' }),
    }, env);
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'dave', password: 'TestPass123!' }),
    }, env);
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];

    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: cookie, Origin: ORIGIN },
    }, env);
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json() as { user: { userId: string; username: string; role: string } };
    expect(meBody.user.username).toBe('dave');
    expect(meBody.user.role).toBe('super_admin');
  });

  it('rejects login with wrong password', async () => {
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'eve', password: 'TestPass123!' }),
    }, env);

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'eve', password: 'WrongPassword!' }),
    }, env);
    expect(res.status).toBe(401);
  });
});

describe('Auth session security (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // 2.1 — change password → other sessions revoked, current kept
  it('change password revokes other sessions but keeps current', async () => {
    // Insert user with real password hash + two sessions
    const user = await insertUserAndSession('frank');

    // Create a second session for the same user
    const now = Date.now();
    const sessionId2 = `session-frank-2-${now}`;
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(sessionId2, user.userId, JSON.stringify({ userId: user.userId, username: 'frank', role: 'super_admin', createdAt: now }), now + 7 * 24 * 60 * 60 * 1000, now).run();
    const cookie2 = `omnidrive_sid=${sessionId2}`;

    // Change password using cookie (the "current" session)
    const changeRes = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
      body: JSON.stringify({ currentPassword: 'TestPass123!', newPassword: 'NewPass456!' }),
    }, env);
    expect(changeRes.status).toBe(200);

    // The other session should be revoked (401)
    const me1 = await app.request('/api/auth/me', {
      headers: { Cookie: cookie2, Origin: ORIGIN },
    }, env);
    expect(me1.status).toBe(401);

    // The current session should still work (200)
    const me2 = await app.request('/api/auth/me', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(me2.status).toBe(200);
  });

  // 2.2 — change password → wrong current password → 401
  it('change password with wrong current password fails', async () => {
    const user = await insertUserAndSession('grace');

    const res = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
      body: JSON.stringify({ currentPassword: 'WrongPassword!', newPassword: 'NewPass456!' }),
    }, env);
    expect(res.status).toBe(401);
  });

  // 2.3 — logout → session deleted
  it('logout deletes the session', async () => {
    const user = await insertUserAndSession('henry');

    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(logoutRes.status).toBe(200);

    const me = await app.request('/api/auth/me', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(me.status).toBe(401);
  });

  // 2.4 — sessions/revoke → all sessions deleted
  it('sessions/revoke deletes all user sessions', async () => {
    const user = await insertUserAndSession('ivan');

    // Create a second session
    const now = Date.now();
    const sessionId2 = `session-ivan-2-${now}`;
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(sessionId2, user.userId, JSON.stringify({ userId: user.userId, username: 'ivan', role: 'super_admin', createdAt: now }), now + 7 * 24 * 60 * 60 * 1000, now).run();
    const cookie2 = `omnidrive_sid=${sessionId2}`;

    const revokeRes = await app.request('/api/auth/sessions/revoke', {
      method: 'POST',
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(revokeRes.status).toBe(200);

    // Both sessions should be revoked
    const me1 = await app.request('/api/auth/me', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(me1.status).toBe(401);

    const me2 = await app.request('/api/auth/me', {
      headers: { Cookie: cookie2, Origin: ORIGIN },
    }, env);
    expect(me2.status).toBe(401);
  });

  // 2.5 — register with invitation code → code consumed atomically
  it('register with invitation code consumes it atomically', async () => {
    // Insert first user directly (bypasses register route's rate limiter)
    const firstHash = await hashPassword('TestPass123!');
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)'
    ).bind('user-first', 'first', firstHash, 1).run();

    // Create an invitation code
    await env.DB.prepare(
      'INSERT INTO invitation_codes (id, code, created_by, max_uses, used_count) VALUES (?, ?, ?, ?, ?)'
    ).bind('inv-1', 'TESTCODE123456', 'user-first', 1, 0).run();

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'second', password: 'TestPass123!', invitation_code: 'TESTCODE123456' }),
    }, env);
    expect(res.status).toBe(200);

    // Verify the code was consumed (used_count = 1)
    const code = await env.DB.prepare('SELECT used_count FROM invitation_codes WHERE code = ?')
      .bind('TESTCODE123456').first<{ used_count: number }>();
    expect(code?.used_count).toBe(1);
  });

  // 2.6 — register with exhausted code → 400
  it('register with exhausted invitation code fails', async () => {
    const firstHash = await hashPassword('TestPass123!');
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)'
    ).bind('user-first2', 'first2', firstHash, 1).run();

    // Create an invitation code with max_uses = 1, already used once
    await env.DB.prepare(
      'INSERT INTO invitation_codes (id, code, created_by, max_uses, used_count) VALUES (?, ?, ?, ?, ?)'
    ).bind('inv-2', 'EXHAUSTEDCODE1', 'user-first2', 1, 1).run();

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'second2', password: 'TestPass123!', invitation_code: 'EXHAUSTEDCODE1' }),
    }, env);
    expect(res.status).toBe(400);
  });
});
