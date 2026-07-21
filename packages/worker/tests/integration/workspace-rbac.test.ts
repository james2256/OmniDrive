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

async function createUserAndSession(username: string, isSuperAdmin: boolean): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${username}`;
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)'
  ).bind(userId, username, passwordHash, isSuperAdmin ? 1 : 0).run();

  const now = Date.now();
  const sessionData: SessionData = {
    userId, username, email: null, name: username, avatarUrl: null,
    role: isSuperAdmin ? 'super_admin' : 'member', createdAt: now,
  };
  const sessionId = `session-${username}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now).run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

describe('Workspace RBAC (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  it('viewer cannot delete a file in the workspace (403 before Google API)', async () => {
    // Create owner + viewer users with sessions (bypasses register route's
    // invitation-code requirement — the auth flow is tested in auth-flow.test.ts)
    const owner = await createUserAndSession('owner1', true);
    const viewer = await createUserAndSession('viewer1', false);

    // Create a workspace owned by the owner
    await env.DB.prepare(
      'INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)'
    ).bind('ws-1', 'Test Workspace', owner.userId).run();

    // Add owner as 'owner' role + viewer as 'viewer' role
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).bind('wm-owner', 'ws-1', owner.userId, 'owner').run();
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).bind('wm-viewer', 'ws-1', viewer.userId, 'viewer').run();

    // Create a drive account + file owned by the owner in the workspace
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)'
    ).bind('drive-1', owner.userId, 'owner1@example.com').run();
    await env.DB.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, workspace_id, google_file_id, name) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('file-1', owner.userId, 'drive-1', 'ws-1', 'gfile-1', 'test.txt').run();

    // Viewer tries to delete (trash) the file → should get 403
    // (assertCanMutate throws AppError(403) before any Google API call)
    const deleteRes = await app.request('/api/files/file-1', {
      method: 'DELETE',
      headers: { Cookie: viewer.cookie, Origin: ORIGIN },
    }, env);
    expect(deleteRes.status).toBe(403);
  });
});
