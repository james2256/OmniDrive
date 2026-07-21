import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../../src/index';
import { ensureSchema } from './helpers';
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
const executionCtx = { waitUntil: vi.fn() };

describe('Shared link create + meta (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);

    // Seed: user + drive account + file
    const passwordHash = await hashPassword('TestPass123!');
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)'
    ).bind('sl-user-1', 'slowner', passwordHash, 1).run();

    const now = Date.now();
    const sessionData: SessionData = {
      userId: 'sl-user-1', username: 'slowner', email: null, name: 'slowner',
      avatarUrl: null, role: 'super_admin', createdAt: now,
    };
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('sl-session-1', 'sl-user-1', JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now).run();

    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)'
    ).bind('sl-drive-1', 'sl-user-1', 'slowner@example.com').run();
    await env.DB.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name) VALUES (?, ?, ?, ?, ?)'
    ).bind('sl-file-1', 'sl-user-1', 'sl-drive-1', 'gfile-1', 'shared-doc.txt').run();
  });

  it('creates a shared link via the API', async () => {
    const res = await app.request('/api/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'omnidrive_sid=sl-session-1', Origin: ORIGIN },
      body: JSON.stringify({
        targetType: 'file',
        targetId: 'sl-file-1',
        allowDownloads: true,
        allowUploads: false,
        requireEmail: false,
      }),
    }, env, executionCtx);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; url: string };
    expect(body.id).toBeTruthy();
    expect(body.url).toContain('/shared/');
  });

  it('GET /:id/meta returns 404 for a non-existent link', async () => {
    const res = await app.request('/api/shared/nonexistent-link/meta', {
      headers: { Origin: ORIGIN },
    }, env, executionCtx);
    expect(res.status).toBe(404);
  });
});
