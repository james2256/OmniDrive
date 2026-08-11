import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScheduledSync, syncDriveAccount } from '../src/services/sync';

// Mock the createDriveService factory so sync.ts uses our mock GoogleDriveService
// instead of constructing a real one (which would hit the network).
vi.mock('../src/lib/drive-factory', () => ({
  createDriveService: vi.fn(),
}));

import { createDriveService } from '../src/lib/drive-factory';

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
    driveAccounts?: Record<string, unknown>[];
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
          if (sql.includes('FROM drive_accounts')) {
            return { results: opts.driveAccounts ?? [] };
          }
          return { results: [] };
        }),
      });
      return {
        bind: vi.fn((...binds: any[]) => makeBound(binds)),
        ...makeBound([]),
      };
    }),
    batch: vi.fn(async (stmts: any[]) =>
      stmts.map(() => ({ success: true, meta: { changes: 1 } })),
    ),
  };

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

function findCall(calls: { sql: string; binds: any[] }[], fragment: string) {
  return calls.find((c) => c.sql.includes(fragment));
}

function makeEnv(db: any) {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'secret',
    TOKEN_ENCRYPTION_KEY: 'key',
  } as any;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('runScheduledSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('first sync: runs initial sync and persists new change token', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
      startPageToken: 'fresh-token-1',
    });
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: null, // no existing sync_state → first sync
    });

    await runScheduledSync(makeEnv(db));

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
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: { change_token: 'old-token', next_page_token: null },
    });

    await runScheduledSync(makeEnv(db));

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
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: { change_token: 'start', next_page_token: null },
    });

    await runScheduledSync(makeEnv(db));

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
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: null,
    });

    await runScheduledSync(makeEnv(db));

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

  it('subrequest budget: pauses initial sync at 45 external calls and saves next_page_token', async () => {
    // externalCount starts at 1 (getRootFolderId). Each chunk iteration → +1.
    // After iteration 44: externalCount = 45 → check 45 >= 45 AND chunk.nextPageToken
    // → return false (paused). So 44 chunks, each with nextPageToken.
    const chunks: Chunk[] = Array.from({ length: 44 }, (_, i) => ({
      files: [],
      folders: [],
      nextPageToken: `page-${i + 2}`,
    }));
    const driveService = makeDriveServiceMock({ iterate: chunks });
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: null,
    });

    await runScheduledSync(makeEnv(db));

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

  it('subrequest budget: pauses incremental sync at 45 external calls with current token', async () => {
    // externalCount starts at 1 (getRootFolderId). Loop:
    //   iter 1: check 1>=45? No. listChanges. externalCount=2.
    //   ...
    //   iter 44: check 44>=45? No. listChanges. externalCount=45.
    //   iter 45: check 45>=45? Yes → return currentToken (no listChanges).
    // So 44 listChanges calls, each returning nextPageToken (no newStartPageToken).
    const responses = Array.from({ length: 44 }, (_, i) => ({
      changes: [],
      nextPageToken: `page-${i + 2}`,
    }));
    const driveService = makeDriveServiceMock({ listChangesResponses: responses });
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: { change_token: 'start-token', next_page_token: null },
    });

    await runScheduledSync(makeEnv(db));

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
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      // change_token null BUT next_page_token present → resume initial sync.
      syncStateRow: { change_token: null, next_page_token: 'resume-page' },
    });

    await runScheduledSync(makeEnv(db));

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
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: null,
      alreadySyncing: true, // sync_state.status = 'syncing' → lock denied
    });

    await runScheduledSync(makeEnv(db));

    expect(driveService.iterateAllFilesAndFolders).not.toHaveBeenCalled();
    expect(driveService.getStartPageToken).not.toHaveBeenCalled();
    // The UPSERT+RETURNING lock was attempted (INSERT INTO sync_state with RETURNING).
    expect(findCall(runCalls, 'RETURNING')).toBeFalsy(); // .first() path, not .run()
  });

  it('getQuota failure is non-fatal — sync still completes', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
      startPageToken: 'token-1',
      quotaThrows: new Error('quota fetch failed'),
    });
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: null,
    });

    await runScheduledSync(makeEnv(db));

    expect(driveService.getQuota).toHaveBeenCalledWith('drive-1');
    // Sync completed normally — final idle INSERT is present.
    expect(
      findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)'),
    ).toBeTruthy();
    // No error row inserted (getQuota failure is swallowed).
    expect(findCall(runCalls, "VALUES (?, 'error', ?)")).toBeFalsy();
  });

  it('handles multiple drive accounts in sequence', async () => {
    const driveService = makeDriveServiceMock({
      iterate: [{ files: [], folders: [] }],
      startPageToken: 'token-multi',
    });
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db } = makeMockDb({
      driveAccounts: [makeDriveAccountRow('drive-1'), makeDriveAccountRow('drive-2')],
      syncStateRow: null, // both go through initial sync path
    });

    await runScheduledSync(makeEnv(db));

    // Fresh generator per call → initial sync runs once per drive.
    expect(driveService.iterateAllFilesAndFolders).toHaveBeenCalledTimes(2);
    expect(driveService.getStartPageToken).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no drive accounts exist', async () => {
    const driveService = makeDriveServiceMock();
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [],
      syncStateRow: null,
    });

    await runScheduledSync(makeEnv(db));

    expect(driveService.iterateAllFilesAndFolders).not.toHaveBeenCalled();
    expect(driveService.getStartPageToken).not.toHaveBeenCalled();
    expect(findCall(runCalls, "VALUES (?, 'syncing')")).toBeFalsy();
  });

  it('anomaly recovery: returns empty string when Google returns no tokens (forces full re-sync)', async () => {
    // Google API anomaly — listChanges returns neither newStartPageToken
    // nor nextPageToken. The old code threw (stuck forever); the new code
    // returns '' (falsy) → upsertIdleCompleted saves change_token='' →
    // next sync cycle runs performInitialSync (full re-fetch).
    const driveService = makeDriveServiceMock({
      listChangesResponses: [{ changes: [] }], // no newStartPageToken, no nextPageToken
    });
    vi.mocked(createDriveService).mockReturnValue(driveService as any);

    const { db, runCalls } = makeMockDb({
      driveAccounts: [makeDriveAccountRow()],
      syncStateRow: { change_token: 'stuck-token', next_page_token: null },
    });

    await syncDriveAccount(makeDriveAccountRow() as any, db, driveService as any);

    // The final idle INSERT saves change_token='' (empty string, falsy).
    const finalIdle = findCall(runCalls, 'status, last_synced_at, change_token, next_page_token)');
    expect(finalIdle).toBeTruthy();
    expect(finalIdle!.binds).toEqual(['drive-1', '']);
    // No error row inserted — the anomaly is handled gracefully (self-heals).
    expect(findCall(runCalls, "VALUES (?, 'error', ?)")).toBeFalsy();
  });
});
