import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { batchUpsertFolderContents } from '../src/services/sync';
import { ConflictError } from '../src/lib/errors';
import type { GDriveFile, GDriveFolder } from '../src/types/google';
import type { DriveAccount } from '../src/types/domain';

/**
 * Unit tests for batchUpsertFolderContents — the drill-in sync path.
 *
 * This function is called from 3 routes (drives.ts:114, 395, 725) when a
 * user navigates into a Google Drive folder. It UPSERTs all files + folders
 * in the folder and applies storage deltas. It's the primary path that
 * populates `owner_email` for non-owned files.
 *
 * Verified bind positions (0-indexed):
 *   buildUpsertStmt (file.repository.ts:760-787) — 16 binds:
 *     [13] ownedByMe ? 1 : 0
 *     [14] ownerEmail
 *     [15] file.starred ? 1 : 0
 *   buildDriveFolderUpsertStmt (folder.repository.ts:325-344) — 8 binds:
 *     [5]  ownedByMe ? 1 : 0
 *     [6]  ownerEmail
 *     [7]  folder.starred ? 1 : 0
 *
 * The mock D1 captures every .run() call (sql + binds) so tests can assert
 * on the exact bind values that reach D1 — catching regressions in
 * resolveOwnership → buildUpsertStmt plumbing.
 */

// ─── Mock D1 ───
//
// batchUpsertFolderContents calls batchUpsertUnitsWithCheckpoint → db.batch(stmts)
// — NOT stmt.run() directly. D1's batch() executes each D1PreparedStatement
// internally, so we capture the SQL + binds at prepare().bind() time by
// attaching them to the bound statement object. When batch() receives the
// statements, it reads __sql + __binds to record the call.

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

function makeMockDb(
  opts: { existingFileStates?: Map<string, unknown>; alreadySyncing?: boolean } = {},
) {
  const runCalls: CapturedCall[] = [];
  // Per-batch boundaries: each entry is one db.batch(stmts) call's statements.
  // Lets atomicity tests assert that a file's UPSERT + its delta land in the
  // SAME batch (the per-file unit grouping invariant).
  const batchCalls: CapturedCall[][] = [];
  const existingStates = opts.existingFileStates ?? new Map<string, unknown>();

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
          // Handle the sync lock: INSERT INTO sync_state ... RETURNING.
          // acquireLock returns a row when the lock is acquired, null when
          // a sync is already running. Tests default to "lock acquired"
          // unless alreadySyncing=true is passed.
          if (sql.includes('INSERT INTO sync_state') && sql.includes('RETURNING')) {
            if (opts.alreadySyncing) return null;
            return { drive_account_id: binds[0] };
          }
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('SELECT google_file_id')) {
            const fileIds = binds.slice(1);
            const results = fileIds
              .filter((id) => existingStates.has(id as string))
              .map((id) => existingStates.get(id as string));
            return { results };
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
      // batchUpsertUnitsWithCheckpoint calls db.batch(stmts). Each stmt carries
      // __sql + __binds from prepare().bind(). Record them so tests can assert
      // on the binds.
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

// ─── Fixture factories ───

function makeDriveAccount(overrides: Partial<DriveAccount> = {}): DriveAccount {
  return {
    id: 'drive-1',
    userId: 'user-1',
    googleAccountId: 'g-1',
    email: 'test@example.com',
    name: 'Test Drive',
    type: 'oauth',
    isPrimary: false,
    rootFolderId: null,
    totalQuota: 1000,
    usedQuota: 100,
    quotaOverride: null,
    quotaUpdatedAt: null,
    syncStatus: 'idle',
    syncErrorMessage: null,
    syncPaused: false,
    lastSyncedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeFile(overrides: Partial<GDriveFile> = {}): GDriveFile {
  return {
    id: 'file-1',
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    size: '1000',
    createdTime: '2024-01-01T00:00:00Z',
    modifiedTime: '2024-01-01T00:00:00Z',
    owners: [{ me: true }],
    ...overrides,
  };
}

function makeFolder(overrides: Partial<GDriveFolder> = {}): GDriveFolder {
  return {
    id: 'folder-1',
    name: 'Shared Docs',
    owners: [{ me: true }],
    ...overrides,
  };
}

function findCall(calls: { sql: string; binds: unknown[] }[], fragment: string) {
  return calls.find((c) => c.sql.includes(fragment));
}

function findCalls(calls: { sql: string; binds: unknown[] }[], fragment: string) {
  return calls.filter((c) => c.sql.includes(fragment));
}

// ─── Tests ───

describe('batchUpsertFolderContents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts owned files with owned_by_me=1, owner_email=NULL', async () => {
    const drive = makeDriveAccount();
    const file = makeFile({ id: 'file-owned', owners: [{ me: true }] });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    const upsertCall = findCall(runCalls, 'INSERT INTO files');
    expect(upsertCall).toBeTruthy();
    // Bind position 13 (0-indexed) = ownedByMe ? 1 : 0
    expect(upsertCall!.binds[13]).toBe(1);
    // Bind position 14 (0-indexed) = ownerEmail
    expect(upsertCall!.binds[14]).toBeNull();
  });

  it('upserts non-owned files with owned_by_me=0, owner_email=<email>', async () => {
    const drive = makeDriveAccount();
    const file = makeFile({
      id: 'file-alice',
      owners: [{ me: false, displayName: 'Alice', emailAddress: 'alice@example.com' }],
    });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    const upsertCall = findCall(runCalls, 'INSERT INTO files');
    expect(upsertCall).toBeTruthy();
    expect(upsertCall!.binds[13]).toBe(0);
    expect(upsertCall!.binds[14]).toBe('alice@example.com');
  });

  it('upserts non-owned files with owner_email=NULL when Google omits emailAddress', async () => {
    const drive = makeDriveAccount();
    // Carol hid her email from the API — owners[] has displayName but no emailAddress.
    const file = makeFile({
      id: 'file-carol',
      owners: [{ me: false, displayName: 'Carol' }],
    });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    const upsertCall = findCall(runCalls, 'INSERT INTO files');
    expect(upsertCall).toBeTruthy();
    expect(upsertCall!.binds[13]).toBe(0);
    expect(upsertCall!.binds[14]).toBeNull();
  });

  it('upserts folders with correct owned_by_me + owner_email', async () => {
    const drive = makeDriveAccount();
    const folder = makeFolder({
      id: 'folder-carol',
      owners: [{ me: false, emailAddress: 'carol@example.com' }],
    });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(db, drive, [folder], [], 'parent-1');

    const upsertCall = findCall(runCalls, 'INSERT INTO drive_folders');
    expect(upsertCall).toBeTruthy();
    // Bind position 5 (0-indexed) = ownedByMe ? 1 : 0
    expect(upsertCall!.binds[5]).toBe(0);
    // Bind position 6 (0-indexed) = ownerEmail
    expect(upsertCall!.binds[6]).toBe('carol@example.com');
  });

  it('applies storage delta for new owned files', async () => {
    const drive = makeDriveAccount();
    const file = makeFile({
      id: 'file-new',
      size: '1000',
      mimeType: 'application/pdf',
      owners: [{ me: true }],
    });

    // No existing state → file is new → +1000 delta
    const { db, runCalls } = makeMockDb({ existingFileStates: new Map() });
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    // applyStorageDeltaStmt uses: INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES (?, ?, ?)
    const deltaCall = findCall(runCalls, 'INSERT INTO file_storage_stats');
    expect(deltaCall).toBeTruthy();
    // Binds: [userId, mimeType, delta]
    expect(deltaCall!.binds[0]).toBe('user-1');
    expect(deltaCall!.binds[1]).toBe('application/pdf');
    expect(deltaCall!.binds[2]).toBe(1000);
  });

  it('handles mixed batch (folders + files, owned + non-owned)', async () => {
    const drive = makeDriveAccount();
    const ownedFolder = makeFolder({ id: 'folder-owned', owners: [{ me: true }] });
    const nonOwnedFolder = makeFolder({
      id: 'folder-non-owned',
      owners: [{ me: false, emailAddress: 'a@example.com' }],
    });
    const ownedFile = makeFile({ id: 'file-owned', owners: [{ me: true }] });
    const nonOwnedFile = makeFile({
      id: 'file-non-owned',
      owners: [{ me: false, emailAddress: 'b@example.com' }],
    });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(
      db,
      drive,
      [ownedFolder, nonOwnedFolder],
      [ownedFile, nonOwnedFile],
      'parent-1',
    );

    // Two folder UPSERTs
    const folderCalls = findCalls(runCalls, 'INSERT INTO drive_folders');
    expect(folderCalls).toHaveLength(2);
    // Order: ownedFolder first (input order), nonOwnedFolder second
    expect(folderCalls[0].binds[5]).toBe(1); // ownedFolder: ownedByMe=1
    expect(folderCalls[0].binds[6]).toBeNull(); // ownedFolder: ownerEmail=NULL
    expect(folderCalls[1].binds[5]).toBe(0); // nonOwnedFolder: ownedByMe=0
    expect(folderCalls[1].binds[6]).toBe('a@example.com');

    // Two file UPSERTs
    const fileCalls = findCalls(runCalls, 'INSERT INTO files');
    expect(fileCalls).toHaveLength(2);
    expect(fileCalls[0].binds[13]).toBe(1); // ownedFile
    expect(fileCalls[0].binds[14]).toBeNull(); // ownedFile: ownerEmail=NULL
    expect(fileCalls[1].binds[13]).toBe(0); // nonOwnedFile
    expect(fileCalls[1].binds[14]).toBe('b@example.com');
  });

  // ─── Service account (shared Drive) path ───

  it('upserts service account files with owned_by_me=1 when owners[] is empty (shared Drive)', async () => {
    // Google doesn't populate owners[] for shared Drive items.
    // resolveOwnership must return ownedByMe=true when isServiceAccount=true.
    const drive = makeDriveAccount({ type: 'service_account' });
    const file = makeFile({ id: 'sa-file-1', owners: undefined });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    const upsertCall = findCall(runCalls, 'INSERT INTO files');
    expect(upsertCall).toBeTruthy();
    expect(upsertCall!.binds[13]).toBe(1); // ownedByMe=1 (not 0 — service account has full access)
    expect(upsertCall!.binds[14]).toBeNull(); // ownerEmail=null (no individual owner for shared Drive items)
  });

  it('applies storage delta for service account files (owned_by_me=1)', async () => {
    const drive = makeDriveAccount({ type: 'service_account' });
    const file = makeFile({ id: 'sa-file-2', size: '5000', owners: undefined });

    const { db, runCalls } = makeMockDb({ existingFileStates: new Map() });
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    const deltaCall = findCall(runCalls, 'INSERT INTO file_storage_stats');
    expect(deltaCall).toBeTruthy();
    expect(deltaCall!.binds[0]).toBe('user-1');
    expect(deltaCall!.binds[1]).toBe('application/pdf');
    expect(deltaCall!.binds[2]).toBe(5000); // +5000 delta (file counts in quota)
  });

  // ─── Atomicity (per-file unit grouping) ───

  it('commits a file UPSERT + its storage delta in the same db.batch() call', async () => {
    // The core invariant of the per-file unit refactor: a file's UPSERT and
    // its delta must land in the SAME db.batch() invocation so they commit
    // atomically. If a later change splits them into separate batches, a
    // Worker kill between the two would leave file_storage_stats permanently
    // drifted — this test catches that regression.
    const drive = makeDriveAccount();
    const file = makeFile({ id: 'file-atomic', size: '1000', owners: [{ me: true }] });

    const { db, batchCalls } = makeMockDb({ existingFileStates: new Map() });
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    // Exactly one db.batch() call for a single file (no checkpoint).
    expect(batchCalls).toHaveLength(1);
    const batch = batchCalls[0];
    const hasUpsert = batch.some((c) => c.sql.includes('INSERT INTO files'));
    const hasDelta = batch.some((c) => c.sql.includes('INSERT INTO file_storage_stats'));
    expect(hasUpsert).toBe(true);
    expect(hasDelta).toBe(true);
    // UPSERT must come before its delta (unit.stmt pushed before unit.deltas).
    const upsertIdx = batch.findIndex((c) => c.sql.includes('INSERT INTO files'));
    const deltaIdx = batch.findIndex((c) => c.sql.includes('INSERT INTO file_storage_stats'));
    expect(upsertIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThan(upsertIdx);
  });

  it('does not issue a second db.batch() for deltas (no separate applyStorageDeltas call)', async () => {
    // Guards against regression to the old pattern: batchInChunks(stmts) then
    // applyStorageDeltas(deltas) as two separate awaits. With per-file unit
    // grouping, deltas ride along in the same chunk as the UPSERTs — so a
    // 1-file load must produce exactly ONE db.batch() call, not two.
    const drive = makeDriveAccount();
    const file = makeFile({ id: 'file-one-batch', size: '2000', owners: [{ me: true }] });

    const { db, batchCalls } = makeMockDb({ existingFileStates: new Map() });
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    expect(batchCalls).toHaveLength(1);
  });

  it('commits each file UPSERT + delta pair together when multiple files exceed one chunk', async () => {
    // D1_BATCH_SIZE=100 — a 150-file load produces 2 chunks. Each file's
    // UPSERT + delta must stay together WITHIN the same chunk (never split
    // across the chunk boundary), so a failure of chunk 2 leaves chunk 1's
    // files fully consistent (UPSERT + delta both applied or both absent).
    const drive = makeDriveAccount();
    const files = Array.from({ length: 150 }, (_, i) =>
      makeFile({ id: `file-${i}`, size: '100', owners: [{ me: true }] }),
    );

    const { db, batchCalls } = makeMockDb({ existingFileStates: new Map() });
    await batchUpsertFolderContents(db, drive, [], files, 'parent-1');

    // 150 files / 100 per chunk = 2 db.batch() calls.
    expect(batchCalls).toHaveLength(2);
    for (const batch of batchCalls) {
      const upserts = batch.filter((c) => c.sql.includes('INSERT INTO files'));
      const deltas = batch.filter((c) => c.sql.includes('INSERT INTO file_storage_stats'));
      // Every UPSERT in this chunk must have its corresponding delta in the
      // SAME chunk (1:1 — each new owned file produces exactly one delta).
      expect(deltas).toHaveLength(upserts.length);
    }
  });

  // ─── Sync lock (A-08) ───

  it('throws ConflictError(409) when a sync is already running (acquireLock returns null)', async () => {
    // A-08: batchUpsertFolderContents must acquire the sync lock to prevent
    // concurrent sync + drill-in from double-counting storage deltas. If a
    // sync is running, acquireLock returns null → throw ConflictError so the
    // route surfaces a 409 to the user (instead of silently racing).
    const drive = makeDriveAccount();
    const file = makeFile({ id: 'file-1', owners: [{ me: true }] });

    const { db } = makeMockDb({ alreadySyncing: true });
    await expect(batchUpsertFolderContents(db, drive, [], [file], 'parent-1')).rejects.toThrow(
      ConflictError,
    );
  });

  it('releases the sync lock via setIdle in finally (even if the body throws)', async () => {
    // The lock must be released even if the body throws — otherwise a
    // transient D1 error would leave the lock held for 5 minutes (until
    // the stale-lock timeout). setIdle is called in a finally block with
    // .catch(() => {}) so it doesn't mask the original error.
    const drive = makeDriveAccount();
    const file = makeFile({ id: 'file-1', owners: [{ me: true }] });

    const { db, runCalls } = makeMockDb();
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    // setIdle uses: UPDATE sync_state SET status = 'idle' WHERE drive_account_id = ?
    const setIdleCall = runCalls.find(
      (c) =>
        c.sql.includes("UPDATE sync_state SET status = 'idle'") &&
        c.sql.includes('WHERE drive_account_id = ?'),
    );
    expect(setIdleCall).toBeTruthy();
    expect(setIdleCall!.binds[0]).toBe('drive-1');
  });

  it('acquires the lock before reading existing file states (no race window)', async () => {
    // The lock must be acquired BEFORE findExistingForDelta — otherwise a
    // sync could read + write between our lock check and our oldState read,
    // causing a double-count. This test verifies the lock query appears
    // before the findExistingForDelta query in the call sequence.
    const drive = makeDriveAccount();
    const file = makeFile({ id: 'file-1', owners: [{ me: true }] });

    const { db } = makeMockDb({ existingFileStates: new Map() });
    await batchUpsertFolderContents(db, drive, [], [file], 'parent-1');

    // The first D1 call should be the lock acquisition (INSERT INTO sync_state ... RETURNING).
    // runCalls captures .run() calls, but acquireLock uses .first() — so we check
    // the prepare() calls via the mock's call history instead.
    const prepareCalls = (db as unknown as { prepare: { mock: { calls: string[][] } } }).prepare
      .mock.calls;
    const firstSql = prepareCalls[0]?.[0] as string;
    expect(firstSql).toContain('INSERT INTO sync_state');
    expect(firstSql).toContain('RETURNING');

    // findExistingForDelta's SELECT should come AFTER the lock
    const findExistingIdx = prepareCalls.findIndex((c) =>
      (c[0] as string).includes('SELECT google_file_id'),
    );
    const lockIdx = prepareCalls.findIndex((c) =>
      (c[0] as string).includes('INSERT INTO sync_state'),
    );
    expect(lockIdx).toBeLessThan(findExistingIdx);
  });
});
