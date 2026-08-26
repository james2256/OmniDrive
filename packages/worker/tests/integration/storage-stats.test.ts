import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { ensureSchema, clearAllTables } from './helpers';
import { FileRepository } from '../../src/repositories/file.repository';
import { FileService } from '../../src/services/file.service';
import { AutomationEngine } from '../../src/services/automation.service';
import type { DriveProvider } from '../../src/types/drive-provider';

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

async function insertUser(id: string, username: string): Promise<void> {
  await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .bind(id, username, '$2a$10$dummy')
    .run();
}

async function insertFile(params: {
  id: string;
  userId: string;
  driveId: string;
  googleFileId: string;
  name: string;
  mimeType: string;
  size: number;
  isTrashed?: number;
}): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name, mime_type, size, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      params.id,
      params.userId,
      params.driveId,
      params.googleFileId,
      params.name,
      params.mimeType,
      params.size,
      params.isTrashed ?? 0,
    )
    .run();
}

async function insertDrive(id: string, userId: string, email: string): Promise<void> {
  await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)')
    .bind(id, userId, email, 'oauth')
    .run();
}

describe('Storage Stats (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  it('getStorageStats returns per-mime totals after upload delta', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Simulate upload: insert file + apply delta
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(1);
    expect(results[0].mime_type).toBe('image/jpeg');
    expect(results[0].total_size).toBe(5000);
  });

  it('trash subtracts size from stats', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Upload
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);

    // Trash (mark trashed + apply negative delta)
    await env.DB.prepare('UPDATE files SET is_trashed = 1 WHERE id = ?').bind('f1').run();
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(1);
    expect(results[0].total_size).toBe(0); // MAX(0, 5000 - 5000) = 0
  });

  it('restore adds size back to stats', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Upload + trash
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
      isTrashed: 1,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    // Restore
    await env.DB.prepare('UPDATE files SET is_trashed = 0 WHERE id = ?').bind('f1').run();
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results[0].total_size).toBe(5000);
  });

  it('permanent delete of trashed file does not change stats', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Upload + trash
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
      isTrashed: 1,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    // Permanent delete (file already trashed — no delta needed). Uses the
    // same conditional user-scoped DELETE statement FileService.permanentDelete
    // composes into its atomic batch.
    await env.DB.batch([repo.deleteByIdAndUserIfTrashedStmt('f1', 'u1')]);

    const { results } = await repo.getStorageStats('u1');
    expect(results[0].total_size).toBe(0); // unchanged
  });

  it('multiple mime types tracked independently', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    await repo.applyStorageDeltas([
      { userId: 'u1', mimeType: 'image/jpeg', delta: 3000 },
      { userId: 'u1', mimeType: 'video/mp4', delta: 10000 },
      { userId: 'u1', mimeType: 'application/pdf', delta: 2000 },
    ]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(3);
    const byMime = Object.fromEntries(results.map((r) => [r.mime_type, r.total_size]));
    expect(byMime['image/jpeg']).toBe(3000);
    expect(byMime['video/mp4']).toBe(10000);
    expect(byMime['application/pdf']).toBe(2000);
  });

  it('CASE WHEN clamp prevents negative totals on conflict (drift scenario)', async () => {
    await insertUser('u1', 'alice');
    const repo = new FileRepository(env.DB);

    // First insert (positive — normal upload)
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 3000 }]);

    // Second delta: larger negative than current total (simulates drift)
    // ON CONFLICT should clamp to 0, not go negative
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(1);
    expect(results[0].total_size).toBe(0); // clamped, not -2000
  });

  it('findExistingForDelta returns correct old states', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');

    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g-file-1',
      name: 'active.pdf',
      mimeType: 'application/pdf',
      size: 1000,
    });
    await insertFile({
      id: 'f2',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g-file-2',
      name: 'trashed.jpg',
      mimeType: 'image/jpeg',
      size: 2000,
      isTrashed: 1,
    });

    const repo = new FileRepository(env.DB);
    const states = await repo.findExistingForDelta('d1', ['g-file-1', 'g-file-2', 'g-nonexistent']);

    expect(states.size).toBe(2); // only existing files
    const active = states.get('g-file-1');
    expect(active?.size).toBe(1000);
    expect(active?.mimeType).toBe('application/pdf');
    expect(active?.isTrashed).toBe(false);

    const trashed = states.get('g-file-2');
    expect(trashed?.size).toBe(2000);
    expect(trashed?.mimeType).toBe('image/jpeg');
    expect(trashed?.isTrashed).toBe(true);

    expect(states.has('g-nonexistent')).toBe(false);
  });

  it('findExistingForDelta handles >100 file IDs without D1 variable overflow', async () => {
    // Regression test: CHUNK was 500, causing 501 bind variables > D1's 100 limit.
    // The error was "D1_ERROR: too many SQL variables at offset 321".
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');

    // Insert 150 files — exceeds the old CHUNK=500? No, but exceeds D1's 100-variable limit.
    // With CHUNK=99 (the fix), this produces 2 chunks (99 + 51), each under 100.
    for (let i = 0; i < 150; i++) {
      await insertFile({
        id: `f${i}`,
        userId: 'u1',
        driveId: 'd1',
        googleFileId: `g-file-${i}`,
        name: `file-${i}.txt`,
        mimeType: 'text/plain',
        size: 100,
      });
    }

    const repo = new FileRepository(env.DB);
    const ids = Array.from({ length: 150 }, (_, i) => `g-file-${i}`);
    const states = await repo.findExistingForDelta('d1', ids);

    expect(states.size).toBe(150);
    expect(states.get('g-file-0')?.size).toBe(100);
    expect(states.get('g-file-149')?.size).toBe(100);
  });

  it('applyStorageDeltaIfFileInStateStmt no-ops once the file leaves the expected state', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'doc.txt',
      mimeType: 'text/plain',
      size: 5000,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'text/plain', delta: 5000 }]);

    // Trash the file (state leaves is_trashed = 0)
    await env.DB.prepare('UPDATE files SET is_trashed = 1 WHERE id = ?').bind('f1').run();

    // The gated delta conditioned on is_trashed = 0 must NOT fire now —
    // replaying a committed batch's statement is a no-op.
    await env.DB.batch([
      repo.applyStorageDeltaIfFileInStateStmt('u1', 'text/plain', -5000, 'f1', 0),
    ]);

    const { results } = await repo.getStorageStats('u1');
    expect(results[0].total_size).toBe(5000); // unchanged — gate blocked the stale delta

    // The same delta conditioned on is_trashed = 1 (the restore direction) fires.
    await env.DB.batch([
      repo.applyStorageDeltaIfFileInStateStmt('u1', 'text/plain', 5000, 'f1', 1),
    ]);
    const { results: after } = await repo.getStorageStats('u1');
    expect(after[0].total_size).toBe(10000);
  });
});

describe('FileService trash/restore/permanentDelete exactly-once (integration)', () => {
  // Real D1 + the real FileService; only the Google Drive provider is mocked.
  const mockDrive = {
    trashFile: vi.fn(async () => {}),
    untrashFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
  } as unknown as DriveProvider;

  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    vi.clearAllMocks();
  });

  /** Seed an owned, workspace-scoped 100-byte text file + its stats row. */
  async function seedWorkspaceFile(
    opts: { isTrashed?: number; stats?: number; usedBytes?: number } = {},
  ) {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind('u1', 'alice', '$2a$10$dummy')
      .run();
    await env.DB.prepare(
      'INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES (?, ?, ?, ?)',
    )
      .bind('ws1', 'WS', 'u1', opts.usedBytes ?? 100)
      .run();
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
    )
      .bind('wm1', 'ws1', 'u1', 'owner')
      .run();
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind('d1', 'u1', 'alice@gmail.com', 'oauth')
      .run();
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, drive_account_id, workspace_id, google_file_id, name, mime_type, size, is_trashed, owned_by_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('f1', 'u1', 'd1', 'ws1', 'g1', 'doc.txt', 'text/plain', 100, opts.isTrashed ?? 0, 1)
      .run();
    await env.DB.prepare(
      'INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES (?, ?, ?)',
    )
      .bind('u1', 'text/plain', opts.stats ?? 100)
      .run();
  }

  async function readState() {
    const file = await env.DB.prepare('SELECT is_trashed FROM files WHERE id = ?')
      .bind('f1')
      .first<{ is_trashed: number }>();
    const stats = await env.DB.prepare(
      'SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?',
    )
      .bind('u1', 'text/plain')
      .first<{ total_size: number }>();
    const ws = await env.DB.prepare('SELECT used_bytes FROM workspaces WHERE id = ?')
      .bind('ws1')
      .first<{ used_bytes: number }>();
    return {
      isTrashed: file?.is_trashed ?? null,
      stats: stats?.total_size ?? null,
      used: ws?.used_bytes ?? null,
    };
  }

  it('trashFile applies stats + workspace deltas exactly once across duplicate invocations', async () => {
    // Active file: stats=100 (counted), used_bytes=100 (reserved).
    await seedWorkspaceFile();
    const service = new FileService(env.DB, mockDrive);

    await service.trashFile('u1', 'f1'); // first invocation
    await service.trashFile('u1', 'f1'); // duplicate (retry / concurrent sync)

    // Every delta fired exactly once — never twice, never negative.
    expect(await readState()).toEqual({ isTrashed: 1, stats: 0, used: 0 });
    // The duplicate hits the fast-path (already trashed) — no second external
    // Drive subrequest, no second batch.
    expect(mockDrive.trashFile).toHaveBeenCalledTimes(1);
  });

  it('workspace release clamps at zero — a release larger than used_bytes never goes negative', async () => {
    // Stale state: used_bytes=30 but the file is 100 bytes (e.g. a historical
    // double-release drove it down, or the seed drifted). Trashing releases
    // 100 — the MAX(0, ...) clamp must floor used_bytes at 0, not -70.
    await seedWorkspaceFile({ usedBytes: 30 });
    const service = new FileService(env.DB, mockDrive);

    await service.trashFile('u1', 'f1');

    const state = await readState();
    expect(state.used).toBe(0);
    // The clamped value does not inflate quota headroom: a reservation that
    // would exceed the workspace max is still rejected by the atomic gate.
    const wsRepo = new (
      await import('../../src/repositories/workspace.repository')
    ).WorkspaceRepository(env.DB);
    const reserved = await wsRepo.updateUsedBytesAtomic('ws1', 5000, 1000);
    expect(reserved).toBe(false);
  });

  it('restoreFile applies deltas exactly once; a duplicate restore is a 404 that mutates nothing', async () => {
    // Trashed file: stats=0 (excluded at trash), used_bytes=0 (released at trash).
    await seedWorkspaceFile({ isTrashed: 1, stats: 0, usedBytes: 0 });
    const service = new FileService(env.DB, mockDrive);

    await service.restoreFile('u1', 'f1');

    // The duplicate hits the is_trashed !== 1 precondition — the row is
    // already restored, so the request is rejected before any mutation.
    await expect(service.restoreFile('u1', 'f1')).rejects.toMatchObject({ status: 404 });

    // Deltas fired exactly once — never twice.
    expect(await readState()).toEqual({ isTrashed: 0, stats: 100, used: 100 });
    expect(mockDrive.untrashFile).toHaveBeenCalledTimes(1);
  });

  it('restoreFile on a non-trashed file throws NotFoundError and mutates nothing', async () => {
    await seedWorkspaceFile();
    const service = new FileService(env.DB, mockDrive);

    await expect(service.restoreFile('u1', 'f1')).rejects.toMatchObject({ status: 404 });
    expect(mockDrive.untrashFile).not.toHaveBeenCalled();
    expect(await readState()).toEqual({ isTrashed: 0, stats: 100, used: 100 });
  });

  it('permanentDelete removes the row, never double-decrements stats, and is a 404 on repeat', async () => {
    // True post-trash state: stats=0 (excluded at trash), used_bytes=0
    // (released at trash).
    await seedWorkspaceFile({ isTrashed: 1, stats: 0, usedBytes: 0 });
    const service = new FileService(env.DB, mockDrive);

    await service.permanentDelete('u1', 'f1');

    // Stats untouched — the file was already excluded when it was trashed
    // (computeStorageDelta: "delete trashed (owned) → none"). A stats delta
    // here would be a double-decrement.
    const state = await readState();
    expect(state.isTrashed).toBe(null); // row gone
    expect(state.stats).toBe(0); // unchanged
    // Workspace quota untouched — the release fired at trash time. The old
    // behavior (release again here) double-released and dipped used_bytes to
    // -100 until the maintenance cron self-healed; removed per the plan
    // ("no deltas at permanent-delete time — applied at trash time").
    expect(state.used).toBe(0);

    // Repeat invocation: the row is gone → 404, no further mutation, no Drive call.
    await expect(service.permanentDelete('u1', 'f1')).rejects.toMatchObject({ status: 404 });
    expect(mockDrive.deleteFile).toHaveBeenCalledTimes(1);
    expect((await readState()).used).toBe(0);
  });

  it('trash → restore → trash cycle keeps stats and used_bytes in lockstep', async () => {
    await seedWorkspaceFile();
    const service = new FileService(env.DB, mockDrive);

    await service.trashFile('u1', 'f1');
    expect(await readState()).toEqual({ isTrashed: 1, stats: 0, used: 0 });
    await service.restoreFile('u1', 'f1');
    expect(await readState()).toEqual({ isTrashed: 0, stats: 100, used: 100 });
    await service.trashFile('u1', 'f1');
    expect(await readState()).toEqual({ isTrashed: 1, stats: 0, used: 0 });
  });
});

describe('AutomationEngine DELETE accounting (integration)', () => {
  // Real D1 + the real AutomationEngine.processEventTrigger → executeActions
  // path; only the Google Drive provider is mocked.
  const mockDrive = {
    trashFile: vi.fn(async () => {}),
  } as unknown as DriveProvider;

  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    vi.clearAllMocks();
  });

  /** Seed the same owned, workspace-scoped 100-byte file + an event rule with a delete action. */
  async function seedRuleAndWorkspaceFile() {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind('u1', 'alice', '$2a$10$dummy')
      .run();
    await env.DB.prepare(
      'INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES (?, ?, ?, ?)',
    )
      .bind('ws1', 'WS', 'u1', 100)
      .run();
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
    )
      .bind('wm1', 'ws1', 'u1', 'owner')
      .run();
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind('d1', 'u1', 'alice@gmail.com', 'oauth')
      .run();
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, drive_account_id, workspace_id, google_file_id, name, mime_type, size, is_trashed, owned_by_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('f1', 'u1', 'd1', 'ws1', 'g1', 'doc.txt', 'text/plain', 100, 0, 1)
      .run();
    await env.DB.prepare(
      'INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES (?, ?, ?)',
    )
      .bind('u1', 'text/plain', 100)
      .run();
    await env.DB.prepare(
      `INSERT INTO automation_rules (id, user_id, name, trigger_type, conditions, actions, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('rule-1', 'u1', 'cleanup', 'event', '[]', JSON.stringify([{ type: 'delete' }]), 1)
      .run();
  }

  async function readState() {
    const file = await env.DB.prepare('SELECT is_trashed FROM files WHERE id = ?')
      .bind('f1')
      .first<{ is_trashed: number }>();
    const stats = await env.DB.prepare(
      'SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?',
    )
      .bind('u1', 'text/plain')
      .first<{ total_size: number }>();
    const ws = await env.DB.prepare('SELECT used_bytes FROM workspaces WHERE id = ?')
      .bind('ws1')
      .first<{ used_bytes: number }>();
    return {
      isTrashed: file?.is_trashed ?? null,
      stats: stats?.total_size ?? null,
      used: ws?.used_bytes ?? null,
    };
  }

  async function triggerRule(engine: AutomationEngine) {
    const { toDbFile } = await import('../../src/services/automation.service');
    const row = await env.DB.prepare('SELECT * FROM files WHERE id = ?')
      .bind('f1')
      .first<Record<string, unknown>>();
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
        return p;
      },
    } as unknown as ExecutionContext;
    await engine.processEventTrigger(toDbFile(row as never), ctx);
    await Promise.all(pending);
  }

  it('ACTION_DELETE applies gated stats + workspace deltas exactly once (duplicate run no-ops)', async () => {
    await seedRuleAndWorkspaceFile();
    const engine = new AutomationEngine(env, mockDrive);

    await triggerRule(engine);

    // The delete action trashed the row and fired both deltas exactly once:
    // stats 100→0, used_bytes 100→0 — automation no longer trashes with
    // zero accounting.
    expect(await readState()).toEqual({ isTrashed: 1, stats: 0, used: 0 });

    // Duplicate trigger (rule re-fires on the same file): every gated
    // statement no-ops — no second stats decrement, no second release.
    await triggerRule(engine);
    expect(await readState()).toEqual({ isTrashed: 1, stats: 0, used: 0 });
    // The Drive call repeats (idempotent on Google's side) but D1 does not.
    expect(mockDrive.trashFile).toHaveBeenCalledTimes(2);

    // A success log row was written for each run.
    const logs = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM automation_logs WHERE rule_id = ? AND status = ?',
    )
      .bind('rule-1', 'success')
      .first<{ n: number }>();
    expect(logs?.n).toBe(2);
  });

  it('ACTION_DELETE skips non-owned files entirely (no Drive call, no mutation)', async () => {
    await seedRuleAndWorkspaceFile();
    await env.DB.prepare('UPDATE files SET owned_by_me = 0, user_id = ? WHERE id = ?')
      .bind('u1', 'f1')
      .run();
    const engine = new AutomationEngine(env, mockDrive);

    await triggerRule(engine);

    expect(mockDrive.trashFile).not.toHaveBeenCalled();
    expect(await readState()).toEqual({ isTrashed: 0, stats: 100, used: 100 });
  });
});
