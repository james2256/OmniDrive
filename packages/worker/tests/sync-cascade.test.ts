import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { cascadeFolderTrashUnits, cascadeFolderRestoreUnits } from '../src/services/sync';

/**
 * Unit tests for cascadeFolderTrashUnits + cascadeFolderRestoreUnits (A-06).
 *
 * These functions cascade folder trash/restore to all descendant files via
 * a recursive CTE. They:
 *   1. Read child files (non-trashed for trash, trashed for restore)
 *   2. Build per-child storage deltas (negative for trash, positive for restore)
 *   3. Build per-child workspace quota deltas
 *   4. Return a single BatchUnit with the recursive CTE UPDATE + all deltas
 *
 * The mock D1 captures every .all()/.run()/.batch() call so tests can assert
 * on the exact SQL + binds that reach D1.
 */

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

/** A child file row as returned by findChildFilesForTrashCascade / findTrashedChildFilesForRestoreCascade. */
interface ChildFileRow {
  google_file_id: string;
  size: number;
  mime_type: string | null;
  owned_by_me: number;
  workspace_id: string | null;
  user_id: string;
}

function makeMockDb(opts: { childFiles?: ChildFileRow[]; alreadySyncing?: boolean } = {}) {
  const runCalls: CapturedCall[] = [];
  const batchCalls: CapturedCall[][] = [];
  const childFiles = opts.childFiles ?? [];

  const db = {
    prepare: vi.fn((sql: string) => {
      const makeBound = (binds: unknown[]) => ({
        __sql: sql,
        __binds: binds,
        run: vi.fn(async () => {
          runCalls.push({ sql, binds });
          return { success: true, meta: { changes: 1 } };
        }),
        first: vi.fn(async () => {
          // Handle the sync lock for batchUpsertFolderContents tests.
          if (sql.includes('INSERT INTO sync_state') && sql.includes('RETURNING')) {
            if (opts.alreadySyncing) return null;
            return { drive_account_id: binds[0] };
          }
          return null;
        }),
        all: vi.fn(async () => {
          // findChildFilesForTrashCascade / findTrashedChildFilesForRestoreCascade
          // both SELECT from files with a recursive CTE on drive_folders.
          if (sql.includes('SELECT google_file_id, size, mime_type, owned_by_me')) {
            return { results: childFiles };
          }
          return { results: [] };
        }),
      });
      return {
        bind: vi.fn((...binds: unknown[]) => makeBound(binds)),
        ...makeBound([]),
      };
    }),
    batch: vi.fn(async (stmts: any[]) => {
      const captured: CapturedCall[] = [];
      for (const stmt of stmts) {
        if (stmt?.__sql) {
          const call = { sql: stmt.__sql, binds: stmt.__binds ?? [] };
          runCalls.push(call);
          captured.push(call);
        }
      }
      batchCalls.push(captured);
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    }),
  } as unknown as D1Database;

  return { db, runCalls, batchCalls };
}

function makeChild(overrides: Partial<ChildFileRow> = {}): ChildFileRow {
  return {
    google_file_id: 'file-1',
    size: 1000,
    mime_type: 'application/pdf',
    owned_by_me: 1,
    workspace_id: null,
    user_id: 'user-1',
    ...overrides,
  };
}

// Minimal WorkspaceRepository stub — cascade functions only call
// updateUsedBytesStmt, which returns a D1PreparedStatement.
function makeWorkspaceRepoStub() {
  return {
    updateUsedBytesStmt: vi.fn(() => ({})),
  };
}

// ─── cascadeFolderTrashUnits ───

describe('cascadeFolderTrashUnits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when the folder has no non-trashed child files (idempotent)', async () => {
    const { db } = makeMockDb({ childFiles: [] });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderTrashUnits(db, 'drive-1', 'folder-1', workspaceRepo as never);

    expect(units).toEqual([]);
  });

  it('returns 1 unit with markTrashed CTE UPDATE + negative deltas for owned children', async () => {
    const children = [
      makeChild({ google_file_id: 'file-a', size: 500, mime_type: 'application/pdf' }),
      makeChild({ google_file_id: 'file-b', size: 300, mime_type: 'image/jpeg' }),
    ];
    const { db } = makeMockDb({ childFiles: children });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderTrashUnits(db, 'drive-1', 'folder-1', workspaceRepo as never);

    expect(units).toHaveLength(1);
    const unit = units[0]!;
    // The stmt SQL is the recursive CTE UPDATE
    expect(unit.stmt).toBeDefined();
    // 2 owned children → 2 storage delta stmts
    expect(unit.deltas).toHaveLength(2);
  });

  it('skips storage deltas for non-owned children (owned_by_me=0)', async () => {
    const children = [
      makeChild({ google_file_id: 'file-owned', size: 500, owned_by_me: 1 }),
      makeChild({ google_file_id: 'file-shared', size: 300, owned_by_me: 0 }),
    ];
    const { db } = makeMockDb({ childFiles: children });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderTrashUnits(db, 'drive-1', 'folder-1', workspaceRepo as never);

    expect(units).toHaveLength(1);
    // Only the owned child produces a storage delta
    expect(units[0]!.deltas).toHaveLength(1);
  });

  it('adds workspace quota release (-size) for owned children with workspace_id', async () => {
    const children = [
      makeChild({
        google_file_id: 'file-ws',
        size: 800,
        owned_by_me: 1,
        workspace_id: 'ws-1',
      }),
      makeChild({
        google_file_id: 'file-no-ws',
        size: 400,
        owned_by_me: 1,
        workspace_id: null,
      }),
    ];
    const { db } = makeMockDb({ childFiles: children });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderTrashUnits(db, 'drive-1', 'folder-1', workspaceRepo as never);

    expect(units).toHaveLength(1);
    // file-ws: 1 storage delta + 1 workspace delta = 2
    // file-no-ws: 1 storage delta + 0 workspace delta = 1
    expect(units[0]!.deltas).toHaveLength(3);
    // workspaceRepo.updateUsedBytesStmt called once (for file-ws only)
    expect(workspaceRepo.updateUsedBytesStmt).toHaveBeenCalledTimes(1);
    expect(workspaceRepo.updateUsedBytesStmt).toHaveBeenCalledWith('ws-1', -800);
  });

  it('uses the subquery CTE form (UPDATE ... IN (WITH RECURSIVE ...))', async () => {
    const { db } = makeMockDb({
      childFiles: [makeChild()],
    });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderTrashUnits(db, 'drive-1', 'folder-1', workspaceRepo as never);

    expect(units).toHaveLength(1);
    // The stmt is a D1PreparedStatement from markTrashedByDriveAndParentFolderStmt.
    // In the mock, prepared statements carry __sql from prepare().bind().
    const stmt = units[0]!.stmt as unknown as { __sql?: string };
    expect(stmt.__sql).toBeTruthy();
    expect(stmt.__sql!).toContain('UPDATE files SET is_trashed = 1');
    expect(stmt.__sql!).toContain('WITH RECURSIVE descendant_folders');
    // Subquery form: CTE is inside IN (...), not before UPDATE
    expect(stmt.__sql!).toMatch(/IN \(\s*WITH RECURSIVE/);
    // Filters is_trashed = 0 (idempotent — skips already-trashed)
    expect(stmt.__sql!).toContain('AND is_trashed = 0');
    // LIMIT 1000 as cycle defense
    expect(stmt.__sql!).toContain('LIMIT 1000');
  });
});

// ─── cascadeFolderRestoreUnits ───

describe('cascadeFolderRestoreUnits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when the folder has no trashed child files', async () => {
    const { db } = makeMockDb({ childFiles: [] });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderRestoreUnits(
      db,
      'drive-1',
      'folder-1',
      workspaceRepo as never,
    );

    expect(units).toEqual([]);
  });

  it('returns 1 unit with markUntrashed CTE UPDATE + positive deltas for owned children', async () => {
    const children = [
      makeChild({ google_file_id: 'file-a', size: 500, mime_type: 'application/pdf' }),
      makeChild({ google_file_id: 'file-b', size: 300, mime_type: 'image/jpeg' }),
    ];
    const { db } = makeMockDb({ childFiles: children });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderRestoreUnits(
      db,
      'drive-1',
      'folder-1',
      workspaceRepo as never,
    );

    expect(units).toHaveLength(1);
    expect(units[0]!.deltas).toHaveLength(2);
  });

  it('adds workspace quota re-reserve (+size) for owned children with workspace_id', async () => {
    const children = [
      makeChild({
        google_file_id: 'file-ws',
        size: 800,
        owned_by_me: 1,
        workspace_id: 'ws-1',
      }),
    ];
    const { db } = makeMockDb({ childFiles: children });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderRestoreUnits(
      db,
      'drive-1',
      'folder-1',
      workspaceRepo as never,
    );

    expect(units).toHaveLength(1);
    // 1 storage delta + 1 workspace delta
    expect(units[0]!.deltas).toHaveLength(2);
    expect(workspaceRepo.updateUsedBytesStmt).toHaveBeenCalledWith('ws-1', 800);
  });

  it('uses the subquery CTE form with is_trashed = 1 filter (restore only trashed)', async () => {
    const { db } = makeMockDb({
      childFiles: [makeChild()],
    });
    const workspaceRepo = makeWorkspaceRepoStub();

    const units = await cascadeFolderRestoreUnits(
      db,
      'drive-1',
      'folder-1',
      workspaceRepo as never,
    );

    expect(units).toHaveLength(1);
    const stmt = units[0]!.stmt as unknown as { __sql?: string };
    expect(stmt.__sql).toBeTruthy();
    expect(stmt.__sql!).toContain('UPDATE files SET is_trashed = 0');
    expect(stmt.__sql!).toContain('WITH RECURSIVE descendant_folders');
    expect(stmt.__sql!).toMatch(/IN \(\s*WITH RECURSIVE/);
    // Restore filters is_trashed = 1 (only restores trashed children)
    expect(stmt.__sql!).toContain('AND is_trashed = 1');
  });
});
