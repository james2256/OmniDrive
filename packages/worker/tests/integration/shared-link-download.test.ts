import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../../src/index';
import { ensureSchema, clearAllTables } from './helpers';
import { hashPassword, hashSharedPassword } from '../../src/lib/password';
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
const executionCtx = { waitUntil: vi.fn() };

describe('Shared link create + meta (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);

    // Seed: user + drive account + file
    const passwordHash = await hashPassword('TestPass123!');
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
    )
      .bind('sl-user-1', 'slowner', passwordHash, 1)
      .run();

    const now = Date.now();
    const sessionData: SessionData = {
      userId: 'sl-user-1',
      username: 'slowner',
      email: null,
      name: 'slowner',
      avatarUrl: null,
      role: 'super_admin',
      createdAt: now,
    };
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        'sl-session-1',
        'sl-user-1',
        JSON.stringify(sessionData),
        now + 7 * 24 * 60 * 60 * 1000,
        now,
      )
      .run();

    await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
      .bind('sl-drive-1', 'sl-user-1', 'slowner@example.com')
      .run();
    await env.DB.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('sl-file-1', 'sl-user-1', 'sl-drive-1', 'gfile-1', 'shared-doc.txt')
      .run();
  });

  it('creates a shared link via the API', async () => {
    const res = await app.request(
      '/api/shared',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'omnidrive_sid=sl-session-1',
          Origin: ORIGIN,
        },
        body: JSON.stringify({
          targetType: 'file',
          targetId: 'sl-file-1',
          allowDownloads: true,
          allowUploads: false,
          requireEmail: false,
        }),
      },
      env,
      executionCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.id).toBeTruthy();
    expect(body.url).toContain('/shared/');
  });

  it('GET /:id/meta returns 404 for a non-existent link', async () => {
    const res = await app.request(
      '/api/shared/nonexistent-link/meta',
      {
        headers: { Origin: ORIGIN },
      },
      env,
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  // ─── A-01: Shared-link password bypass via cookie swap ───
  it('email JWT cannot be used as session JWT to bypass password', async () => {
    // Clean and re-seed for this test
    await clearAllTables(env.DB);

    const passwordHash = await hashPassword('TestPass123!');
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
    )
      .bind('sl-user-2', 'sluser2', passwordHash, 1)
      .run();

    const now = Date.now();
    const sessionData: SessionData = {
      userId: 'sl-user-2',
      username: 'sluser2',
      email: null,
      name: 'sluser2',
      avatarUrl: null,
      role: 'super_admin',
      createdAt: now,
    };
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        'sl-session-2',
        'sl-user-2',
        JSON.stringify(sessionData),
        now + 7 * 24 * 60 * 60 * 1000,
        now,
      )
      .run();

    await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
      .bind('sl-drive-2', 'sl-user-2', 'sluser2@example.com')
      .run();
    await env.DB.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('sl-file-2', 'sl-user-2', 'sl-drive-2', 'gfile-2', 'protected-doc.txt')
      .run();

    // Create a shared link with BOTH requireEmail=true AND passwordHash
    const sharedPasswordHash = await hashSharedPassword('s3cret-link-pass');
    await env.DB.prepare(
      `INSERT INTO shared_links (id, user_id, target_type, target_id, password_hash, allow_downloads, require_email)
       VALUES (?, ?, 'file', ?, ?, 1, 1)`,
    )
      .bind('link-bypass-test', 'sl-user-2', 'sl-file-2', sharedPasswordHash)
      .run();

    // Step 1: POST any email to /:id/email → get shared_email cookie (signed JWT)
    const emailRes = await app.request(
      '/api/shared/link-bypass-test/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email: 'attacker@evil.com' }),
      },
      env,
      executionCtx,
    );
    expect(emailRes.status).toBe(204);

    // Extract the shared_email cookie from the Set-Cookie header
    const setCookieHeader = emailRes.headers.get('set-cookie') || '';
    const emailCookieMatch = setCookieHeader.match(/shared_email_link-bypass-test=([^;]+)/);
    expect(emailCookieMatch).toBeTruthy();
    const emailCookieValue = emailCookieMatch![1];

    // Step 2: Use the email JWT as the session cookie (the attack)
    const metaRes = await app.request(
      '/api/shared/link-bypass-test/meta',
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `shared_email_link-bypass-test=${emailCookieValue}; shared_session_link-bypass-test=${emailCookieValue}`,
        },
      },
      env,
      executionCtx,
    );

    // The email JWT should NOT pass the session check (no kind: 'session')
    // → should return 401 Password required, NOT 200
    expect(metaRes.status).toBe(401);
    const body = await metaRes.text();
    expect(body).toContain('Password required');
  });

  it('legitimate session JWT with kind:session grants access after password verify', async () => {
    // The link from the previous test still exists (requireEmail + passwordHash)
    // Step 1: Submit the correct password to get a real session JWT
    const verifyRes = await app.request(
      '/api/shared/link-bypass-test/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ password: 's3cret-link-pass' }),
      },
      env,
      executionCtx,
    );
    expect(verifyRes.status).toBe(204);

    // Extract the shared_session cookie
    const setCookieHeader = verifyRes.headers.get('set-cookie') || '';
    const sessionCookieMatch = setCookieHeader.match(/shared_session_link-bypass-test=([^;]+)/);
    expect(sessionCookieMatch).toBeTruthy();
    const sessionCookieValue = sessionCookieMatch![1];

    // Step 2: Also submit an email to get the email cookie (required by requireEmail gate)
    const emailRes = await app.request(
      '/api/shared/link-bypass-test/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
      env,
      executionCtx,
    );
    expect(emailRes.status).toBe(204);
    const emailSetCookie = emailRes.headers.get('set-cookie') || '';
    const emailCookieMatch = emailSetCookie.match(/shared_email_link-bypass-test=([^;]+)/);
    const emailCookieValue = emailCookieMatch![1];

    // Step 3: Use both cookies — email gate + session (with kind: 'session')
    const metaRes = await app.request(
      '/api/shared/link-bypass-test/meta',
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `shared_email_link-bypass-test=${emailCookieValue}; shared_session_link-bypass-test=${sessionCookieValue}`,
        },
      },
      env,
      executionCtx,
    );

    // Legitimate session JWT (with kind: 'session') should pass
    expect(metaRes.status).toBe(200);
  });
});
