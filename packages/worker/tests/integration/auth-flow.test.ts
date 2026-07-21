// @vitest-environment workers
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { ensureSchema, clearAllTables } from './helpers';

declare module 'cloudflare:test' {
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
    expect(body.user.role).toBe('super_admin'); // first user is super admin
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
    // Register first
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'carol', password: 'TestPass123!' }),
    }, env);

    // Login
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: 'carol', password: 'TestPass123!' }),
    }, env);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('omnidrive_sid=');
  });

  it('GET /me returns the logged-in user', async () => {
    // Register + login to get session cookie
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
