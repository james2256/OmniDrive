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
const executionCtx = { waitUntil: vi.fn() };

async function createUserAndSession(username: string): Promise<{ userId: string; cookie: string }> {
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

async function createWorkspace(ownerUserId: string, wsId: string) {
  await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
    .bind(wsId, `Workspace ${wsId}`, ownerUserId).run();
  await env.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
    .bind(`wm-${wsId}`, wsId, ownerUserId, 'owner').run();
}

async function createDrive(userId: string, driveId: string) {
  await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
    .bind(driveId, userId, `${driveId}@example.com`).run();
}

async function createFile(params: {
  id: string; userId: string; driveId: string; name: string;
  workspaceId?: string | null; workspaceFolderId?: string | null;
}) {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, google_file_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    params.id, params.userId, params.driveId,
    params.workspaceId ?? null, params.workspaceFolderId ?? null,
    `gfile-${params.id}`, params.name,
  ).run();
}

async function createWorkspaceFolder(wsId: string, folderId: string, name: string, parentId: string | null = null) {
  await env.DB.prepare(
    'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)'
  ).bind(folderId, wsId, name, parentId).run();
}

describe('Folder browsing (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // 5.1 — GET /tree returns workspaces + folders
  it('GET /tree returns workspaces as roots + all folders', async () => {
    const user = await createUserAndSession('user-tree');
    await createWorkspace(user.userId, 'ws-tree');
    await createWorkspaceFolder('ws-tree', 'wf-tree-1', 'Subfolder');

    const res = await app.request('/api/folders/tree', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { folders: { name: string; id: string }[] };
    const names = body.folders.map(f => f.name);
    // Workspace appears as a root folder
    expect(names).toContain('Workspace ws-tree');
    // Subfolder also appears
    expect(names).toContain('Subfolder');
  });

  // 5.2 — GET / (no id) lists workspaces as root folders
  it('GET / with no id lists workspaces as root folders', async () => {
    const user = await createUserAndSession('user-root');
    await createWorkspace(user.userId, 'ws-root1');
    await createWorkspace(user.userId, 'ws-root2');

    const res = await app.request('/api/folders', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { subfolders: { name: string }[] };
    const names = body.subfolders.map(f => f.name);
    expect(names).toContain('Workspace ws-root1');
    expect(names).toContain('Workspace ws-root2');
  });

  // 5.3 — GET /:workspaceId lists root folders + files
  it('GET /:workspaceId lists root folders + files in workspace', async () => {
    const user = await createUserAndSession('user-ws');
    await createWorkspace(user.userId, 'ws-list');
    await createDrive(user.userId, 'drive-ws');
    await createWorkspaceFolder('ws-list', 'wf-list-1', 'Root Folder');
    await createFile({ id: 'file-ws-1', userId: user.userId, driveId: 'drive-ws', name: 'ws-root-file.txt', workspaceId: 'ws-list' });

    const res = await app.request('/api/folders/ws-list', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env, executionCtx);
    expect(res.status).toBe(200);
    const body = await res.json() as { folder: { name: string } | null; subfolders: { name: string }[]; files: { name: string }[] };
    expect(body.folder?.name).toBe('Workspace ws-list');
    expect(body.subfolders.map(s => s.name)).toContain('Root Folder');
    expect(body.files.map(f => f.name)).toContain('ws-root-file.txt');
  });

  // 5.4 — GET /:folderId lists subfolders + files + breadcrumb
  it('GET /:folderId lists subfolders + files + breadcrumb', async () => {
    const user = await createUserAndSession('user-folder');
    await createWorkspace(user.userId, 'ws-folder');
    await createDrive(user.userId, 'drive-folder');
    // Create parent folder in workspace
    await createWorkspaceFolder('ws-folder', 'wf-parent', 'Parent Folder');
    // Create subfolder inside parent
    await createWorkspaceFolder('ws-folder', 'wf-child', 'Child Folder', 'wf-parent');
    // Create file inside parent folder
    await createFile({ id: 'file-folder-1', userId: user.userId, driveId: 'drive-folder', name: 'inside-folder.txt', workspaceId: 'ws-folder', workspaceFolderId: 'wf-parent' });

    const res = await app.request('/api/folders/wf-parent', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env, executionCtx);
    expect(res.status).toBe(200);
    const body = await res.json() as { folder: { name: string } | null; subfolders: { name: string }[]; files: { name: string }[]; breadcrumb: { name: string }[] };
    expect(body.folder?.name).toBe('Parent Folder');
    expect(body.subfolders.map(s => s.name)).toContain('Child Folder');
    expect(body.files.map(f => f.name)).toContain('inside-folder.txt');
    // Breadcrumb should include workspace name + folder name
    const breadcrumbNames = body.breadcrumb.map(b => b.name);
    expect(breadcrumbNames).toContain('Workspace ws-folder');
    expect(breadcrumbNames).toContain('Parent Folder');
  });

  // 5.5 — GET /:id with invalid id → 404
  it('GET /:invalidId returns 404', async () => {
    const user = await createUserAndSession('user-404');

    const res = await app.request('/api/folders/nonexistent-folder-id', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(404);
  });

  // 5.6 — Cursor pagination returns nextCursor + hasMore
  it('cursor pagination returns nextCursor + hasMore when limit exceeded', async () => {
    const user = await createUserAndSession('user-paginate');
    await createWorkspace(user.userId, 'ws-paginate');
    await createDrive(user.userId, 'drive-paginate');

    // Create 3 files in workspace root, request limit=2
    for (let i = 1; i <= 3; i++) {
      await createFile({
        id: `file-pag-${i}`, userId: user.userId, driveId: 'drive-paginate',
        name: `file-${i}.txt`, workspaceId: 'ws-paginate',
      });
    }

    const res = await app.request('/api/folders/ws-paginate?limit=2', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env, executionCtx);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[]; pagination: { nextCursor: string | null; hasMore: boolean } };
    expect(body.files.length).toBe(2); // limited to 2
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBeTruthy();

    // Fetch next page using cursor
    const res2 = await app.request(`/api/folders/ws-paginate?limit=2&cursor=${encodeURIComponent(body.pagination.nextCursor!)}`, {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env, executionCtx);
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as { files: { name: string }[]; pagination: { nextCursor: string | null; hasMore: boolean } };
    expect(body2.files.length).toBe(1); // only 1 remaining
    expect(body2.pagination.hasMore).toBe(false);
    expect(body2.pagination.nextCursor).toBeNull();
  });
});
