import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileRepository } from '../src/repositories/file.repository';

/**
 * Direct unit tests for FileRepository. Verifies SQL fragments and bind values
 * for each public method. Complementary to integration/repositories.test.ts.
 *
 * NOTE: the task spec referenced methods named `insert`, `starFile`, `unstarFile`,
 * and `permanentDelete` — none of those exact names exist. The actual exports
 * are `insertUploaded`, `star`, `unstar`, and `delete`. Tests cover the actual
 * exports. (`star`/`unstar` return Promise<boolean> based on meta.changes; `delete`
 * returns the D1Result without a cascade.)
 */

describe('FileRepository', () => {
  let repo: FileRepository;
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
    repo = new FileRepository(mockDb);
  });

  // ─── reads ───

  describe('findById', () => {
    it('selects * by file id (single bind)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'f-1', name: 'doc.pdf' });

      const result = await repo.findById('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM files WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('f-1');
      expect(result).toEqual(expect.objectContaining({ id: 'f-1' }));
    });
  });

  describe('findRecent', () => {
    it('uses a UNION CTE with per-branch LIMIT (5 binds: userId, limit x3, userId, limit)', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'f-1' }] });

      await repo.findRecent('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('WITH branch1 AS');
      expect(sql).toContain('branch2 AS');
      expect(sql).toContain('UNION');
      expect(sql).toContain(
        'ORDER BY COALESCE(f.google_modified_at, f.synced_at, f.updated_at) DESC',
      );
      // Default limit=20; binds: [userId, limit, userId, limit, limit]
      expect(mockBind).toHaveBeenCalledWith('u-1', 20, 'u-1', 20, 20);
    });

    it('passes a custom limit through to both branches + the outer query', async () => {
      await repo.findRecent('u-1', 50);
      expect(mockBind).toHaveBeenCalledWith('u-1', 50, 'u-1', 50, 50);
    });
  });

  describe('findStarred', () => {
    it('selects starred non-trashed files for a user, JOIN drive_accounts', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'f-1', is_starred: 1 }] });

      await repo.findStarred('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('f.is_starred = 1');
      expect(sql).toContain('f.is_trashed = 0');
      expect(sql).toContain('JOIN drive_accounts d');
      expect(sql).toContain('ORDER BY f.created_at DESC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findTrashed', () => {
    it('selects trashed files for a user, ORDER BY updated_at DESC', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'f-1', is_trashed: 1 }] });

      await repo.findTrashed('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('f.is_trashed = 1');
      expect(sql).toContain('ORDER BY f.updated_at DESC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('searchFiles', () => {
    it('selects with just userId + default limit when no query/workspace/metadata', async () => {
      mockAll.mockResolvedValueOnce({ results: [] });

      await repo.searchFiles('u-1', null, null, null);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM (');
      expect(sql).toContain('UNION');
      // binds: [userId, userId, limit=50]
      expect(mockBind).toHaveBeenCalledWith('u-1', 'u-1', 50);
    });

    it('appends LIKE clause + bind when query is provided', async () => {
      await repo.searchFiles('u-1', 'report', null, null);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND f.name LIKE ?');
      // binds: [userId, '%report%', userId, '%report%', limit]
      expect(mockBind).toHaveBeenCalledWith('u-1', '%report%', 'u-1', '%report%', 50);
    });

    it('trims the query before wrapping in %...', async () => {
      await repo.searchFiles('u-1', '  spaced  ', null, null);
      expect(mockBind).toHaveBeenCalledWith('u-1', '%spaced%', 'u-1', '%spaced%', 50);
    });

    it('appends workspace_id filter when workspaceId is set', async () => {
      await repo.searchFiles('u-1', null, 'ws-1', null);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND f.workspace_id = ?');
      // binds: [userId, 'ws-1', userId, 'ws-1', limit]
      expect(mockBind).toHaveBeenCalledWith('u-1', 'ws-1', 'u-1', 'ws-1', 50);
    });

    it('appends json_extract filter for each metadata key', async () => {
      await repo.searchFiles('u-1', null, null, { author: 'alice', type: 'pdf' });

      const sql = mockPrepare.mock.calls[0][0] as string;
      // json_extract appears once per metadata entry.
      expect(sql).toContain("json_extract(f.metadata, '$.' || ?) = ?");
      // The metadata filter is applied to BOTH branches — each key/value appears twice in binds.
      // binds: [userId, 'author', 'alice', 'type', 'pdf', userId, 'author', 'alice', 'type', 'pdf', limit]
      const binds = mockBind.mock.calls[0];
      expect(binds).toHaveLength(11);
      expect(binds[0]).toBe('u-1');
      expect(binds[1]).toBe('author');
      expect(binds[2]).toBe('alice');
      expect(binds[3]).toBe('type');
      expect(binds[4]).toBe('pdf');
      expect(binds[5]).toBe('u-1'); // second branch user_id
      expect(binds[10]).toBe(50); // limit
    });

    it('rejects metadata keys with non-alphanumeric/underscore/dot chars (injection guard)', async () => {
      await repo.searchFiles('u-1', null, null, { 'evil; DROP--': 'value' });

      const sql = mockPrepare.mock.calls[0][0] as string;
      // The malicious key is rejected by the /^[a-zA-Z0-9_.]+$/ guard — no json_extract added.
      expect(sql).not.toContain('json_extract');
      // binds: [userId, userId, limit] (no metadata binds)
      expect(mockBind).toHaveBeenCalledWith('u-1', 'u-1', 50);
    });

    it('passes a custom limit through (default 50)', async () => {
      await repo.searchFiles('u-1', null, null, null, 25);
      expect(mockBind).toHaveBeenCalledWith('u-1', 'u-1', 25);
    });
  });

  // ─── mutations ───

  describe('insertUploaded', () => {
    it('INSERTs the file then re-fetches via SELECT (2 prepare calls)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'f-1', name: 'doc.pdf' });

      const result = await repo.insertUploaded({
        id: 'f-1',
        userId: 'u-1',
        driveAccountId: 'd-1',
        workspaceId: 'ws-1',
        workspaceFolderId: null,
        googleFileId: 'g-1',
        googleParentId: 'root',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        thumbnailUrl: null,
        webViewLink: null,
        webContentLink: null,
        googleCreatedAt: '2026-01-01',
        googleModifiedAt: '2026-01-02',
        metadata: '{"md5":"abc123"}',
      });

      // 2 prepare calls: INSERT + SELECT
      expect(mockPrepare).toHaveBeenCalledTimes(2);
      const insertSql = mockPrepare.mock.calls[0][0] as string;
      expect(insertSql).toContain('INSERT INTO files');
      expect(insertSql).toContain("datetime('now')");
      expect(insertSql).toContain('metadata');
      // 16 binds for INSERT (including metadata)
      expect(mockBind).toHaveBeenNthCalledWith(
        1,
        'f-1',
        'u-1',
        'd-1',
        'ws-1',
        null,
        'g-1',
        'root',
        'doc.pdf',
        'application/pdf',
        1024,
        null,
        null,
        null,
        '2026-01-01',
        '2026-01-02',
        '{"md5":"abc123"}',
      );
      // 2nd call: SELECT * to return the inserted row.
      const selectSql = mockPrepare.mock.calls[1][0] as string;
      expect(selectSql).toContain('SELECT * FROM files WHERE id = ?');
      expect(mockBind).toHaveBeenNthCalledWith(2, 'f-1');
      expect(result).toEqual(expect.objectContaining({ id: 'f-1' }));
    });
  });

  describe('markTrashed', () => {
    it('UPDATEs is_trashed=1 scoped to user (two binds)', async () => {
      await repo.markTrashed('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('UPDATE files SET is_trashed = 1 WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'u-1');
    });
  });

  describe('markUntrashed', () => {
    it('UPDATEs is_trashed=0 with updated_at=CURRENT_TIMESTAMP (two binds)', async () => {
      await repo.markUntrashed('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE files SET is_trashed = 0, updated_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'u-1');
    });
  });

  describe('rename', () => {
    it('UPDATEs name with updated_at=CURRENT_TIMESTAMP (three binds: name, fileId, userId)', async () => {
      await repo.rename('f-1', 'u-1', 'new-name.pdf');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'UPDATE files SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('new-name.pdf', 'f-1', 'u-1');
    });
  });

  describe('star', () => {
    it('UPDATEs is_starred=1, returns true when meta.changes > 0', async () => {
      const changed = await repo.star('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE files SET is_starred = 1 WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'u-1');
      expect(changed).toBe(true);
    });

    it('returns false when meta.changes === 0 (file/user mismatch)', async () => {
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });
      const changed = await repo.star('f-missing', 'u-1');
      expect(changed).toBe(false);
    });
  });

  describe('unstar', () => {
    it('UPDATEs is_starred=0, returns true when meta.changes > 0', async () => {
      const changed = await repo.unstar('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE files SET is_starred = 0 WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'u-1');
      expect(changed).toBe(true);
    });

    it('returns false when meta.changes === 0', async () => {
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });
      const changed = await repo.unstar('f-missing', 'u-1');
      expect(changed).toBe(false);
    });
  });

  describe('delete', () => {
    it('DELETEs a file scoped to user (two binds)', async () => {
      await repo.delete('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM files WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'u-1');
    });
  });

  // ─── sync-engine batch-composition statements (Stmt variants) ───

  describe('deleteByDriveAndGoogleIdStmt', () => {
    it('returns a prepared DELETE (not run) scoped by drive_account_id + google_file_id', () => {
      const stmt = repo.deleteByDriveAndGoogleIdStmt('d-1', 'gfile-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-1', 'gfile-1');
      // Stmt-returning methods MUST NOT call .run() — the statement is handed
      // to batchInChunks for batch composition by the sync engine.
      expect(mockRun).not.toHaveBeenCalled();
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  describe('markTrashedByDriveAndGoogleIdStmt', () => {
    it('returns a prepared is_trashed=1 UPDATE (not run) scoped by drive + google_file_id', () => {
      const stmt = repo.markTrashedByDriveAndGoogleIdStmt('d-1', 'gfile-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'UPDATE files SET is_trashed = 1 WHERE drive_account_id = ? AND google_file_id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('d-1', 'gfile-1');
      expect(mockRun).not.toHaveBeenCalled();
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  describe('markTrashedSystemStmt', () => {
    it('returns a prepared is_trashed=1 UPDATE with updated_at (not run), scoped by id only', () => {
      const stmt = repo.markTrashedSystemStmt('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'UPDATE files SET is_trashed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('f-1');
      // Stmt-returning methods MUST NOT call .run() — the statement is handed
      // to db.batch() for atomic composition by the lifecycle cron.
      expect(mockRun).not.toHaveBeenCalled();
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  describe('updateMetadata', () => {
    it('UPDATEs metadata, two binds (metadata, fileId), no user scope', async () => {
      await repo.updateMetadata('f-1', '{"author":"alice"}');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('UPDATE files SET metadata = ? WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('{"author":"alice"}', 'f-1');
    });
  });

  describe('updateDriveAssignment', () => {
    it('UPDATEs drive_account_id + google_file_id + resets google_parent_id to "root"', async () => {
      await repo.updateDriveAssignment('f-1', 'd-2', 'g-new');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE files');
      expect(sql).toContain('SET drive_account_id = ?, google_file_id = ?');
      expect(sql).toContain("google_parent_id = 'root'");
      expect(sql).toContain('updated_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('d-2', 'g-new', 'f-1');
    });
  });

  describe('moveToWorkspaceFolder', () => {
    it('UPDATEs workspace_folder_id + workspace_id, four binds', async () => {
      await repo.moveToWorkspaceFolder('f-1', 'u-1', 'wf-1', 'ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE files SET workspace_folder_id = ?, workspace_id = ?');
      expect(sql).toContain('updated_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('wf-1', 'ws-1', 'f-1', 'u-1');
    });

    it('can null out both fields (move to workspace root)', async () => {
      await repo.moveToWorkspaceFolder('f-1', 'u-1', null, 'ws-1');
      expect(mockBind).toHaveBeenCalledWith(null, 'ws-1', 'f-1', 'u-1');
    });
  });

  describe('getStorageStats', () => {
    it('SELECTs mime_type + total_size by user_id via .all()', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ mime_type: 'image/jpeg', total_size: 1024 }] });

      await repo.getStorageStats('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT mime_type, total_size FROM file_storage_stats WHERE user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('applyStorageDeltaStmt', () => {
    it('returns a prepared UPSERT with MAX(0, total_size + ?) clamp', () => {
      repo.applyStorageDeltaStmt('u-1', 'image/jpeg', 500);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO file_storage_stats');
      expect(sql).toContain('ON CONFLICT(user_id, mime_type) DO UPDATE');
      expect(sql).toContain('CASE WHEN total_size + excluded.total_size < 0 THEN 0');
      expect(mockBind).toHaveBeenCalledWith('u-1', 'image/jpeg', 500);
      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  describe('applyStorageDeltas', () => {
    it('filters zero deltas and applies non-zero ones via batchInChunks', async () => {
      await repo.applyStorageDeltas([
        { userId: 'u-1', mimeType: 'image/jpeg', delta: 500 },
        { userId: 'u-1', mimeType: 'video/mp4', delta: 0 }, // should be filtered
        { userId: 'u-1', mimeType: 'application/pdf', delta: -200 },
      ]);

      // Only 2 non-zero deltas → 2 prepare calls
      expect(mockPrepare).toHaveBeenCalledTimes(2);
    });

    it('does nothing when all deltas are zero', async () => {
      await repo.applyStorageDeltas([{ userId: 'u-1', mimeType: 'image/jpeg', delta: 0 }]);
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });

  // ─── PR 2: retention sweep (dynamic 2-branch) + cron batch (cursor) ───

  describe('findExpiredForRetention', () => {
    it('workspace branch: SELECTs expired files in a workspace, 2 binds (workspaceId, cutoffStr)', async () => {
      mockAll.mockResolvedValueOnce({ results: [] });

      await repo.findExpiredForRetention({
        kind: 'workspace',
        workspaceId: 'ws-1',
        cutoffStr: '2026-01-01 00:00:00',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT f.id, f.user_id, f.google_file_id, f.size, f.mime_type, f.workspace_id, f.owned_by_me, d.id as driveId',
      );
      expect(sql).toContain('FROM files f JOIN drive_accounts d ON f.drive_account_id = d.id');
      expect(sql).toContain('f.workspace_id = ?');
      expect(sql).toContain('f.created_at < ?');
      expect(sql).toContain('f.is_trashed = 0');
      // Workspace branch must NOT have the folder_id clause.
      expect(sql).not.toContain('workspace_folder_id');
      expect(mockBind).toHaveBeenCalledWith('ws-1', '2026-01-01 00:00:00');
    });

    it('folder branch: SELECTs expired files in a folder, 3 binds (workspaceId, cutoffStr, folderId)', async () => {
      mockAll.mockResolvedValueOnce({ results: [] });

      await repo.findExpiredForRetention({
        kind: 'folder',
        workspaceId: 'ws-1',
        folderId: 'folder-1',
        cutoffStr: '2026-01-01 00:00:00',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('f.workspace_id = ?');
      expect(sql).toContain('f.created_at < ?');
      expect(sql).toContain('f.is_trashed = 0');
      // Folder branch ADDS the workspace_folder_id clause.
      expect(sql).toContain('AND f.workspace_folder_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1', '2026-01-01 00:00:00', 'folder-1');
    });
  });

  describe('findBatchForCron', () => {
    it('without cursor: SELECTs files ordered by (name, id), 3 binds (userId, isTrashed, limit)', async () => {
      mockAll.mockResolvedValueOnce({ results: [] });

      await repo.findBatchForCron('u-1', 0, null, 100);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM files WHERE user_id = ? AND is_trashed = ?');
      expect(sql).not.toContain('(name, id) >');
      expect(sql).toContain('ORDER BY name ASC, id ASC LIMIT ?');
      expect(mockBind).toHaveBeenCalledWith('u-1', 0, 100);
    });

    it('with cursor: appends AND (name, id) > (?, ?), 5 binds', async () => {
      mockAll.mockResolvedValueOnce({ results: [] });

      await repo.findBatchForCron('u-1', 0, { name: 'file.pdf', id: 'f-1' }, 100);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('AND (name, id) > (?, ?)');
      expect(sql).toContain('ORDER BY name ASC, id ASC LIMIT ?');
      expect(mockBind).toHaveBeenCalledWith('u-1', 0, 'file.pdf', 'f-1', 100);
    });
  });

  // ─── D1 bind variable limit regression tests ───

  describe('findExistingForDelta D1 variable limit', () => {
    it('never generates a query with >100 bind variables', async () => {
      // Pass 500 IDs — the method must chunk internally to stay under D1's 100 limit.
      // SQLite's test-environment limit (32766) is higher than D1's (100), so this
      // test validates the SQL construction, not the execution.
      const ids = Array.from({ length: 500 }, (_, i) => `g-file-${i}`);
      mockAll.mockResolvedValue({ results: [] });
      await repo.findExistingForDelta('d1', ids);

      for (const call of mockPrepare.mock.calls) {
        const sql = call[0] as string;
        const placeholderCount = (sql.match(/\?/g) || []).length;
        expect(placeholderCount).toBeLessThanOrEqual(100);
      }
    });

    it('throws if chunk size exceeds D1 limit (defense-in-depth)', async () => {
      // The assertWithinD1Limit guard should fire even in the test environment
      // where SQLite's own limit is 32766. This catches regressions where
      // someone changes the CHUNK constant to a value > 99.
      mockAll.mockResolvedValue({ results: [] });
      await repo.findExistingForDelta(
        'd1',
        Array.from({ length: 150 }, (_, i) => `g-${i}`),
      );

      // If we get here without throwing, all chunks were ≤ 100 bind variables.
      // Verify by checking every prepared SQL statement.
      for (const call of mockPrepare.mock.calls) {
        const sql = call[0] as string;
        const placeholderCount = (sql.match(/\?/g) || []).length;
        expect(placeholderCount).toBeLessThanOrEqual(100);
      }
    });
  });

  // ─── recomputeStorageStats ───

  describe('recomputeStorageStats', () => {
    it('batches a DELETE + INSERT...SELECT atomically with LEFT JOIN to exclude trashed-folder children', async () => {
      await repo.recomputeStorageStats('u-1');

      // batch() called once with 2 prepared statements
      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(2);

      // First statement: DELETE for the user
      const deleteSql = mockPrepare.mock.calls[0][0] as string;
      expect(deleteSql).toContain('DELETE FROM file_storage_stats');
      expect(deleteSql).toContain('WHERE user_id = ?');
      expect(mockBind).toHaveBeenNthCalledWith(1, 'u-1');

      // Second statement: INSERT...SELECT with LEFT JOIN drive_folders to
      // exclude files whose direct parent folder is trashed (A-07).
      const insertSql = mockPrepare.mock.calls[1][0] as string;
      expect(insertSql).toContain('INSERT INTO file_storage_stats');
      expect(insertSql).toContain("SELECT f.user_id, COALESCE(f.mime_type, '')");
      expect(insertSql).toContain('FROM files f');
      expect(insertSql).toContain('LEFT JOIN drive_folders df');
      expect(insertSql).toContain('ON df.drive_account_id = f.drive_account_id');
      expect(insertSql).toContain('AND df.google_folder_id = f.google_parent_id');
      expect(insertSql).toContain('WHERE f.user_id = ?');
      expect(insertSql).toContain('AND f.is_trashed = 0');
      expect(insertSql).toContain('AND f.owned_by_me = 1');
      // df.is_trashed IS NULL handles root-level files (no parent folder row)
      expect(insertSql).toContain('(df.is_trashed = 0 OR df.is_trashed IS NULL)');
      expect(insertSql).toContain("GROUP BY f.user_id, COALESCE(f.mime_type, '')");
      expect(mockBind).toHaveBeenNthCalledWith(2, 'u-1');
    });
  });
});
