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

// c.executionCtx.waitUntil is used for non-blocking quota-cache invalidation
// after a successful move. The stub swallows the promise so the route completes.
const executionCtx = { waitUntil: vi.fn() };

// ─── Mock GoogleDriveService methods ───
// `createDriveService(env)` is the factory the route calls to get a
// GoogleDriveService for the cross-account share→copy→trash→revoke flow.
// Override it to return a controllable mock so the test exercises the full
// HTTP route (authGuard, DriveService.findByIdAndUser, FileService) against
// real D1 while the Google Drive API calls are stubbed.
const mockDrive = vi.hoisted(() => ({
  shareFile: vi.fn(),
  copyFile: vi.fn(),
  trashFile: vi.fn(),
  revokeShare: vi.fn(),
  untrashFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('../../src/lib/drive-factory', async (importOriginal) => {
  // importOriginal is typed by vitest to resolve to the real module's
  // namespace, so no `typeof import()` cast is needed (and that form is
  // banned by @typescript-eslint/consistent-type-imports).
  const actual = await importOriginal();
  return {
    ...actual,
    createDriveService: vi.fn(() => mockDrive),
  };
});

async function insertUserAndSession(username: string): Promise<{ userId: string; cookie: string }> {
  const userId = `mv-${username}`;
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
  const sessionId = `mv-session-${username}-${now}`;
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

async function insertFile(
  userId: string,
  fileId: string,
  driveId: string,
  googleFileId: string,
  name: string,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(fileId, userId, driveId, googleFileId, name)
    .run();
}

describe('POST /api/files/:id/move-drive (integration)', () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    // Reset every mock method (calls + implementation) before re-seeding defaults.
    mockDrive.shareFile.mockReset();
    mockDrive.copyFile.mockReset();
    mockDrive.trashFile.mockReset();
    mockDrive.revokeShare.mockReset();
    mockDrive.untrashFile.mockReset();
    mockDrive.deleteFile.mockReset();
    executionCtx.waitUntil.mockReset();
    // Default happy-path implementations (individual tests override as needed).
    mockDrive.shareFile.mockResolvedValue('perm-123');
    mockDrive.copyFile.mockResolvedValue({ id: 'copied-123', name: 'report.pdf' });
    mockDrive.revokeShare.mockResolvedValue(undefined);
    mockDrive.trashFile.mockResolvedValue(undefined);
    mockDrive.untrashFile.mockResolvedValue(undefined);
    mockDrive.deleteFile.mockResolvedValue(undefined);

    const user = await insertUserAndSession('alice');
    cookie = user.cookie;
    userId = user.userId;
    await insertDrive(userId, 'mv-source', 'source@example.com');
    await insertDrive(userId, 'mv-target', 'target@example.com');
    await insertFile(userId, 'mv-file', 'mv-source', 'gfile-1', 'report.pdf');
  });

  it('success path: share → copy → revoke → trash, then updates DB and returns 200', async () => {
    const res = await app.request(
      '/api/files/mv-file/move-drive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ targetDriveId: 'mv-target' }),
      },
      env,
      executionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      file: { id: string; driveAccountId: string; googleFileId: string; name: string };
    };
    // DB updated to the target drive + the copied file's Google id
    expect(body.file.driveAccountId).toBe('mv-target');
    expect(body.file.googleFileId).toBe('copied-123');

    // All four Google API ops ran, in order: share → copy → revoke → trash.
    expect(mockDrive.shareFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.copyFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.revokeShare).toHaveBeenCalledTimes(1);
    expect(mockDrive.trashFile).toHaveBeenCalledTimes(1);

    const order = [
      mockDrive.shareFile.mock.invocationCallOrder[0],
      mockDrive.copyFile.mock.invocationCallOrder[0],
      mockDrive.revokeShare.mock.invocationCallOrder[0],
      mockDrive.trashFile.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // No rollback ops ran (move succeeded).
    expect(mockDrive.untrashFile).not.toHaveBeenCalled();
    expect(mockDrive.deleteFile).not.toHaveBeenCalled();

    // Quota cache invalidation was scheduled (non-blocking) for both drives.
    expect(executionCtx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('same-drive rejection: targetDriveId === sourceDriveId → 409, no Google API', async () => {
    const res = await app.request(
      '/api/files/mv-file/move-drive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ targetDriveId: 'mv-source' }),
      },
      env,
      executionCtx,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('already in the target drive');

    expect(mockDrive.shareFile).not.toHaveBeenCalled();
    expect(mockDrive.copyFile).not.toHaveBeenCalled();
  });

  it('unauthorized target drive: targetDriveId not owned by user → 404, no Google API', async () => {
    const res = await app.request(
      '/api/files/mv-file/move-drive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ targetDriveId: 'drive-not-yours' }),
      },
      env,
      executionCtx,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Target drive not found');

    expect(mockDrive.shareFile).not.toHaveBeenCalled();
    expect(mockDrive.copyFile).not.toHaveBeenCalled();
  });

  it('share fails: returns 500 with no rollback (nothing to clean up)', async () => {
    mockDrive.shareFile.mockRejectedValue(new Error('Google share API down'));

    const res = await app.request(
      '/api/files/mv-file/move-drive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ targetDriveId: 'mv-target' }),
      },
      env,
      executionCtx,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Failed to move file');

    // Share was attempted; copy/trash/revoke never ran.
    expect(mockDrive.shareFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.copyFile).not.toHaveBeenCalled();
    expect(mockDrive.trashFile).not.toHaveBeenCalled();
    // Nothing was created, so rollback must not touch anything.
    expect(mockDrive.untrashFile).not.toHaveBeenCalled();
    expect(mockDrive.deleteFile).not.toHaveBeenCalled();
    expect(mockDrive.revokeShare).not.toHaveBeenCalled();
  });

  it('copy fails: returns 500 and rolls back by revoking the share', async () => {
    mockDrive.copyFile.mockRejectedValue(new Error('Google copy API down'));

    const res = await app.request(
      '/api/files/mv-file/move-drive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ targetDriveId: 'mv-target' }),
      },
      env,
      executionCtx,
    );

    expect(res.status).toBe(500);

    // Share ran (perm granted); copy failed; trash never ran.
    expect(mockDrive.shareFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.copyFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.trashFile).not.toHaveBeenCalled();
    // Rollback revokes the share (sharePermissionId was set before copy threw).
    expect(mockDrive.revokeShare).toHaveBeenCalledTimes(1);
    // No copy was created, so deleteFile/untrash must not run.
    expect(mockDrive.deleteFile).not.toHaveBeenCalled();
    expect(mockDrive.untrashFile).not.toHaveBeenCalled();

    // DB file stays on the source drive (updateDriveAssignment never ran).
    const file = await env.DB.prepare(
      'SELECT drive_account_id, google_file_id FROM files WHERE id = ?',
    )
      .bind('mv-file')
      .first<{ drive_account_id: string; google_file_id: string }>();
    expect(file?.drive_account_id).toBe('mv-source');
    expect(file?.google_file_id).toBe('gfile-1');
  });

  it('trash fails (best-effort): move still succeeds with 200, original left untrashed', async () => {
    mockDrive.trashFile.mockRejectedValue(new Error('Google trash API down'));

    const res = await app.request(
      '/api/files/mv-file/move-drive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ targetDriveId: 'mv-target' }),
      },
      env,
      executionCtx,
    );

    // Trash failure is swallowed (best-effort) — the move completes.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      file: { driveAccountId: string; googleFileId: string };
    };
    expect(body.file.driveAccountId).toBe('mv-target');
    expect(body.file.googleFileId).toBe('copied-123');

    // Share + copy + revoke ran; trash was attempted but threw.
    expect(mockDrive.shareFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.copyFile).toHaveBeenCalledTimes(1);
    expect(mockDrive.revokeShare).toHaveBeenCalledTimes(1);
    expect(mockDrive.trashFile).toHaveBeenCalledTimes(1);
    // No rollback — the move succeeded.
    expect(mockDrive.untrashFile).not.toHaveBeenCalled();
    expect(mockDrive.deleteFile).not.toHaveBeenCalled();
  });
});
