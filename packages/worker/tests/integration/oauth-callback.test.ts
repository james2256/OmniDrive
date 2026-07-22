import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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
// app.request() in tests has no ExecutionContext — the callback route uses
// c.executionCtx.waitUntil for background sync. The stub swallows the promise
// so background sync (which needs a sync_state table not in the test schema)
// never executes.
const executionCtx = { waitUntil: (_promise: Promise<unknown>) => {} };

async function insertUserAndSession(username: string): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${username}`;
  const passwordHash = await hashPassword('TestPass123!');
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

describe('OAuth callback (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
    // The integration config binds GOOGLE_CLIENT_ID as empty string.
    // The /google route rejects empty IDs, so set test values.
    (env as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    (env as { GOOGLE_CLIENT_SECRET: string }).GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    vi.restoreAllMocks();
  });

  it('GET /google returns a valid OAuth URL with PKCE parameters', async () => {
    const { cookie } = await insertUserAndSession('alice');

    const res = await app.request('/api/auth/google', {
      headers: { Cookie: cookie, Origin: ORIGIN },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { url: string };
    const url = new URL(body.url);

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8888/api/auth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('drive');

    // State row persisted in D1
    const state = url.searchParams.get('state')!;
    const row = await env.DB.prepare('SELECT user_id FROM oauth_states WHERE state = ?')
      .bind(state).first() as { user_id: string } | null;
    expect(row?.user_id).toBe('user-alice');
  });

  it('GET /callback with invalid state cookie returns 400', async () => {
    const res = await app.request('/api/auth/callback?code=fakecode&state=wrong-state', {
      headers: { Cookie: 'oauth_state=different-state', Origin: ORIGIN },
    }, env);

    expect(res.status).toBe(400);
  });

  it('GET /callback with expired state (not in DB) returns 400', async () => {
    // State cookie matches the query param, but no row in oauth_states table
    const res = await app.request('/api/auth/callback?code=fakecode&state=unknown-state', {
      headers: { Cookie: 'oauth_state=unknown-state', Origin: ORIGIN },
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('expired');
  });

  it('GET /callback with valid state creates drive account + encrypted tokens', async () => {
    const { userId, cookie } = await insertUserAndSession('bob');

    // Insert a valid oauth_state row (matching cookie value)
    const state = 'valid-state-bob';
    await env.DB.prepare(
      'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)'
    ).bind(state, 'test-verifier', userId, Date.now()).run();

    // Mock Google token + userinfo endpoints
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({
          access_token: 'fake-access-token',
          refresh_token: 'fake-refresh-token',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return new Response(JSON.stringify({
          id: 'google-account-123',
          email: 'bob@gmail.com',
          name: 'Bob Smith',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Any other fetch (e.g. Google Drive API during sync) — return empty 200
      return new Response('{}', { status: 200 });
    });

    const res = await app.request(`/api/auth/callback?code=fakecode&state=${state}`, {
      headers: { Cookie: `${cookie}; oauth_state=${state}`, Origin: ORIGIN },
    }, env, executionCtx);

    expect(res.status).toBe(200);

    // Drive account created
    const drive = await env.DB.prepare(
      'SELECT id, google_account_id, email, name, is_primary FROM drive_accounts WHERE user_id = ?'
    ).bind(userId).first() as { id: string; google_account_id: string; email: string; name: string; is_primary: number } | null;
    expect(drive).toBeTruthy();
    expect(drive!.google_account_id).toBe('google-account-123');
    expect(drive!.email).toBe('bob@gmail.com');
    expect(drive!.is_primary).toBe(1);

    // Encrypted tokens persisted
    const tokens = await env.DB.prepare(
      'SELECT encrypted_tokens FROM drive_tokens WHERE drive_account_id = ?'
    ).bind(drive!.id).first() as { encrypted_tokens: string } | null;
    expect(tokens).toBeTruthy();
    expect(tokens!.encrypted_tokens).not.toContain('fake-access-token'); // encrypted, not plaintext

    // user.google_id updated
    const user = await env.DB.prepare('SELECT google_id FROM users WHERE id = ?')
      .bind(userId).first() as { google_id: string } | null;
    expect(user?.google_id).toBe('google-account-123');

    // State row consumed (deleted)
    const stateRow = await env.DB.prepare('SELECT state FROM oauth_states WHERE state = ?')
      .bind(state).first();
    expect(stateRow).toBeNull();

    globalThis.fetch = originalFetch;
  });

  it('GET /callback with existing google_id reuses drive account (no duplicate)', async () => {
    const { userId, cookie } = await insertUserAndSession('carol');

    // Pre-insert a drive account with the same google_id the mock will return
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, is_primary, root_folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('drive-existing', userId, 'google-account-reuse', 'carol@gmail.com', 'Carol', 1, null).run();

    const state = 'valid-state-carol';
    await env.DB.prepare(
      'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)'
    ).bind(state, 'test-verifier', userId, Date.now()).run();

    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({
          access_token: 'fake-access-token-2',
          refresh_token: 'fake-refresh-token-2',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return new Response(JSON.stringify({
          id: 'google-account-reuse',
          email: 'carol@gmail.com',
          name: 'Carol Updated',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    });

    const res = await app.request(`/api/auth/callback?code=fakecode&state=${state}`, {
      headers: { Cookie: `${cookie}; oauth_state=${state}`, Origin: ORIGIN },
    }, env, executionCtx);

    expect(res.status).toBe(200);

    // No duplicate drive account created
    const drives = await env.DB.prepare(
      'SELECT id FROM drive_accounts WHERE user_id = ? AND google_account_id = ?'
    ).bind(userId, 'google-account-reuse').all();
    expect(drives.results.length).toBe(1);
    expect((drives.results[0] as { id: string }).id).toBe('drive-existing');

    globalThis.fetch = originalFetch;
  });
});
