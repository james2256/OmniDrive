import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriveRepository } from '../src/repositories/drive.repository';

/**
 * Direct unit tests for DriveRepository. Verifies SQL fragments and bind
 * values for the core methods. Complementary to integration/repositories.test.ts
 * which exercises the same repository through a real D1.
 *
 * NOTE: the task spec referenced `findAllByUser` and `create` methods — neither
 * exists in the source. The closest equivalents are `findAllWithSyncState`
 * (returns drives with sync state via LEFT JOIN) and `insertDriveAccount`
 * (inserts a new drive account). Tests cover the actual exports.
 */

describe('DriveRepository', () => {
  let repo: DriveRepository;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let mockBind: ReturnType<typeof vi.fn>;
  let mockAll: ReturnType<typeof vi.fn>;
  let mockFirst: ReturnType<typeof vi.fn>;
  let mockRun: ReturnType<typeof vi.fn>;
  let mockBatch: ReturnType<typeof vi.fn>;

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
    mockBatch = vi
      .fn()
      .mockImplementation(async (stmts: unknown[]) =>
        stmts.map(() => ({ success: true, meta: { changes: 1 } })),
      );
    const mockDb = { prepare: mockPrepare, batch: mockBatch } as any;
    repo = new DriveRepository(mockDb);
  });

  // ─── drive_accounts reads ───

  describe('findByIdAndUser', () => {
    it('selects id + email scoped to a user (two binds)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'd-1', email: 'a@b.com' });

      const result = await repo.findByIdAndUser('d-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT id, email FROM drive_accounts WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'u-1');
      expect(result).toEqual({ id: 'd-1', email: 'a@b.com' });
    });
  });

  describe('findById', () => {
    it('selects full row by id only (no user check)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'd-1', email: 'a@b.com', user_id: 'u-1' });

      const result = await repo.findById('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM drive_accounts WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
      expect(result).toEqual(expect.objectContaining({ id: 'd-1' }));
    });
  });

  describe('findFullByIdAndUser', () => {
    it('selects * by id + user (full row)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'd-1', user_id: 'u-1' });

      await repo.findFullByIdAndUser('d-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'u-1');
    });
  });

  describe('findForMove', () => {
    it('selects id + root_folder_id for move op', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'd-1', root_folder_id: 'root-1' });

      await repo.findForMove('d-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT id, root_folder_id FROM drive_accounts WHERE id = ? AND user_id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('d-1', 'u-1');
    });
  });

  describe('findTokenStatus', () => {
    it('selects 1 as ok from drive_tokens (health check)', async () => {
      mockFirst.mockResolvedValueOnce({ ok: 1 });

      const result = await repo.findTokenStatus('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT 1 as ok FROM drive_tokens WHERE drive_account_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
      expect(result).toEqual({ ok: 1 });
    });
  });

  describe('findNextDrive', () => {
    it('selects next drive by created_at ASC (for primary promotion)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'd-2' });

      await repo.findNextDrive('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT id FROM drive_accounts WHERE user_id = ?');
      expect(sql).toContain('ORDER BY created_at ASC LIMIT 1');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findPrimaryDriveId', () => {
    it('selects primary drive by is_primary DESC', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'd-1' });

      await repo.findPrimaryDriveId('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT id FROM drive_accounts WHERE user_id = ?');
      expect(sql).toContain('ORDER BY is_primary DESC LIMIT 1');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findAllWithSyncState', () => {
    it('LEFT JOINs sync_state with CASE WHEN next_page_token IS NOT NULL', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'd-1', sync_status: 'syncing', sync_paused: 0 }],
      });

      await repo.findAllWithSyncState('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT a.*');
      expect(sql).toContain('s.status as sync_status');
      expect(sql).toContain(
        'CASE WHEN s.next_page_token IS NOT NULL THEN 1 ELSE 0 END as sync_paused',
      );
      expect(sql).toContain('LEFT JOIN sync_state s ON a.id = s.drive_account_id');
      expect(sql).toContain('WHERE a.user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findDrivesWithTokens', () => {
    it('uses IN(?) with N placeholders for N drive ids (DISTINCT)', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ drive_account_id: 'd-1' }, { drive_account_id: 'd-3' }],
      });

      await repo.findDrivesWithTokens(['d-1', 'd-2', 'd-3']);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT DISTINCT drive_account_id FROM drive_tokens');
      // placeholders = driveIds.map(() => '?').join(',') — no spaces between.
      expect(sql).toContain('IN (?,?,?)');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'd-2', 'd-3');
    });

    it('returns empty results without querying when no drives passed', async () => {
      const result = await repo.findDrivesWithTokens([]);
      expect(result.results).toEqual([]);
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });

  describe('findAllByType', () => {
    it('SELECTs * with IN(?,?) for the syncable drive types, via .all()', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'd-1', type: 'oauth' }] });

      await repo.findAllByType(['oauth', 'service_account']);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM drive_accounts WHERE type IN');
      expect(sql).toContain('IN (?,?)');
      expect(mockBind).toHaveBeenCalledWith('oauth', 'service_account');
      expect(mockAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteDriveFolderStmt', () => {
    it('returns a prepared DELETE (not run) scoped by drive + google_folder_id', () => {
      const stmt = repo.deleteDriveFolderStmt('d-1', 'gfolder-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'DELETE FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('d-1', 'gfolder-1');
      // Stmt-returning methods MUST NOT call .run() — the statement is handed
      // to batchInChunks for batch composition.
      expect(mockRun).not.toHaveBeenCalled();
      // Returns the bound prepared statement (the mock's bind return value).
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  describe('markDriveFolderTrashedStmt', () => {
    it('returns a prepared is_trashed=1 UPDATE (not run) scoped by drive + google_folder_id', () => {
      const stmt = repo.markDriveFolderTrashedStmt('d-1', 'gfolder-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'UPDATE drive_folders SET is_trashed = 1 WHERE drive_account_id = ? AND google_folder_id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('d-1', 'gfolder-1');
      expect(mockRun).not.toHaveBeenCalled();
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  // ─── mutations ───

  describe('updateQuota', () => {
    it('UPDATEs total_quota + used_quota with CURRENT_TIMESTAMP', async () => {
      await repo.updateQuota('d-1', 15_000_000_000, 5_000_000_000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE drive_accounts SET total_quota = ?, used_quota = ?');
      expect(sql).toContain('quota_updated_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith(15_000_000_000, 5_000_000_000, 'd-1');
    });
  });

  describe('updateUsedQuota', () => {
    it('UPDATEs used_quota only, with CURRENT_TIMESTAMP', async () => {
      await repo.updateUsedQuota('d-1', 7_500_000_000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE drive_accounts SET used_quota = ?');
      expect(sql).toContain('WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith(7_500_000_000, 'd-1');
    });
  });

  describe('setPrimary', () => {
    it('UPDATEs is_primary=1 by id only (no user check)', async () => {
      await repo.setPrimary('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE drive_accounts SET is_primary = 1 WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
    });
  });

  describe('upsertTokens', () => {
    it('INSERTs ON CONFLICT UPDATE encrypted_tokens + updated_at', async () => {
      await repo.upsertTokens('d-1', 'encrypted-blob', 1_700_000_000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO drive_tokens');
      expect(sql).toContain('ON CONFLICT(drive_account_id) DO UPDATE');
      expect(sql).toContain('encrypted_tokens = excluded.encrypted_tokens');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'encrypted-blob', 1_700_000_000);
    });
  });

  describe('deleteQuotaCache', () => {
    it('DELETEs quota_cache rows for a drive', async () => {
      await repo.deleteQuotaCache('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM quota_cache WHERE drive_account_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
    });
  });

  describe('insertDriveAccount', () => {
    it('INSERTs with type="service_account" literal and 7 binds', async () => {
      await repo.insertDriveAccount({
        id: 'd-1',
        userId: 'u-1',
        googleAccountId: 'g-acct-1',
        email: 'a@b.com',
        name: 'My Drive',
        isPrimary: 1,
        rootFolderId: 'root-1',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO drive_accounts');
      expect(sql).toContain("'service_account'");
      expect(mockBind).toHaveBeenCalledWith(
        'd-1',
        'u-1',
        'g-acct-1',
        'a@b.com',
        'My Drive',
        1,
        'root-1',
      );
    });
  });

  // ─── cascade delete ───

  describe('deleteDrive (cascade)', () => {
    it('runs an 8-statement batch (cascade order: children before parents)', async () => {
      await repo.deleteDrive('d-1', 'u-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(8);
    });

    it('deletes the drive_accounts row LAST (with id + user_id)', async () => {
      await repo.deleteDrive('d-1', 'u-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      const last = sqls[sqls.length - 1];
      expect(last).toBe('DELETE FROM drive_accounts WHERE id = ? AND user_id = ?');
    });

    it('binds driveId for the first 7 statements, then driveId+userId for the user row', async () => {
      await repo.deleteDrive('d-1', 'u-1');

      // First 7 statements: single bind (driveId).
      for (let i = 1; i <= 7; i++) {
        expect(mockBind).toHaveBeenNthCalledWith(i, 'd-1');
      }
      // 8th statement: driveId + userId (the drive_accounts row delete).
      expect(mockBind).toHaveBeenNthCalledWith(8, 'd-1', 'u-1');
    });

    it('includes cascade deletes for all dependent tables', async () => {
      await repo.deleteDrive('d-1', 'u-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string).join('\n');
      expect(sqls).toContain(
        'DELETE FROM s3_multipart_parts WHERE upload_id IN (SELECT upload_id FROM s3_multipart_uploads WHERE drive_account_id = ?)',
      );
      expect(sqls).toContain('DELETE FROM s3_multipart_uploads WHERE drive_account_id = ?');
      expect(sqls).toContain('DELETE FROM sync_state WHERE drive_account_id = ?');
      expect(sqls).toContain('DELETE FROM quota_cache WHERE drive_account_id = ?');
      expect(sqls).toContain('DELETE FROM drive_folders WHERE drive_account_id = ?');
      expect(sqls).toContain('DELETE FROM files WHERE drive_account_id = ?');
      expect(sqls).toContain('DELETE FROM drive_tokens WHERE drive_account_id = ?');
    });
  });

  // ─── drive_folders operations ───

  describe('findBreadcrumbPath', () => {
    it('uses a RECURSIVE CTE with three binds (driveId, googleFolderId, driveId again)', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'g-1', name: 'Root' }] });

      await repo.findBreadcrumbPath('d-1', 'g-folder-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('WITH RECURSIVE breadcrumb_path');
      expect(sql).toContain('UNION ALL');
      expect(sql).toContain('ORDER BY lvl DESC');
      // The recursive CTE reuses driveId for the anchor + the recursive member.
      expect(mockBind).toHaveBeenCalledWith('d-1', 'g-folder-1', 'd-1');
    });
  });

  // ─── PR 2: shared-link resolver + starred/trashed drive-folder reads ───

  describe('findDriveFolderMetaByGoogleId', () => {
    it('SELECTs drive_account_id + name by google_folder_id, scoped by userId via JOIN', async () => {
      mockFirst.mockResolvedValueOnce({ drive_account_id: 'd-1', name: 'My Folder' });

      const result = await repo.findDriveFolderMetaByGoogleId('gfolder-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT df.drive_account_id, df.name');
      expect(sql).toContain('FROM drive_folders df');
      expect(sql).toContain('JOIN drive_accounts da ON df.drive_account_id = da.id');
      expect(sql).toContain('df.google_folder_id = ?');
      expect(sql).toContain('da.user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('gfolder-1', 'u-1');
      expect(result).toEqual({ drive_account_id: 'd-1', name: 'My Folder' });
    });
  });

  describe('findStarredDriveFolders', () => {
    it('SELECTs starred non-trashed drive folders with drive email JOIN, synced_at DESC', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'df-1', is_starred: 1 }] });

      await repo.findStarredDriveFolders('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT df.*, d.email as driveEmail FROM drive_folders df');
      expect(sql).toContain('JOIN drive_accounts d ON df.drive_account_id = d.id');
      expect(sql).toContain('d.user_id = ?');
      expect(sql).toContain('df.is_starred = 1');
      expect(sql).toContain('df.is_trashed = 0');
      expect(sql).toContain('ORDER BY df.synced_at DESC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findTrashedDriveFolders', () => {
    it('SELECTs trashed drive folders with drive email JOIN, created_at DESC', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'df-1', is_trashed: 1 }] });

      await repo.findTrashedDriveFolders('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT df.*, d.email as driveEmail FROM drive_folders df');
      expect(sql).toContain('JOIN drive_accounts d ON df.drive_account_id = d.id');
      expect(sql).toContain('d.user_id = ?');
      expect(sql).toContain('df.is_trashed = 1');
      expect(sql).toContain('ORDER BY df.created_at DESC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  // ─── PR 3: drive_tokens read + quota_cache read/upsert/expiry ───

  describe('findEncryptedTokens', () => {
    it('SELECTs encrypted_tokens by drive_account_id via .first()', async () => {
      mockFirst.mockResolvedValueOnce({ encrypted_tokens: 'enc-blob' });

      const result = await repo.findEncryptedTokens('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT encrypted_tokens FROM drive_tokens WHERE drive_account_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
      expect(result).toEqual({ encrypted_tokens: 'enc-blob' });
    });
  });

  describe('findQuotaCache', () => {
    it('SELECTs payload + updated_at by drive_account_id via .first()', async () => {
      mockFirst.mockResolvedValueOnce({ payload: '{"v":2}', updated_at: 1700000000 });

      const result = await repo.findQuotaCache('d-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT payload, updated_at FROM quota_cache WHERE drive_account_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1');
      expect(result).toEqual({ payload: '{"v":2}', updated_at: 1700000000 });
    });
  });

  describe('upsertQuotaCache', () => {
    it('UPSERTs quota_cache payload + updated_at, 3 binds', async () => {
      await repo.upsertQuotaCache('d-1', '{"v":2}', 1700000000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO quota_cache (drive_account_id, payload, updated_at)');
      expect(sql).toContain('ON CONFLICT(drive_account_id) DO UPDATE SET');
      expect(sql).toContain('payload = excluded.payload');
      expect(sql).toContain('updated_at = excluded.updated_at');
      expect(mockBind).toHaveBeenCalledWith('d-1', '{"v":2}', 1700000000);
    });
  });

  describe('deleteExpiredQuotaCache', () => {
    it('DELETEs quota_cache by updated_at < cutoff, single bind', async () => {
      await repo.deleteExpiredQuotaCache(1700000000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM quota_cache WHERE updated_at < ?');
      expect(mockBind).toHaveBeenCalledWith(1700000000);
    });
  });
});
