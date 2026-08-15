import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncDriveAccount } from '../src/services/sync';
import { mapDriveRow } from '../src/types/db';
import type { DriveAccount } from '../src/types/domain';
import type { D1Database } from '@cloudflare/workers-types';

// ─── Mock factories ────────────────────────────────────────────

interface Chunk {
  files: any[];
  folders: any[];
  nextPageToken?: string;
}

/**
 * Build a mock GoogleDriveService. The sync engine uses:
 *   getRootFolderId, iterateAllFilesAndFolders, getStartPageToken,
 *   listChanges, getQuota. Each is a vi.fn so tests can assert calls.
 */
function makeDriveServiceMock(
  opts: {
    iterate?: Chunk[];
    listChangesResponses?: any[];
    startPageToken?: string;
    rootFolderId?: string;
    quota?: any;
    quotaThrows?: Error;
  } = {},
) {
  const iterate = opts.iterate ?? [];
  const listChangesQueue = opts.listChangesResponses ?? [];
  let listChangesIdx = 0;

  return {
    getRootFolderId: vi.fn().mockResolvedValue(opts.rootFolderId ?? 'root-id'),
    iterateAllFilesAndFolders: vi.fn().mockImplementation(() => {
      // Each call returns a fresh async generator over the same chunk list.
      async function* gen() {
        for (const chunk of iterate) yield chunk;
      }
      return gen();
    }),
    getStartPageToken: vi.fn().mockResolvedValue(opts.startPageToken ?? 'start-token-1'),
    listChanges: vi.fn(async () => {
      const response = listChangesQueue[listChangesIdx];
      listChangesIdx++;
      if (!response) throw new Error('listChanges mock exhausted');
      if (response instanceof Error) throw response;
      return response;
    }),
    getQuota: opts.quotaThrows
      ? vi.fn().mockRejectedValue(opts.quotaThrows)
      : vi.fn().mockResolvedValue(opts.quota ?? { total: 1000, used: 100, hasLimit: true }),
  };
}

/**
 * Chainable mock D1. Supports both `prepare(sql).bind(...).run()` and
 * `prepare(sql).all()` (no bind). The SELECT for sync_state returns
 * `opts.syncStateRow`; the SELECT for drive_accounts returns `opts.driveAccounts`.
 * `runCalls` records every .run() invocation (sql + binds) for assertion.
 */
function makeMockDb(
  opts: {
    syncStateRow?: Record<string, unknown> | null;
    alreadySyncing?: boolean;
  } = {},
) {
  const runCalls: { sql: string; binds: any[] }[] = [];
  // Track sync_state rows so the UPSERT+RETURNING lock can simulate correctly.
  const syncStateRows: Record<string, Record<string, unknown>> = {};
  if (opts.syncStateRow) {
    syncStateRows['drive-1'] = opts.syncStateRow;
  }
  if (opts.alreadySyncing) {
    syncStateRows['drive-1'] = { drive_account_id: 'drive-1', status: 'syncing' };
  }

  const db: any = {
    prepare: vi.fn((sql: string) => {
      const makeBound = (binds: any[]) => ({
        __sql: sql,
        __binds: binds,
        run: vi.fn(async () => {
          runCalls.push({ sql, binds });
          return { success: true, meta: { changes: 1 } };
        }),
        first: vi.fn(async () => {
          // Handle the conditional UPSERT+RETURNING lock
          if (sql.includes('INSERT INTO sync_state') && sql.includes('RETURNING')) {
            const driveId = binds[0];
            const existing = syncStateRows[driveId];
            if (existing && existing.status === 'syncing') {
              return null; // Lock denied — already syncing
            }
            syncStateRows[driveId] = { drive_account_id: driveId, status: 'syncing' };
            return { drive_account_id: driveId }; // Lock acquired
          }
          if (sql.includes('FROM sync_state')) {
            return opts.syncStateRow ?? null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          return { results: [] };
        }),
      });
      return {
        bind: vi.fn((...binds: any[]) => makeBound(binds)),
        ...makeBound([]),
      };
    }),
    batch: vi.fn(async (stmts: any[]) => {
      // batchUpsertUnitsWithCheckpoint calls db.batch(stmts). Each stmt carries
      // __sql + __binds from prepare().bind(). Record them for assertions.
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

/** A drive_accounts row shaped exactly as mapDriveRow expects. */
function makeDriveAccountRow(id = 'drive-1'): Record<string, unknown> {
  return {
    id,
    user_id: 'user-1',
    google_account_id: 'g-1',
    email: 'test@example.com',
    name: 'Drive One',
    type: 'oauth',
    is_primary: 1,
    root_folder_id: null,
    total_quota: 1000,
    used_quota: 100,
    quota_override: null,
    quota_updated_at: null,
    sync_status: 'idle',
    sync_error_message: null,
    sync_paused: 0,
    last_synced_at: null,
    created_at: '2024-01-01T00:00:00Z',
  };
}

/** Convert a raw drive_accounts row to a DriveAccount (what syncDriveAccount expects). */
function makeDrive(id = 'drive-1'): DriveAccount {
  return mapDriveRow(makeDriveAccountRow(id));
}

function findCall(calls: { sql: string; binds: any[] }[], fragment: string) {
  return calls.find((c) => c.sql.includes(fragment));
}

// ─── Tests ─────────────────────────────────────────────────────

describe('syncDriveAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('first sync: runs initial sync and persists new change token', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
      startPageToken: 'fresh-token-1',
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: null, // no existing sync_state → first sync
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // Lock acquired via UPSERT+RETURNING (.first() path) — sync proceeds.
    // (If the lock was denied, iterateAllFilesAndFolders would not be called.)
    expect(driveService.iterateAllFilesAndFolders).toHaveBeenCalledTimes(1);
    // After initial sync completes, the new startPageToken is fetched.
    expect(driveService.getStartPageToken).toHaveBeenCalledWith('drive-1');
    // Final idle INSERT persists the new change_token.
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle).toBeTruthy();
    expect(finalIdle!.binds).toEqual(['drive-1', 'fresh-token-1']);
    // Best-effort quota refresh.
    expect(driveService.getQuota).toHaveBeenCalledWith('drive-1');
  });

  it('incremental sync: uses stored change token when present', async () => {
    const driveService = makeDriveServiceMock({
      listChangesResponses: [{ changes: [], newStartPageToken: 'new-token-2' }],
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'old-token', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // Initial sync NOT called because change_token exists.
    expect(driveService.iterateAllFilesAndFolders).not.toHaveBeenCalled();
    // listChanges called once with the stored token.
    expect(driveService.listChanges).toHaveBeenCalledWith('drive-1', 'old-token');
    expect(driveService.listChanges).toHaveBeenCalledTimes(1);
    // Final idle INSERT persists the new newStartPageToken as change_token.
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle!.binds).toEqual(['drive-1', 'new-token-2']);
  });

  it('pagination: incremental sync follows nextPageToken across pages', async () => {
    const driveService = makeDriveServiceMock({
      listChangesResponses: [
        { changes: [], nextPageToken: 'page-2' },
        { changes: [], newStartPageToken: 'final-token' },
      ],
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'start', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    expect(driveService.listChanges).toHaveBeenCalledTimes(2);
    expect(driveService.listChanges).toHaveBeenNthCalledWith(1, 'drive-1', 'start');
    expect(driveService.listChanges).toHaveBeenNthCalledWith(2, 'drive-1', 'page-2');
    // Final change_token is the newStartPageToken from the last response (terminal).
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle!.binds).toEqual(['drive-1', 'final-token']);
  });

  it('error handling: writes error state when getStartPageToken throws (rate limit)', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
    });
    // Simulate a rate-limit error that withBackoff already exhausted (so it propagates).
    driveService.getStartPageToken = vi.fn().mockRejectedValue(new Error('rate limit exceeded'));

    const { db, runCalls } = makeMockDb({
      syncStateRow: null,
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // sync_state error row inserted with the error_message.
    const errorRow = findCall(runCalls, "VALUES (?, 'error', ?)");
    expect(errorRow).toBeTruthy();
    expect(errorRow!.binds[0]).toBe('drive-1');
    expect(errorRow!.binds[1]).toContain('rate limit exceeded');
    // The success INSERT (last_synced_at + change_token) must NOT have run.
    expect(
      findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)'),
    ).toBeFalsy();
  });

  it('subrequest budget: pauses initial sync when EITHER pool hits budget and saves next_page_token', async () => {
    // External starts at 1 (getRootFolderId). Per page: +1 external (Google API).
    // Internal starts at 2 (acquireLock + findSyncState). Per page (empty chunks):
    //   +1 heartbeat + 0 findExistingForDelta + 1 batchUpsertUnits = +2.
    // External: 1 + 44 = 45 ≥ 45 → pauses after page 44.
    // Internal: 2 + 2×44 = 90 (< 990, continues).
    // External is the binding constraint for empty chunks. 44 checkpoints saved.
    // Tests use 46 chunks so the sync has enough pages to hit the external budget.
    const chunks: Chunk[] = Array.from({ length: 46 }, (_, i) => ({
      files: [],
      folders: [],
      nextPageToken: `page-${i + 2}`,
    }));
    const driveService = makeDriveServiceMock({ iterate: chunks });

    const { db, runCalls } = makeMockDb({
      syncStateRow: null,
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // getStartPageToken NOT called — paused before completion.
    expect(driveService.getStartPageToken).not.toHaveBeenCalled();
    // Status set to 'idle' (not 'error') — UI must not show a false failure.
    const idleUpdate = findCall(runCalls, "UPDATE sync_state SET status = 'idle' WHERE");
    expect(idleUpdate).toBeTruthy();
    // The success INSERT (last_synced_at + change_token) NOT called.
    expect(
      findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)'),
    ).toBeFalsy();
    // next_page_token saved on every page (44 checkpoint UPDATEs).
    const checkpointUpdates = runCalls.filter((c) =>
      c.sql.includes('UPDATE sync_state SET next_page_token = ?'),
    );
    expect(checkpointUpdates).toHaveLength(44);
    // Last checkpoint = page-45 (from the 44th chunk, i=43).
    expect(checkpointUpdates[43].binds).toEqual(['page-45', 'drive-1']);
  });

  it('subrequest budget: pauses incremental sync when EITHER pool hits budget with current token', async () => {
    // External starts at 1 (getRootFolderId). Per iter: +1 external (listChanges).
    // Internal starts at 2. Per iter (empty changes): +1 heartbeat + 0 lookup
    //   + 0 batch = +1. Budget check is at TOP (after heartbeat, before listChanges).
    // External check: 1 + N ≥ 45. Internal check: 2 + N ≥ 990.
    // iter N+1: heartbeat → internal = 3 + N. Check max(1 + N ≥ 45, 3 + N ≥ 990)?
    // External hits first: after iter 44, external = 45. iter 45: heartbeat
    //   → internal = 47. Check external 45 ≥ 45 → return currentToken.
    // 44 listChanges calls (iter 44 completes, iter 45 pauses before listChanges).
    const responses = Array.from({ length: 44 }, (_, i) => ({
      changes: [],
      nextPageToken: `page-${i + 2}`,
    }));
    const driveService = makeDriveServiceMock({ listChangesResponses: responses });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'start-token', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // 44 external listChanges calls — the 45th iteration returns early.
    expect(driveService.listChanges).toHaveBeenCalledTimes(44);
    // The final change_token is the last nextPageToken (page-45) — saved as
    // change_token so the next cron cycle resumes from the same startPageToken.
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle).toBeTruthy();
    expect(finalIdle!.binds).toEqual(['drive-1', 'page-45']);
  });

  it('resumes initial sync from saved next_page_token', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }], // 1 chunk, no nextPageToken → completes
      startPageToken: 'final-token',
    });

    const { db, runCalls } = makeMockDb({
      // change_token null BUT next_page_token present → resume initial sync.
      syncStateRow: { change_token: null, next_page_token: 'resume-page' },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // iterateAllFilesAndFolders receives the saved next_page_token as startPageToken.
    expect(driveService.iterateAllFilesAndFolders).toHaveBeenCalledWith('drive-1', 'resume-page');
    expect(driveService.getStartPageToken).toHaveBeenCalledWith('drive-1');
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle!.binds).toEqual(['drive-1', 'final-token']);
  });

  it('skips drives already syncing (D1 lock concurrency guard)', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
    });

    const { db } = makeMockDb({
      syncStateRow: null,
      alreadySyncing: true, // sync_state.status = 'syncing' → lock denied
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    expect(driveService.iterateAllFilesAndFolders).not.toHaveBeenCalled();
    expect(driveService.getStartPageToken).not.toHaveBeenCalled();
  });

  it('getQuota failure is non-fatal — sync still completes', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
      startPageToken: 'token-1',
      quotaThrows: new Error('quota fetch failed'),
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: null,
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    expect(driveService.getQuota).toHaveBeenCalledWith('drive-1');
    // Sync completed normally — final idle INSERT is present.
    expect(
      findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)'),
    ).toBeTruthy();
    // No error row inserted (getQuota failure is swallowed).
    expect(findCall(runCalls, "VALUES (?, 'error', ?)")).toBeFalsy();
  });

  it('handles multiple drive accounts in sequence', async () => {
    // syncDriveAccount takes one drive — call it twice to verify sequential
    // processing works (the queue consumer calls it once per message, but
    // the function itself must work correctly across multiple invocations).
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
      startPageToken: 'token-multi',
    });

    const { db } = makeMockDb({
      syncStateRow: null, // both go through initial sync path
    });

    await syncDriveAccount(makeDrive('drive-1'), db, driveService as any);
    await syncDriveAccount(makeDrive('drive-2'), db, driveService as any);

    // Fresh generator per call → initial sync runs once per drive.
    expect(driveService.iterateAllFilesAndFolders).toHaveBeenCalledTimes(2);
    expect(driveService.getStartPageToken).toHaveBeenCalledTimes(2);
  });

  it('anomaly recovery: returns empty string when Google returns no tokens (forces full re-sync)', async () => {
    // Google API anomaly — listChanges returns neither newStartPageToken
    // nor nextPageToken. The old code threw (stuck forever); the new code
    // returns '' (falsy) → upsertIdleCompleted saves change_token='' →
    // next sync cycle runs performInitialSync (full re-fetch).
    const driveService = makeDriveServiceMock({
      listChangesResponses: [{ changes: [] }], // no newStartPageToken, no nextPageToken
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'stuck-token', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // The final idle INSERT saves change_token='' (empty string, falsy).
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle).toBeTruthy();
    expect(finalIdle!.binds).toEqual(['drive-1', '']);
    // No error row inserted — the anomaly is handled gracefully (self-heals).
    expect(findCall(runCalls, "VALUES (?, 'error', ?)")).toBeFalsy();
  });

  // ─── change.removed=true branch (Bug #1: isFolder ghost-row fix) ───

  it('removed branch: folder removal pushes BOTH deletes (no ghost row)', async () => {
    // Google omits `file` when removed=true → isFolder is unreliable.
    // The fix pushes both delete statements unconditionally so the
    // drive_folders row is actually deleted (was previously skipped).
    const driveService = makeDriveServiceMock({
      listChangesResponses: [
        {
          changes: [{ fileId: 'folder-1', removed: true, file: undefined }],
          newStartPageToken: 'next-token',
        },
      ],
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'curr-token', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // Both DELETE statements must be pushed (one is a 0-row no-op, idempotent).
    const folderDelete = findCall(runCalls, 'DELETE FROM drive_folders');
    const fileDelete = findCall(runCalls, 'DELETE FROM files');
    expect(folderDelete).toBeTruthy();
    expect(fileDelete).toBeTruthy();
    expect(folderDelete!.binds).toEqual(['drive-1', 'folder-1']);
    expect(fileDelete!.binds).toEqual(['drive-1', 'folder-1']);
    // No storage delta for folder removals (oldState is null → computeStorageDelta returns []).
    expect(findCall(runCalls, 'file_storage_stats')).toBeFalsy();
  });

  it('removed branch: file removal pushes BOTH deletes (drive_folders no-op)', async () => {
    // For a file removal, both DELETE statements are pushed. The drive_folders
    // DELETE is a 0-row no-op (the ID isn't in drive_folders). The storage delta
    // mechanism is unit-tested in storage-stats.test.ts — here we verify the
    // fix's core behavior: both DELETEs fire unconditionally on removed=true.
    const driveService = makeDriveServiceMock({
      listChangesResponses: [
        {
          changes: [{ fileId: 'file-1', removed: true, file: undefined }],
          newStartPageToken: 'next-token',
        },
      ],
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'curr-token', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // Both DELETE statements pushed (drive_folders DELETE is a 0-row no-op here).
    const fileDelete = findCall(runCalls, 'DELETE FROM files');
    expect(fileDelete).toBeTruthy();
    expect(fileDelete!.binds).toEqual(['drive-1', 'file-1']);
    expect(findCall(runCalls, 'DELETE FROM drive_folders')).toBeTruthy();
  });

  it('removed branch: unknown ID is a no-op (both DELETEs match 0 rows, no error)', async () => {
    // A removed=true change for a fileId that doesn't exist in D1 (e.g., already
    // deleted in a prior sync) must not throw. Both DELETEs are idempotent.
    const driveService = makeDriveServiceMock({
      listChangesResponses: [
        {
          changes: [{ fileId: 'nonexistent-id', removed: true, file: undefined }],
          newStartPageToken: 'next-token',
        },
      ],
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'curr-token', next_page_token: null },
    });

    // Must not throw — syncDriveAccount returns true on successful completion.
    await expect(syncDriveAccount(makeDrive(), db, driveService as any)).resolves.toBe(true);

    // Both DELETEs pushed (0-row no-ops, no error).
    expect(findCall(runCalls, 'DELETE FROM drive_folders')).toBeTruthy();
    expect(findCall(runCalls, 'DELETE FROM files')).toBeTruthy();
    // No error row.
    expect(findCall(runCalls, "VALUES (?, 'error', ?)")).toBeFalsy();
  });

  it('removed branch fix does not affect trashed/active branches (regression guard)', async () => {
    // A trashed change (removed=false, file.trashed=true) must still go through
    // the trashed branch — markTrashed, NOT delete. Confirms the removed-branch
    // fix didn't accidentally alter the trashed/active paths.
    const driveService = makeDriveServiceMock({
      listChangesResponses: [
        {
          changes: [
            {
              fileId: 'file-1',
              removed: false,
              file: {
                id: 'file-1',
                name: 'doc.pdf',
                mimeType: 'application/pdf',
                size: '1024',
                trashed: true,
                parents: ['root-id'],
                owners: [{ me: true, displayName: 'me', emailAddress: 'me@example.com' }],
              },
            },
          ],
          newStartPageToken: 'next-token',
        },
      ],
    });

    const { db, runCalls } = makeMockDb({
      syncStateRow: { change_token: 'curr-token', next_page_token: null },
    });

    await syncDriveAccount(makeDrive(), db, driveService as any);

    // Trashed branch → markTrashedByDriveAndGoogleIdStmt (UPDATE, not DELETE).
    expect(findCall(runCalls, 'is_trashed = 1')).toBeTruthy();
    // Must NOT have pushed a DELETE (trashed != removed).
    expect(findCall(runCalls, 'DELETE FROM files')).toBeFalsy();
    expect(findCall(runCalls, 'DELETE FROM drive_folders')).toBeFalsy();
  });
});
