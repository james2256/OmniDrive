import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { batchUpsertFolderContents } from '../src/services/sync';
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
 *   buildUpsertStmt (file.repository.ts:767-783) — 15 binds:
 *     [13] ownedByMe ? 1 : 0
 *     [14] ownerEmail
 *   buildDriveFolderUpsertStmt (folder.repository.ts:333-341) — 7 binds:
 *     [5]  ownedByMe ? 1 : 0
 *     [6]  ownerEmail
 *
 * The mock D1 captures every .run() call (sql + binds) so tests can assert
 * on the exact bind values that reach D1 — catching regressions in
 * resolveOwnership → buildUpsertStmt plumbing.
 */

// ─── Mock D1 ───
//
// batchUpsertFolderContents calls batchInChunks → db.batch(stmts) — NOT
// stmt.run() directly. D1's batch() executes each D1PreparedStatement
// internally, so we capture the SQL + binds at prepare().bind() time by
// attaching them to the bound statement object. When batch() receives the
// statements, it reads __sql + __binds to record the call.

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

function makeMockDb(opts: { existingFileStates?: Map<string, unknown> } = {}) {
  const runCalls: CapturedCall[] = [];
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
        first: vi.fn(async () => null),
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
      // batchInChunks calls db.batch(stmts). Each stmt carries __sql + __binds
      // from prepare().bind(). Record them so tests can assert on the binds.
      for (const stmt of stmts) {
        if (stmt?.__sql) {
          runCalls.push({ sql: stmt.__sql, binds: stmt.__binds ?? [] });
        }
      }
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    }),
  } as unknown as D1Database;

  return { db, runCalls };
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
});
