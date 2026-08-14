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

async function insertUserAndSession(username: string): Promise<{ userId: string; cookie: string }> {
  const userId = `rs-${username}`;
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, username, passwordHash, 1)
    .run();

  const now = Date.now();
  const sessionData: SessionData = {
    userId,
    username,
    email: null,
    name: username,
    avatarUrl: null,
    role: 'super_admin',
    createdAt: now,
  };
  const sessionId = `rs-session-${username}-${now}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now)
    .run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

async function insertDrive(userId: string, driveId: string, email: string): Promise<void> {
  await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
    .bind(driveId, userId, email)
    .run();
}

describe('POST /api/drives/:id/resync (integration)', () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    const user = await insertUserAndSession('alice');
    cookie = user.cookie;
    userId = user.userId;
    await insertDrive(userId, 'rs-drive', 'alice@example.com');
  });

  it('returns 404 for unknown drive', async () => {
    const res = await app.request(
      '/api/drives/nonexistent/resync',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when sync is actively running', async () => {
    // Insert sync_state WITH a change_token — the SQL guard should prevent
    // resetChangeToken from clearing it while status='syncing'.
    await env.DB.prepare(
      'INSERT INTO sync_state (drive_account_id, status, change_token) VALUES (?, ?, ?)',
    )
      .bind('rs-drive', 'syncing', 'active-change-token')
      .run();

    const res = await app.request(
      '/api/drives/rs-drive/resync',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Sync in progress');

    // Verify change_token was NOT cleared — the SQL guard (AND status != 'syncing')
    // prevented the UPDATE from running. If the guard were missing, change_token
    // would be NULL after the route.
    const syncState = await env.DB.prepare(
      'SELECT change_token, status FROM sync_state WHERE drive_account_id = ?',
    )
      .bind('rs-drive')
      .first<{ change_token: string | null; status: string }>();
    expect(syncState).not.toBeNull();
    expect(syncState?.change_token).toBe('active-change-token');
    expect(syncState?.status).toBe('syncing');
  });

  it('returns 204 + clears change_token when sync is idle', async () => {
    // Insert sync_state with a change_token to verify it gets cleared
    await env.DB.prepare(
      'INSERT INTO sync_state (drive_account_id, status, change_token) VALUES (?, ?, ?)',
    )
      .bind('rs-drive', 'idle', 'old-change-token')
      .run();

    const res = await app.request(
      '/api/drives/rs-drive/resync',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
      },
      env,
    );

    expect(res.status).toBe(204);

    // Verify change_token was cleared (force full re-sync on next cycle)
    const syncState = await env.DB.prepare(
      'SELECT change_token, status FROM sync_state WHERE drive_account_id = ?',
    )
      .bind('rs-drive')
      .first<{ change_token: string | null; status: string }>();
    expect(syncState?.change_token).toBeNull();
    expect(syncState?.status).toBe('idle');
  });

  it('returns 204 when sync_state row does not exist (first sync)', async () => {
    // No sync_state row — drive was just connected, never synced
    const res = await app.request(
      '/api/drives/rs-drive/resync',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
      },
      env,
    );

    expect(res.status).toBe(204);
  });
});
