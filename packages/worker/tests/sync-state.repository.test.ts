import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncStateRepository } from '../src/repositories/sync-state.repository';

/**
 * Direct unit tests for SyncStateRepository. Verifies SQL fragments, bind
 * values, and (critically) which terminator each method uses — `acquireLock`
 * must use `.first()` (to read the RETURNING result) while the mutations use
 * `.run()`. The sync engine's mocked-D1 unit tests assert on these same SQL
 * fragments, so the strings here are the contract.
 */

describe('SyncStateRepository', () => {
  let repo: SyncStateRepository;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let mockBind: ReturnType<typeof vi.fn>;
  let mockAll: ReturnType<typeof vi.fn>;
  let mockFirst: ReturnType<typeof vi.fn>;
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll = vi.fn().mockResolvedValue({ results: [] });
    mockFirst = vi.fn().mockResolvedValue(null);
    mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    mockBind = vi.fn().mockReturnValue({ all: mockAll, first: mockFirst, run: mockRun });
    mockPrepare = vi.fn().mockReturnValue({
      bind: mockBind,
      all: mockAll,
      first: mockFirst,
      run: mockRun,
    });
    const mockDb = { prepare: mockPrepare } as any;
    repo = new SyncStateRepository(mockDb);
  });

  // ─── lock ───

  describe('acquireLock', () => {
    it('conditional UPSERT+RETURNING via .first() (NOT .run), binds driveId + stale TTL', async () => {
      mockFirst.mockResolvedValueOnce({ drive_account_id: 'd-1' });

      const result = await repo.acquireLock('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO sync_state (drive_account_id, status, locked_at)');
      expect(sql).toContain("'syncing'");
      expect(sql).toContain("datetime('now')");
      expect(sql).toContain('ON CONFLICT(drive_account_id) DO UPDATE SET status =');
      expect(sql).toContain('WHERE sync_state.status !=');
      expect(sql).toContain('julianday'); // stale-lock TTL check
      expect(sql).toContain('RETURNING drive_account_id');
      expect(mockBind).toHaveBeenCalledWith('d-1', 20 * 60 * 1000);
      // MUST use .first() so the RETURNING result is readable — .run() would
      // make the lock appear in sync.test.ts's runCalls (breaking assertions).
      expect(mockFirst).toHaveBeenCalledTimes(1);
      expect(mockRun).not.toHaveBeenCalled();
      expect(result).toEqual({ drive_account_id: 'd-1' });
    });

    it('returns null when the lock is denied (already syncing)', async () => {
      mockFirst.mockResolvedValueOnce(null);
      const result = await repo.acquireLock('d-1');
      expect(result).toBeNull();
    });
  });

  // ─── reads ───

  describe('findSyncState', () => {
    it('SELECTs * by drive_account_id via .first(), single bind', async () => {
      mockFirst.mockResolvedValueOnce({ change_token: 'tok-1', next_page_token: null });

      const result = await repo.findSyncState('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM sync_state WHERE drive_account_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
      expect(mockFirst).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ change_token: 'tok-1', next_page_token: null });
    });
  });

  // ─── mutations ───

  describe('setIdle', () => {
    it('UPDATEs status to idle via .run(), single bind (paused path)', async () => {
      await repo.setIdle('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain("UPDATE sync_state SET status = 'idle' WHERE drive_account_id = ?");
      expect(mockBind).toHaveBeenCalledWith('d-1');
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertIdleCompleted', () => {
    it('UPSERTs idle + change_token via .run(), two binds (driveId, changeToken)', async () => {
      await repo.upsertIdleCompleted('d-1', 'fresh-token');

      const sql = mockPrepare.mock.calls[0][0] as string;
      // The completion INSERT carries the full column list — this fragment is
      // asserted by tests/sync.test.ts to distinguish the success path from
      // the error path, so it must be preserved verbatim.
      expect(sql).toContain('status, last_synced_at, change_token, next_page_token) VALUES (?,');
      expect(sql).toContain("'idle'");
      expect(sql).toContain('CURRENT_TIMESTAMP');
      expect(sql).toContain('ON CONFLICT(drive_account_id) DO UPDATE');
      expect(sql).toContain("status = 'idle'");
      expect(sql).toContain('change_token = excluded.change_token');
      expect(sql).toContain('next_page_token = NULL');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'fresh-token');
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertError', () => {
    it('UPSERTs error + message via .run(), two binds (driveId, message)', async () => {
      await repo.upsertError('d-1', 'rate limit exceeded');

      const sql = mockPrepare.mock.calls[0][0] as string;
      // This fragment is asserted by tests/sync.test.ts to detect the error
      // path — preserve verbatim.
      expect(sql).toContain("VALUES (?, 'error', ?)");
      expect(sql).toContain('ON CONFLICT(drive_account_id) DO UPDATE');
      expect(sql).toContain('status = ');
      expect(sql).toContain("'error'");
      expect(sql).toContain('error_message = excluded.error_message');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'rate limit exceeded');
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateNextPageToken', () => {
    it('UPDATEs next_page_token via .run(), two binds (token, driveId)', async () => {
      await repo.updateNextPageToken('d-1', 'page-2');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE sync_state SET next_page_token = ? WHERE drive_account_id = ?');
      // Bind order matters: token first, then driveId (matches the original
      // inline SQL and the sync.test.ts checkpoint assertion).
      expect(mockBind).toHaveBeenCalledWith('page-2', 'd-1');
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });
});
