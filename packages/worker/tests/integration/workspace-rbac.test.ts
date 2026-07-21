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
    'INSERT INTO users (id, username, password_hash, is_super_admin, email) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, username, passwordHash, isSuperAdmin ? 1 : 0, `${username}@example.com`).run();

  const now = Date.now();
  const sessionData: SessionData = {
    userId, username, email: `${username}@example.com`, name: username, avatarUrl: null,
    role: isSuperAdmin ? 'super_admin' : 'member', createdAt: now,
  };
  const sessionId = `session-${username}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now).run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

async function createWorkspace(ownerUserId: string, name = 'Test Workspace') {
  const wsId = `ws-${name.replace(/\s/g, '-').toLowerCase()}`;
  await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
    .bind(wsId, name, ownerUserId).run();
  await env.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
    .bind(`wm-owner-${wsId}`, wsId, ownerUserId, 'owner').run();
  return wsId;
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
    .bind(`wm-${userId}-${workspaceId}`, workspaceId, userId, role).run();
}

describe('Workspace RBAC (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // Existing test — viewer cannot delete a file
  it('viewer cannot delete a file in the workspace (403 before Google API)', async () => {
    const owner = await createUserAndSession('owner1', true);
    const viewer = await createUserAndSession('viewer1', false);
    const wsId = await createWorkspace(owner.userId);
    await addMember(wsId, viewer.userId, 'viewer');

    await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
      .bind('drive-1', owner.userId, 'owner1@example.com').run();
    await env.DB.prepare('INSERT INTO files (id, user_id, drive_account_id, workspace_id, google_file_id, name) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('file-1', owner.userId, 'drive-1', wsId, 'gfile-1', 'test.txt').run();

    const res = await app.request('/api/files/file-1', {
      method: 'DELETE',
      headers: { Cookie: viewer.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(403);
  });

  // 1.1 — owner adds viewer → success + audit log
  it('owner can add a viewer to the workspace + audit log is created', async () => {
    const owner = await createUserAndSession('owner2', true);
    await createUserAndSession('member2', false);
    const wsId = await createWorkspace(owner.userId);

    const res = await app.request(`/api/workspaces/${wsId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie, Origin: ORIGIN },
      body: JSON.stringify({ email: 'member2@example.com', role: 'viewer' }),
    }, env);
    expect(res.status).toBe(201);

    const { results: logs } = await env.DB.prepare(
      'SELECT action_type, resource_name, metadata FROM audit_logs WHERE workspace_id = ? AND action_type = ?'
    ).bind(wsId, 'member.invite').all();
    expect(logs.length).toBe(1);
    expect(logs[0].resource_name).toBe('member2@example.com');
    expect(JSON.parse(logs[0].metadata as string).role).toBe('viewer');
  });

  // 1.2 — manager cannot add another manager (role-escalation prevention)
  it('manager cannot add another manager (role-escalation prevention)', async () => {
    const owner = await createUserAndSession('owner3', true);
    const manager = await createUserAndSession('manager3', false);
    await createUserAndSession('target3', false);
    const wsId = await createWorkspace(owner.userId);
    await addMember(wsId, manager.userId, 'manager');

    const res = await app.request(`/api/workspaces/${wsId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: manager.cookie, Origin: ORIGIN },
      body: JSON.stringify({ email: 'target3@example.com', role: 'manager' }),
    }, env);
    expect(res.status).toBe(403);
  });

  // 1.3 — viewer cannot view audit logs (owner/manager/auditor only)
  it('viewer cannot view audit logs (owner/manager/auditor only)', async () => {
    const owner = await createUserAndSession('owner4', true);
    const viewer = await createUserAndSession('viewer4', false);
    const wsId = await createWorkspace(owner.userId);
    await addMember(wsId, viewer.userId, 'viewer');

    const res = await app.request(`/api/workspaces/${wsId}/audit-logs`, {
      headers: { Cookie: viewer.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(403);
  });

  // 1.4 — viewer cannot view policies (manager required)
  it('viewer cannot view policies (manager required)', async () => {
    const owner = await createUserAndSession('owner5', true);
    const viewer = await createUserAndSession('viewer5', false);
    const wsId = await createWorkspace(owner.userId);
    await addMember(wsId, viewer.userId, 'viewer');

    const res = await app.request(`/api/workspaces/${wsId}/policies`, {
      headers: { Cookie: viewer.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(403);
  });

  // 1.5 — user cannot remove themselves
  it('user cannot remove themselves from the workspace', async () => {
    const owner = await createUserAndSession('owner6', true);
    const editor = await createUserAndSession('editor6', false);
    const wsId = await createWorkspace(owner.userId);
    await addMember(wsId, editor.userId, 'editor');

    const res = await app.request(`/api/workspaces/${wsId}/members/${editor.userId}`, {
      method: 'DELETE',
      headers: { Cookie: editor.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(400);
  });

  // 1.6 — cannot remove the last owner
  it('cannot remove the last owner of the workspace', async () => {
    const owner = await createUserAndSession('owner7', true);
    const wsId = await createWorkspace(owner.userId);

    const res = await app.request(`/api/workspaces/${wsId}/members/${owner.userId}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(400);
  });

  // 1.7 — removing a member creates an audit log
  it('removing a member creates a member.remove audit log', async () => {
    const owner = await createUserAndSession('owner8', true);
    const editor = await createUserAndSession('editor8', false);
    const wsId = await createWorkspace(owner.userId);
    await addMember(wsId, editor.userId, 'editor');

    const res = await app.request(`/api/workspaces/${wsId}/members/${editor.userId}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);

    const { results: logs } = await env.DB.prepare(
      'SELECT action_type, resource_id FROM audit_logs WHERE workspace_id = ? AND action_type = ?'
    ).bind(wsId, 'member.remove').all();
    expect(logs.length).toBe(1);
    expect(logs[0].resource_id).toBe(editor.userId);
  });
});
