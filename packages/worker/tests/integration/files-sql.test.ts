import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../../src/index';
import { ensureSchema, clearAllTables } from './helpers';
import { hashPassword } from '../../src/lib/password';
import { DriveRepository } from '../../src/repositories/drive.repository';
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

async function createDrive(userId: string, driveId: string) {
  await env.DB.prepare(
    'INSERT INTO drive_accounts (id, user_id, email) VALUES (?, ?, ?)'
  ).bind(driveId, userId, `${driveId}@example.com`).run();
}

async function createFile(params: {
  id: string; userId: string; driveId: string; name: string;
  mimeType?: string; size?: number; isTrashed?: number; isStarred?: number;
  workspaceId?: string | null; metadata?: string;
}) {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, workspace_id, google_file_id, name, mime_type, size, is_trashed, is_starred, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    params.id, params.userId, params.driveId, params.workspaceId ?? null,
    `gfile-${params.id}`, params.name, params.mimeType ?? 'text/plain',
    params.size ?? 100, params.isTrashed ?? 0, params.isStarred ?? 0,
    params.metadata ?? null,
  ).run();
}

async function createWorkspace(ownerUserId: string, wsId: string) {
  await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
    .bind(wsId, `Workspace ${wsId}`, ownerUserId).run();
  await env.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
    .bind(`wm-${wsId}`, wsId, ownerUserId, 'owner').run();
}

describe('Complex SQL integration (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // 4.1 — GET /recent returns user's files + workspace files (EXISTS subquery)
  it('GET /recent returns user own files + workspace files', async () => {
    const owner = await createUserAndSession('owner-a');
    const other = await createUserAndSession('other-a');
    await createDrive(owner.userId, 'drive-a1');
    await createDrive(other.userId, 'drive-a2');

    // Owner's personal file
    await createFile({ id: 'file-a1', userId: owner.userId, driveId: 'drive-a1', name: 'my-file.txt' });

    // Owner's workspace file
    await createWorkspace(owner.userId, 'ws-a');
    await createFile({ id: 'file-a2', userId: other.userId, driveId: 'drive-a2', name: 'ws-file.txt', workspaceId: 'ws-a' });
    await env.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
      .bind('wm-a-other', 'ws-a', other.userId, 'editor').run();

    // Other user's personal file (should NOT appear)
    await createFile({ id: 'file-a3', userId: other.userId, driveId: 'drive-a2', name: 'secret.txt' });

    const res = await app.request('/api/files/recent', {
      headers: { Cookie: owner.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[] };
    const names = body.files.map(f => f.name);
    expect(names).toContain('my-file.txt');
    expect(names).toContain('ws-file.txt');
    expect(names).not.toContain('secret.txt');
  });

  // 4.2 — GET /recent doesn't return other users' files
  it('GET /recent does not return files from non-member workspaces', async () => {
    const owner = await createUserAndSession('owner-b');
    const wsMember = await createUserAndSession('member-b');
    const nonMember = await createUserAndSession('outsider-b');
    await createDrive(wsMember.userId, 'drive-b1');

    await createWorkspace(owner.userId, 'ws-b');
    await env.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
      .bind('wm-b-member', 'ws-b', wsMember.userId, 'editor').run();

    // File in workspace — owner + ws members can see, non-member cannot
    await createFile({ id: 'file-b1', userId: owner.userId, driveId: 'drive-b1', name: 'ws-file-b.txt', workspaceId: 'ws-b' });

    // Non-member's recent should NOT include the workspace file
    await createDrive(nonMember.userId, 'drive-b2');
    const res = await app.request('/api/files/recent', {
      headers: { Cookie: nonMember.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[] };
    expect(body.files.map(f => f.name)).not.toContain('ws-file-b.txt');
  });

  // 4.3 — GET /category-overview aggregates by mime type (GROUP BY)
  it('GET /category-overview aggregates sizes by mime type', async () => {
    const user = await createUserAndSession('user-c');
    await createDrive(user.userId, 'drive-c1');

    await createFile({ id: 'file-c1', userId: user.userId, driveId: 'drive-c1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 5000 });
    await createFile({ id: 'file-c2', userId: user.userId, driveId: 'drive-c1', name: 'doc.pdf', mimeType: 'application/pdf', size: 3000 });
    await createFile({ id: 'file-c3', userId: user.userId, driveId: 'drive-c1', name: 'trashed.jpg', mimeType: 'image/jpeg', size: 9999, isTrashed: 1 });

    const res = await app.request('/api/files/category-overview', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { images: number; documents: number };
    expect(body.images).toBe(5000); // only non-trashed image
    expect(body.documents).toBe(3000);
  });

  // 4.4 — GET /search?q=test filters by name (dynamic SQL)
  it('GET /search filters by name query', async () => {
    const user = await createUserAndSession('user-d');
    await createDrive(user.userId, 'drive-d1');

    await createFile({ id: 'file-d1', userId: user.userId, driveId: 'drive-d1', name: 'test-report.pdf' });
    await createFile({ id: 'file-d2', userId: user.userId, driveId: 'drive-d1', name: 'invoice.txt' });

    const res = await app.request('/api/files/search?q=test', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[]; query: string };
    expect(body.query).toBe('test');
    const names = body.files.map(f => f.name);
    expect(names).toContain('test-report.pdf');
    expect(names).not.toContain('invoice.txt');
  });

  // 4.5 — GET /search with metadata filter (json_extract)
  it('GET /search filters by metadata using json_extract', async () => {
    const user = await createUserAndSession('user-e');
    await createDrive(user.userId, 'drive-e1');

    await createFile({ id: 'file-e1', userId: user.userId, driveId: 'drive-e1', name: 'tagged.txt', metadata: JSON.stringify({ tag: 'important' }) });
    await createFile({ id: 'file-e2', userId: user.userId, driveId: 'drive-e1', name: 'untagged.txt', metadata: JSON.stringify({ tag: 'draft' }) });

    const res = await app.request('/api/files/search?metadata={"tag":"important"}', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[] };
    const names = body.files.map(f => f.name);
    expect(names).toContain('tagged.txt');
    expect(names).not.toContain('untagged.txt');
  });

  // 4.6 — GET /starred returns starred files + folders + drive folders
  it('GET /starred returns starred files, workspace folders, and drive folders', async () => {
    const user = await createUserAndSession('user-f');
    await createDrive(user.userId, 'drive-f1');

    // Starred file
    await createFile({ id: 'file-f1', userId: user.userId, driveId: 'drive-f1', name: 'starred-file.txt', isStarred: 1 });
    // Non-starred file (should NOT appear)
    await createFile({ id: 'file-f2', userId: user.userId, driveId: 'drive-f1', name: 'regular-file.txt' });

    // Starred workspace folder
    await createWorkspace(user.userId, 'ws-f');
    await env.DB.prepare(
      'INSERT INTO workspace_folders (id, workspace_id, name, is_starred) VALUES (?, ?, ?, ?)'
    ).bind('wf-f1', 'ws-f', 'starred-folder', 1).run();

    // Starred drive folder
    await env.DB.prepare(
      'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, name, is_starred, is_trashed) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('df-f1', 'drive-f1', 'gfolder-f1', 'starred-drive-folder', 1, 0).run();

    const res = await app.request('/api/files/starred', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[]; folders: { name: string }[]; driveFolders: { name: string }[] };
    expect(body.files.map(f => f.name)).toContain('starred-file.txt');
    expect(body.files.map(f => f.name)).not.toContain('regular-file.txt');
    expect(body.folders.map(f => f.name)).toContain('starred-folder');
    expect(body.driveFolders.map(f => f.name)).toContain('starred-drive-folder');
  });

  // 4.7 — GET /trash returns trashed files + drive folders
  it('GET /trash returns trashed files and drive folders', async () => {
    const user = await createUserAndSession('user-g');
    await createDrive(user.userId, 'drive-g1');

    // Trashed file
    await createFile({ id: 'file-g1', userId: user.userId, driveId: 'drive-g1', name: 'trashed-file.txt', isTrashed: 1 });
    // Non-trashed file (should NOT appear)
    await createFile({ id: 'file-g2', userId: user.userId, driveId: 'drive-g1', name: 'active-file.txt' });

    // Trashed drive folder
    await env.DB.prepare(
      'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, name, is_trashed) VALUES (?, ?, ?, ?, ?)'
    ).bind('df-g1', 'drive-g1', 'gfolder-g1', 'trashed-drive-folder', 1).run();

    const res = await app.request('/api/files/trash', {
      headers: { Cookie: user.cookie, Origin: ORIGIN },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { files: { name: string }[]; folders: { name: string }[] };
    expect(body.files.map(f => f.name)).toContain('trashed-file.txt');
    expect(body.files.map(f => f.name)).not.toContain('active-file.txt');
    expect(body.folders.map(f => f.name)).toContain('trashed-drive-folder');
  });

  // 4.8 — Breadcrumb CTE returns correct path (WITH RECURSIVE)
  it('breadcrumb CTE returns correct path from nested folders', async () => {
    const user = await createUserAndSession('user-h');
    await createDrive(user.userId, 'drive-h1');

    // Create folder hierarchy: root → folder-A → folder-B
    await env.DB.prepare(
      'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name) VALUES (?, ?, ?, ?, ?)'
    ).bind('df-h-a', 'drive-h1', 'gfolder-a', 'root', 'folder-A').run();
    await env.DB.prepare(
      'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name) VALUES (?, ?, ?, ?, ?)'
    ).bind('df-h-b', 'drive-h1', 'gfolder-b', 'gfolder-a', 'folder-B').run();

    const driveRepo = new DriveRepository(env.DB);
    const { results } = await driveRepo.findBreadcrumbPath('drive-h1', 'gfolder-b');

    // Should return [folder-A, folder-B] (ordered by lvl DESC)
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('folder-A');
    expect(results[1].name).toBe('folder-B');
  });

  // 4.9 — Breadcrumb for root folder → empty (just "All Files" added by caller)
  it('breadcrumb CTE returns empty for root folder', async () => {
    const user = await createUserAndSession('user-i');
    await createDrive(user.userId, 'drive-i1');

    const driveRepo = new DriveRepository(env.DB);
    const { results } = await driveRepo.findBreadcrumbPath('drive-i1', 'root');

    // 'root' is not a real folder in drive_folders, so CTE returns empty
    expect(results.length).toBe(0);
  });
});
