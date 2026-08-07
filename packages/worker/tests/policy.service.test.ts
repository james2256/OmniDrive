import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PolicyService } from '../src/services/policy.service';
import { toSQLiteDatetime } from '../src/lib/datetime';
import type { GoogleDriveService } from '../src/services/google-drive';

/**
 * Tests for PolicyService.processAutoDeleteRetentionPolicies — the engine
 * that permanently deletes files via the Google Drive API when they exceed
 * the retention period. Uses better-sqlite3 (in-memory) + a mocked
 * GoogleDriveService (no real API calls).
 */

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      used_bytes INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workspace_folders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE drive_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      drive_account_id TEXT NOT NULL,
      google_file_id TEXT NOT NULL,
      workspace_id TEXT,
      workspace_folder_id TEXT,
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER DEFAULT 0,
      is_trashed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE file_storage_stats (
      user_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      total_size INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, mime_type)
    );
    CREATE TABLE workspace_policies (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      policy_type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeMockDriveService(): GoogleDriveService {
  return {
    deleteFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as GoogleDriveService;
}

/** Wrap a better-sqlite3 DB in the minimal D1-shaped interface PolicyService uses.
 *  Supports both `prepare(sql).bind(...).all()` and `prepare(sql).all()` (no binds). */
function wrapSqlite(db: Database.Database): D1Database {
  const makeExecutor = (sql: string, binds: unknown[] = []) => ({
    all: () => {
      const stmt = db.prepare(sql);
      return {
        results: binds.length ? stmt.all(...binds) : stmt.all(),
        success: true,
        meta: { changes: 0 },
      };
    },
    first: <T = unknown>() => {
      const stmt = db.prepare(sql);
      return (binds.length ? stmt.get(...binds) : stmt.get()) as T | null;
    },
    run: () => {
      const stmt = db.prepare(sql);
      const info = binds.length ? stmt.run(...binds) : stmt.run();
      return { success: true, meta: { changes: info.changes } };
    },
    bind: (...newBinds: unknown[]) => makeExecutor(sql, newBinds),
  });
  return {
    prepare: (sql: string) => makeExecutor(sql),
    batch: (stmts: { run: () => unknown }[]) => {
      const results = stmts.map((s) => s.run());
      return results;
    },
  } as unknown as D1Database;
}

describe('PolicyService.processAutoDeleteRetentionPolicies', () => {
  it('does nothing when no policies exist', async () => {
    const db = createDb();
    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    expect(driveService.deleteFile).not.toHaveBeenCalled();
    db.close();
  });

  it('deletes expired files via Google API and removes them from DB', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 1000)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();
    // File created 10 days ago — policy deletes after 7 days
    const oldDate = toSQLiteDatetime(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'old.pdf', 500, oldDate);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    // Google API called once for the expired file
    expect(driveService.deleteFile).toHaveBeenCalledTimes(1);
    expect(driveService.deleteFile).toHaveBeenCalledWith('d1', 'gfile-1');

    // File removed from DB
    const row = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get('f1') as {
      count: number;
    };
    expect(row.count).toBe(0);

    // Workspace used_bytes reduced by file size
    const ws = db.prepare('SELECT used_bytes FROM workspaces WHERE id = ?').get('ws-1') as {
      used_bytes: number;
    };
    expect(ws.used_bytes).toBe(500); // 1000 - 500

    db.close();
  });

  it('decrements file_storage_stats by the deleted file size', async () => {
    // Regression: retention batch previously omitted applyStorageDeltaStmt,
    // leaving the dashboard "Storage by type" chart inflated after auto-delete.
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 500)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();
    // Pre-existing stats row for this (user, mime) — simulates prior upload.
    db.prepare(
      "INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES ('u1', 'application/pdf', 1000)",
    ).run();
    const oldDate = toSQLiteDatetime(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, mime_type, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'old.pdf', 'application/pdf', 500, oldDate);
    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    const stats = db
      .prepare('SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?')
      .get('u1', 'application/pdf') as { total_size: number } | undefined;
    expect(stats?.total_size).toBe(500); // 1000 - 500

    db.close();
  });

  it('handles null mime_type gracefully (coerces to empty string for stats)', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 100)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();
    const oldDate = toSQLiteDatetime(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    // File with NULL mime_type — the fix must coerce to '' before the stats INSERT.
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, mime_type, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'unknown.bin', null, 100, oldDate);
    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    // Stats row written with mime_type='' (coerced from null by ?? '' in the
    // service). Without the coercion, applyStorageDeltaStmt would bind null
    // for mime_type — a NOT NULL column violation.
    const stats = db
      .prepare('SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?')
      .get('u1', '') as { total_size: number } | undefined;
    expect(stats).toBeTruthy();

    db.close();
  });

  it('skips trashed files (is_trashed = 1)', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();
    const oldDate = toSQLiteDatetime(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    // Trashed file — should be skipped
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'trashed.pdf', 500, oldDate);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    expect(driveService.deleteFile).not.toHaveBeenCalled();
    const row = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get('f1') as {
      count: number;
    };
    expect(row.count).toBe(1); // still in DB

    db.close();
  });

  it('respects the 20-deletion cap per cycle', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();
    const oldDate = toSQLiteDatetime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    // Insert 25 expired files
    const insertFile = db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    );
    for (let i = 0; i < 25; i++) {
      insertFile.run(`f${i}`, 'u1', 'd1', `gfile-${i}`, 'ws-1', `file-${i}.pdf`, 100, oldDate);
    }

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    // Exactly 20 deletions (the cap), not 25
    expect(driveService.deleteFile).toHaveBeenCalledTimes(20);

    // 20 files deleted, 5 remain
    const remaining = db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    expect(remaining.count).toBe(5);

    db.close();
  });

  it('skips DB delete when Google API call fails (file stays in D1)', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();
    const oldDate = toSQLiteDatetime(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'old.pdf', 500, oldDate);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    // Google API throws — file should stay in DB (not orphaned)
    const driveService = {
      deleteFile: vi.fn().mockRejectedValue(new Error('Google API error')),
    } as unknown as GoogleDriveService;
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    expect(driveService.deleteFile).toHaveBeenCalledTimes(1);
    const row = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get('f1') as {
      count: number;
    };
    expect(row.count).toBe(1); // file still in DB — not orphaned

    db.close();
  });

  it('does not delete files created on the cutoff day but at a later time (format regression)', async () => {
    // Regression: ISO cutoff "2026-06-21T15:00:00" vs SQLite created_at "2026-06-21 20:00:00"
    // Lexicographic: space (0x20) < T (0x54) → file wrongly deleted.
    // After fix: cutoff is SQLite format "2026-06-21 15:00:00" → same-day comparison is correct.
    //
    // Deterministic: vi.useFakeTimers freezes new Date() so the 7-day cutoff lands
    // on the same calendar day as the file we expect to keep. Without this, the test
    // only exercises the bug ~50% of the time (when UTC hour ≥ 12).
    const NOW = new Date('2026-06-28T15:00:00.000Z');
    vi.useFakeTimers({ now: NOW });

    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)",
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')",
    ).run();

    // Cutoff = now - 7d = 2026-06-21 15:00:00. File at 2026-06-21 20:00:00 is on the
    // SAME day but 5h NEWER → must NOT be deleted.
    const newerSameDay = toSQLiteDatetime(new Date('2026-06-21T20:00:00.000Z'));
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    ).run('f-keep', 'u1', 'd1', 'gfile-keep', 'ws-1', 'keep.pdf', 500, newerSameDay);

    // File created 8 days ago (OLDER than cutoff — should be deleted)
    const olderThanCutoff = toSQLiteDatetime(new Date('2026-06-20T10:00:00.000Z'));
    db.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    ).run('f-del', 'u1', 'd1', 'gfile-del', 'ws-1', 'delete.pdf', 300, olderThanCutoff);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)",
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    // Only the 8-day-old file should be deleted; the same-day-newer file must be kept
    expect(driveService.deleteFile).toHaveBeenCalledTimes(1);
    expect(driveService.deleteFile).toHaveBeenCalledWith('d1', 'gfile-del');

    const keepRow = db
      .prepare('SELECT COUNT(*) as count FROM files WHERE id = ?')
      .get('f-keep') as { count: number };
    expect(keepRow.count).toBe(1); // kept ✅

    vi.useRealTimers();
    db.close();
  });
});
