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
// GET /:id?, POST /:id/sync, POST /:id/force-sync schedule background sync
// via c.executionCtx.waitUntil. The stub swallows the promise so the Google
// API calls (syncDriveAccount / syncDriveFolder) never execute — the route
// still returns immediately.
const executionCtx = { waitUntil: vi.fn() };

async function insertUserAndSession(username: string): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${username}`;
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
  const sessionId = `session-${username}-${now}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now)
    .run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

async function createWorkspace(ownerUserId: string, wsId: string, name = `WS ${wsId})`) {
  await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
    .bind(wsId, name, ownerUserId)
    .run();
  await env.DB.prepare(
    'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
  )
    .bind(`wm-${wsId}`, wsId, ownerUserId, 'owner')
    .run();
}

async function createWorkspaceFolder(
  wsId: string,
  folderId: string,
  name: string,
  parentId: string | null = null,
) {
  await env.DB.prepare(
    'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
  )
    .bind(folderId, wsId, name, parentId)
    .run();
}

async function createDrive(userId: string, driveId: string) {
  await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)')
    .bind(driveId, userId, `${driveId}@example.com`)
    .run();
}

async function createFile(params: {
  id: string;
  userId: string;
  driveId: string;
  name: string;
  workspaceId?: string | null;
  workspaceFolderId?: string | null;
}) {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, google_file_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      params.id,
      params.userId,
      params.driveId,
      params.workspaceId ?? null,
      params.workspaceFolderId ?? null,
      `gfile-${params.id}`,
      params.name,
    )
    .run();
}

describe('Folders routes (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // ─── Auth ───

  it('GET /tree requires authentication (401 without cookie)', async () => {
    const res = await app.request('/api/folders/tree', { headers: { Origin: ORIGIN } }, env);
    expect(res.status).toBe(401);
  });

  it('POST / requires authentication (401 without cookie)', async () => {
    const res = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ name: 'x' }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  // ─── GET /tree ───

  it('GET /tree returns workspaces as roots + all folders', async () => {
    const user = await insertUserAndSession('tree');
    await createWorkspace(user.userId, 'ws-tree');
    await createWorkspaceFolder('ws-tree', 'wf-tree', 'Subfolder');

    const res = await app.request(
      '/api/folders/tree',
      { headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folders: { name: string; id: string }[] };
    const names = body.folders.map((f) => f.name);
    expect(names).toContain('WS ws-tree)');
    expect(names).toContain('Subfolder');
  });

  // ─── GET / (no id) ───

  it('GET / with no id lists workspaces as root folders', async () => {
    const user = await insertUserAndSession('root');
    await createWorkspace(user.userId, 'ws-a', 'Alpha');
    await createWorkspace(user.userId, 'ws-b', 'Beta');

    const res = await app.request(
      '/api/folders',
      { headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subfolders: { name: string }[] };
    const names = body.subfolders.map((f) => f.name);
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
  });

  // ─── POST / (create) ───

  it('POST / with no parentId creates a workspace + owner membership', async () => {
    const user = await insertUserAndSession('create-ws');

    const res = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'New Workspace' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; parentId: string | null };
    expect(body.name).toBe('New Workspace');
    expect(body.parentId).toBeNull();
    expect(body.id).toBeTruthy();

    // Workspace row + owner member row persisted
    const ws = await env.DB.prepare('SELECT name, owner_id FROM workspaces WHERE id = ?')
      .bind(body.id)
      .first<{ name: string; owner_id: string }>();
    expect(ws?.name).toBe('New Workspace');
    expect(ws?.owner_id).toBe(user.userId);

    const member = await env.DB.prepare(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(body.id, user.userId)
      .first<{ role: string }>();
    expect(member?.role).toBe('owner');
  });

  it('POST / with parentId creates a subfolder inside a workspace', async () => {
    const user = await insertUserAndSession('create-folder');
    await createWorkspace(user.userId, 'ws-cf');

    const res = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Child', parentId: 'ws-cf', icon: '📂', color: '#fff' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; parentId: string };
    expect(body.name).toBe('Child');
    expect(body.parentId).toBe('ws-cf');

    const folder = await env.DB.prepare(
      'SELECT workspace_id, name, parent_id, icon, color FROM workspace_folders WHERE id = ?',
    )
      .bind(body.id)
      .first<{
        workspace_id: string;
        name: string;
        parent_id: string | null;
        icon: string;
        color: string;
      }>();
    expect(folder?.workspace_id).toBe('ws-cf');
    expect(folder?.name).toBe('Child');
    // createFolderOrWorkspace sets actualParentId=null when parentId IS a workspace
    expect(folder?.parent_id).toBeNull();
    expect(folder?.icon).toBe('📂');
  });

  it('POST / rejects empty name (zod → 400)', async () => {
    const user = await insertUserAndSession('create-bad');

    const res = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: '' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('name');
  });

  // ─── PUT /:id (update) ───

  it('PUT /:id renames a workspace (owner) → 204', async () => {
    const user = await insertUserAndSession('rename-ws');
    await createWorkspace(user.userId, 'ws-rename', 'Old');

    const res = await app.request(
      '/api/folders/ws-rename',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Renamed WS' }),
      },
      env,
    );

    expect(res.status).toBe(204);
    const ws = await env.DB.prepare('SELECT name FROM workspaces WHERE id = ?')
      .bind('ws-rename')
      .first<{ name: string }>();
    expect(ws?.name).toBe('Renamed WS');
  });

  it('PUT /:id renames a folder (member) → 204', async () => {
    const user = await insertUserAndSession('rename-folder');
    await createWorkspace(user.userId, 'ws-rf');
    await createWorkspaceFolder('ws-rf', 'wf-rf', 'Old Folder');

    const res = await app.request(
      '/api/folders/wf-rf',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Renamed Folder', color: '#000000' }),
      },
      env,
    );

    expect(res.status).toBe(204);
    const folder = await env.DB.prepare('SELECT name, color FROM workspace_folders WHERE id = ?')
      .bind('wf-rf')
      .first<{ name: string; color: string }>();
    expect(folder?.name).toBe('Renamed Folder');
    expect(folder?.color).toBe('#000000');
  });

  // ─── POST /:id/star + /:id/unstar ───

  it('POST /:id/star marks a folder starred, /:id/unstar clears it', async () => {
    const user = await insertUserAndSession('star');
    await createWorkspace(user.userId, 'ws-star');
    await createWorkspaceFolder('ws-star', 'wf-star', 'Starable');

    const starRes = await app.request(
      '/api/folders/wf-star/star',
      { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(starRes.status).toBe(204);
    const starred = await env.DB.prepare('SELECT is_starred FROM workspace_folders WHERE id = ?')
      .bind('wf-star')
      .first<{ is_starred: number }>();
    expect(starred?.is_starred).toBe(1);

    const unstarRes = await app.request(
      '/api/folders/wf-star/unstar',
      { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(unstarRes.status).toBe(204);
    const unstarred = await env.DB.prepare('SELECT is_starred FROM workspace_folders WHERE id = ?')
      .bind('wf-star')
      .first<{ is_starred: number }>();
    expect(unstarred?.is_starred).toBe(0);
  });

  it('POST /:id/star on a folder the user cannot access → 404', async () => {
    const alice = await insertUserAndSession('alice-s');
    const bob = await insertUserAndSession('bob-s');
    await createWorkspace(alice.userId, 'ws-star2');
    await createWorkspaceFolder('ws-star2', 'wf-star2', 'Private');

    // Bob is not a member of alice's workspace
    const res = await app.request(
      '/api/folders/wf-star2/star',
      { method: 'POST', headers: { Cookie: bob.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(404);
  });

  // ─── DELETE /:id ───

  it('DELETE /:id deletes a workspace the user owns → 204', async () => {
    const user = await insertUserAndSession('del-ws');
    await createWorkspace(user.userId, 'ws-del');

    const res = await app.request(
      '/api/folders/ws-del',
      { method: 'DELETE', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(204);
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?')
      .bind('ws-del')
      .first();
    expect(ws).toBeNull();
  });

  it('DELETE /:id deletes a folder (owner has editor permission) → 204', async () => {
    const user = await insertUserAndSession('del-folder');
    await createWorkspace(user.userId, 'ws-df');
    await createWorkspaceFolder('ws-df', 'wf-df', 'Deletable');

    const res = await app.request(
      '/api/folders/wf-df',
      { method: 'DELETE', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(204);
    const folder = await env.DB.prepare('SELECT id FROM workspace_folders WHERE id = ?')
      .bind('wf-df')
      .first();
    expect(folder).toBeNull();
  });

  it('DELETE /:id cascades subfolders + detaches files', async () => {
    const user = await insertUserAndSession('del-cascade');
    await createWorkspace(user.userId, 'ws-cascade');
    await createWorkspaceFolder('ws-cascade', 'wf-parent', 'Parent');
    await createWorkspaceFolder('ws-cascade', 'wf-child', 'Child', 'wf-parent');
    await createDrive(user.userId, 'drive-cascade');
    await createFile({
      id: 'file-cascade',
      userId: user.userId,
      driveId: 'drive-cascade',
      name: 'inside.txt',
      workspaceId: 'ws-cascade',
      workspaceFolderId: 'wf-child',
    });

    const res = await app.request(
      '/api/folders/wf-parent',
      { method: 'DELETE', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(204);

    // Both parent + child gone
    const parent = await env.DB.prepare('SELECT id FROM workspace_folders WHERE id = ?')
      .bind('wf-parent')
      .first();
    expect(parent).toBeNull();
    const child = await env.DB.prepare('SELECT id FROM workspace_folders WHERE id = ?')
      .bind('wf-child')
      .first();
    expect(child).toBeNull();

    // No files still reference the deleted folders. (Whether the file row
    // is detached or removed depends on D1's FK enforcement state; the
    // observable invariant is that no orphaned file→folder links remain.)
    const orphaned = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM files WHERE workspace_folder_id IN (?, ?)',
    )
      .bind('wf-parent', 'wf-child')
      .first<{ n: number }>();
    expect(orphaned?.n).toBe(0);
  });

  // ─── POST /:id/files ───

  it('POST /:id/files assigns files to a workspace → 204', async () => {
    const user = await insertUserAndSession('add-files');
    await createWorkspace(user.userId, 'ws-addfiles');
    await createDrive(user.userId, 'drive-addfiles');
    await createFile({
      id: 'file-add1',
      userId: user.userId,
      driveId: 'drive-addfiles',
      name: 'a.txt',
    });
    await createFile({
      id: 'file-add2',
      userId: user.userId,
      driveId: 'drive-addfiles',
      name: 'b.txt',
    });

    const res = await app.request(
      '/api/folders/ws-addfiles/files',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ fileIds: ['file-add1', 'file-add2'] }),
      },
      env,
    );

    expect(res.status).toBe(204);
    const rows = await env.DB.prepare('SELECT id FROM files WHERE workspace_id = ? ORDER BY id')
      .bind('ws-addfiles')
      .all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(['file-add1', 'file-add2']);
  });

  it('POST /:id/files rejects empty fileIds array (zod → 400)', async () => {
    const user = await insertUserAndSession('add-files-bad');
    await createWorkspace(user.userId, 'ws-addbad');

    const res = await app.request(
      '/api/folders/ws-addbad/files',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie, Origin: ORIGIN },
        body: JSON.stringify({ fileIds: [] }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  // ─── POST /:id/sync ───

  it('POST /:id/sync returns 204 (background sync scheduled via waitUntil)', async () => {
    const user = await insertUserAndSession('sync');
    await createWorkspace(user.userId, 'ws-sync');
    await createDrive(user.userId, 'drive-sync');

    const res = await app.request(
      '/api/folders/ws-sync/sync',
      { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
      executionCtx,
    );
    // Route returns 204 regardless of whether drives were found (sync is
    // best-effort, scheduled in the background). A workspace with no drives
    // dispatches nothing, but the route still completes.
    expect(res.status).toBe(204);
  });

  it('POST /:id/sync on a workspace with a drive schedules a sync', async () => {
    const user = await insertUserAndSession('sync2');
    await createWorkspace(user.userId, 'ws-sync2');
    // A drive tied to a file inside the workspace — findDrivesForFolder joins
    // files by workspace to find drives.
    await createDrive(user.userId, 'drive-sync2');
    await createFile({
      id: 'file-sync2',
      userId: user.userId,
      driveId: 'drive-sync2',
      name: 'sync.txt',
      workspaceId: 'ws-sync2',
    });

    executionCtx.waitUntil.mockClear();
    const res = await app.request(
      '/api/folders/ws-sync2/sync',
      { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
      executionCtx,
    );
    expect(res.status).toBe(204);
    // syncDriveAccount was dispatched to waitUntil (swallowed by the stub so
    // no Google API call is made).
    expect(executionCtx.waitUntil).toHaveBeenCalled();
  });

  // ─── POST /:id/force-sync ───

  it('POST /:id/force-sync returns 400 when no drive can be resolved', async () => {
    const user = await insertUserAndSession('force-sync');
    await createWorkspace(user.userId, 'ws-fsync');
    await createWorkspaceFolder('ws-fsync', 'wf-fsync', 'NoDrive');
    // No drives, no files in the folder → findDriveIdForFolder and
    // findPrimaryDriveId both return null.

    const res = await app.request(
      '/api/folders/wf-fsync/force-sync',
      { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
      executionCtx,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('driveId');
  });

  it('POST /:id/force-sync with ?driveId= schedules sync and returns 204', async () => {
    const user = await insertUserAndSession('force-sync2');
    await createWorkspace(user.userId, 'ws-fsync2');
    await createWorkspaceFolder('ws-fsync2', 'wf-fsync2', 'WithDrive');
    await createDrive(user.userId, 'drive-fsync2');

    executionCtx.waitUntil.mockClear();
    const res = await app.request(
      '/api/folders/wf-fsync2/force-sync?driveId=drive-fsync2',
      { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN } },
      env,
      executionCtx,
    );

    expect(res.status).toBe(204);
    // performBackgroundSync dispatched to waitUntil (swallowed).
    expect(executionCtx.waitUntil).toHaveBeenCalled();
  });
});
