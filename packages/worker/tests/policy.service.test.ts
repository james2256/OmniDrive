import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PolicyService } from '../src/services/policy.service';
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
      size INTEGER DEFAULT 0,
      is_trashed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      return { results: binds.length ? stmt.all(...binds) : stmt.all(), success: true, meta: { changes: 0 } };
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
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 1000)"
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')"
    ).run();
    // File created 10 days ago — policy deletes after 7 days
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)"
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'old.pdf', 500, oldDate);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)"
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    // Google API called once for the expired file
    expect(driveService.deleteFile).toHaveBeenCalledTimes(1);
    expect(driveService.deleteFile).toHaveBeenCalledWith('d1', 'gfile-1');

    // File removed from DB
    const row = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get('f1') as { count: number };
    expect(row.count).toBe(0);

    // Workspace used_bytes reduced by file size
    const ws = db.prepare('SELECT used_bytes FROM workspaces WHERE id = ?').get('ws-1') as { used_bytes: number };
    expect(ws.used_bytes).toBe(500); // 1000 - 500

    db.close();
  });

  it('skips trashed files (is_trashed = 1)', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)"
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')"
    ).run();
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    // Trashed file — should be skipped
    db.prepare(
      "INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)"
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'trashed.pdf', 500, oldDate);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)"
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    const driveService = makeMockDriveService();
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    expect(driveService.deleteFile).not.toHaveBeenCalled();
    const row = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get('f1') as { count: number };
    expect(row.count).toBe(1); // still in DB

    db.close();
  });

  it('respects the 20-deletion cap per cycle', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)"
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')"
    ).run();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Insert 25 expired files
    const insertFile = db.prepare(
      "INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)"
    );
    for (let i = 0; i < 25; i++) {
      insertFile.run(`f${i}`, 'u1', 'd1', `gfile-${i}`, 'ws-1', `file-${i}.pdf`, 100, oldDate);
    }

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)"
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
      "INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES ('ws-1', 'Test', 'u1', 0)"
    ).run();
    db.prepare(
      "INSERT INTO drive_accounts (id, user_id, email) VALUES ('d1', 'u1', 'a@b.com')"
    ).run();
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name, size, is_trashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)"
    ).run('f1', 'u1', 'd1', 'gfile-1', 'ws-1', 'old.pdf', 500, oldDate);

    db.prepare(
      "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES ('p1', 'ws-1', 'workspace', NULL, 'data_retention', ?)"
    ).run(JSON.stringify({ action: 'auto_delete', days: 7 }));

    // Google API throws — file should stay in DB (not orphaned)
    const driveService = {
      deleteFile: vi.fn().mockRejectedValue(new Error('Google API error')),
    } as unknown as GoogleDriveService;
    const service = new PolicyService(wrapSqlite(db), driveService);

    await service.processAutoDeleteRetentionPolicies();

    expect(driveService.deleteFile).toHaveBeenCalledTimes(1);
    const row = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get('f1') as { count: number };
    expect(row.count).toBe(1); // file still in DB — not orphaned

    db.close();
  });
});
