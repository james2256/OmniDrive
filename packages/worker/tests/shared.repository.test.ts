import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharedRepository } from '../src/repositories/shared.repository';

/**
 * Direct unit tests for SharedRepository. Verifies SQL fragments and bind
 * values. Complementary to integration/repositories.test.ts (which covers
 * the delete cascade through a real D1).
 *
 * NOTE: the task spec referenced `create`, `findByTargetId`, `findAllByUser`,
 * and `addLog` — those exact names don't exist. The actual exports are
 * `insertWithUniqueSlug`, `findById`, `findByIdAndUser`,
 * `findAllByUserWithTargetName`, `incrementViewCount`, `incrementDownloadCount`,
 * `incrementDownloadCountWithLimit`, `update`, `delete`, `logAction`,
 * `findFolderName`. Tests cover the actual exports.
 */

describe('SharedRepository', () => {
  let repo: SharedRepository;
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
    repo = new SharedRepository(mockDb);
  });

  // ─── reads ───

  describe('findById', () => {
    it('selects * by id (no user filter — public route)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'sl-1', target_type: 'file' });

      const result = await repo.findById('sl-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT * FROM shared_links WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('sl-1');
      expect(result).toEqual(expect.objectContaining({ id: 'sl-1' }));
    });
  });

  describe('findByIdAndUser', () => {
    it('selects * by id + user (management endpoints)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'sl-1', user_id: 'u-1' });

      await repo.findByIdAndUser('sl-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM shared_links WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('sl-1', 'u-1');
    });
  });

  describe('findAllByUserWithTargetName', () => {
    it('JOINs files + workspace_folders + drive_folders with GROUP BY, single bind', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'sl-1', targetName: 'doc.pdf', targetMimeType: 'application/pdf' }],
      });

      await repo.findAllByUserWithTargetName('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT s.*, COALESCE(f.name, v.name, MIN(df.name)) as targetName');
      expect(sql).toContain('f.mime_type as targetMimeType');
      expect(sql).toContain("LEFT JOIN files f ON s.target_type = 'file' AND s.target_id = f.id");
      expect(sql).toContain("LEFT JOIN workspace_folders v ON s.target_type = 'folder'");
      expect(sql).toContain("LEFT JOIN drive_folders df ON s.target_type = 'folder'");
      expect(sql).toContain('WHERE s.user_id = ?');
      expect(sql).toContain('GROUP BY s.id');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findFolderName', () => {
    it('UNION ALLs workspace_folders + drive_folders, binds folderId twice', async () => {
      mockFirst.mockResolvedValueOnce({ name: 'My Folder' });

      const result = await repo.findFolderName('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT name FROM (');
      expect(sql).toContain('SELECT name FROM workspace_folders WHERE id = ?');
      expect(sql).toContain('SELECT name FROM drive_folders WHERE google_folder_id = ?');
      expect(sql).toContain('UNION ALL');
      expect(sql).toContain('LIMIT 1');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'f-1');
      expect(result).toBe('My Folder');
    });

    it('returns null when the folder does not exist in either table', async () => {
      mockFirst.mockResolvedValueOnce(null);
      const result = await repo.findFolderName('no-such-folder');
      expect(result).toBeNull();
    });
  });

  // ─── mutations ───

  describe('insertWithUniqueSlug', () => {
    it('INSERTs a shared link with all 11 fields in order, returns the id', async () => {
      const id = await repo.insertWithUniqueSlug({
        userId: 'u-1',
        targetType: 'file',
        targetId: 'f-1',
        passwordHash: null,
        expiresAt: null,
        allowDownloads: true,
        allowUploads: false,
        maxDownloads: null,
        requireEmail: false,
        webhookUrl: null,
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO shared_links');
      expect(sql).toContain(
        'id, user_id, target_type, target_id, password_hash, expires_at, allow_downloads, allow_uploads, max_downloads, require_email, webhook_url',
      );
      // 11 binds — booleans converted to 0/1.
      expect(mockBind).toHaveBeenCalledWith(
        expect.any(String),
        'u-1',
        'file',
        'f-1',
        null,
        null,
        1, // allowDownloads
        0, // allowUploads
        null, // maxDownloads
        0, // requireEmail
        null, // webhookUrl
      );
      // Returned id is the 16-char hex slug.
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('retries up to 3 attempts on UNIQUE constraint failure', async () => {
      // First two attempts throw UNIQUE constraint errors; third succeeds.
      mockRun
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed: shared_links.id'))
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed: shared_links.id'))
        .mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

      const id = await repo.insertWithUniqueSlug({
        userId: 'u-1',
        targetType: 'folder',
        targetId: 'f-1',
        passwordHash: null,
        expiresAt: null,
        allowDownloads: true,
        allowUploads: true,
        maxDownloads: null,
        requireEmail: false,
        webhookUrl: null,
      });

      // Three INSERT attempts (mockRun called 3 times — 2 reject + 1 success).
      expect(mockPrepare).toHaveBeenCalledTimes(3);
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('throws after 3 attempts if all collide', async () => {
      mockRun.mockRejectedValue(new Error('UNIQUE constraint failed: shared_links.id'));

      await expect(
        repo.insertWithUniqueSlug({
          userId: 'u-1',
          targetType: 'file',
          targetId: 'f-1',
          passwordHash: null,
          expiresAt: null,
          allowDownloads: true,
          allowUploads: false,
          maxDownloads: null,
          requireEmail: false,
          webhookUrl: null,
        }),
      ).rejects.toThrow('Could not generate unique shared link ID after 3 attempts');
      expect(mockPrepare).toHaveBeenCalledTimes(3);
    });

    it('re-throws non-collision errors immediately (FK violation, etc.)', async () => {
      mockRun.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'));

      await expect(
        repo.insertWithUniqueSlug({
          userId: 'u-1',
          targetType: 'file',
          targetId: 'f-missing',
          passwordHash: null,
          expiresAt: null,
          allowDownloads: true,
          allowUploads: false,
          maxDownloads: null,
          requireEmail: false,
          webhookUrl: null,
        }),
      ).rejects.toThrow('FOREIGN KEY constraint failed');
      // Single attempt — re-thrown on the first error.
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('UPDATEs 7 fields scoped to id + user, returns rows changed', async () => {
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

      const changes = await repo.update('sl-1', 'u-1', {
        expiresAt: '2026-12-31',
        allowDownloads: true,
        allowUploads: false,
        maxDownloads: 100,
        requireEmail: true,
        webhookUrl: 'https://example.com/webhook',
        passwordHash: '$2a$hash',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'UPDATE shared_links SET expires_at = ?, allow_downloads = ?, allow_uploads = ?, max_downloads = ?, require_email = ?, webhook_url = ?, password_hash = ?',
      );
      expect(sql).toContain('WHERE id = ? AND user_id = ?');
      // Binds: 7 fields (booleans → 0/1) + id + userId = 9 total.
      expect(mockBind).toHaveBeenCalledWith(
        '2026-12-31',
        1,
        0,
        100,
        1,
        'https://example.com/webhook',
        '$2a$hash',
        'sl-1',
        'u-1',
      );
      expect(changes).toBe(1);
    });

    it('returns 0 when no rows matched (wrong user / missing link)', async () => {
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

      const changes = await repo.update('sl-1', 'wrong-user', {
        expiresAt: null,
        allowDownloads: false,
        allowUploads: false,
        maxDownloads: null,
        requireEmail: false,
        webhookUrl: null,
        passwordHash: null,
      });

      expect(changes).toBe(0);
    });
  });

  describe('delete', () => {
    it('runs a 2-statement batch: logs first, then shared_links row', async () => {
      await repo.delete('sl-1', 'u-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(2);

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      expect(sqls[0]).toBe('DELETE FROM shared_link_logs WHERE shared_link_id = ?');
      expect(sqls[1]).toBe('DELETE FROM shared_links WHERE id = ? AND user_id = ?');

      expect(mockBind).toHaveBeenNthCalledWith(1, 'sl-1');
      expect(mockBind).toHaveBeenNthCalledWith(2, 'sl-1', 'u-1');
    });
  });

  // ─── counters ───

  describe('incrementViewCount', () => {
    it('UPDATEs view_count = view_count + 1 (single bind, no user scope)', async () => {
      await repo.incrementViewCount('sl-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('UPDATE shared_links SET view_count = view_count + 1 WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('sl-1');
    });
  });

  describe('incrementDownloadCount', () => {
    it('UPDATEs download_count = download_count + 1 (single bind, no limit)', async () => {
      await repo.incrementDownloadCount('sl-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('UPDATE shared_links SET download_count = download_count + 1 WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('sl-1');
    });
  });

  describe('incrementDownloadCountWithLimit', () => {
    it('atomically increments with RETURNING when under max_downloads', async () => {
      mockFirst.mockResolvedValueOnce({ download_count: 5 });

      const result = await repo.incrementDownloadCountWithLimit('sl-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE shared_links SET download_count = download_count + 1');
      expect(sql).toContain(
        'WHERE id = ? AND (max_downloads IS NULL OR download_count < max_downloads)',
      );
      expect(sql).toContain('RETURNING download_count');
      expect(mockBind).toHaveBeenCalledWith('sl-1');
      expect(result).toBe(5);
    });

    it('returns null when limit reached (no RETURNING row)', async () => {
      mockFirst.mockResolvedValueOnce(null);
      const result = await repo.incrementDownloadCountWithLimit('sl-1');
      expect(result).toBeNull();
    });
  });

  // ─── audit logs ───

  describe('logAction', () => {
    it('INSERTs a log row with shared_link_id + action + visitor_email', async () => {
      await repo.logAction('sl-1', 'view', 'visitor@example.com');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO shared_link_logs');
      expect(sql).toContain('(shared_link_id, action, visitor_email)');
      expect(mockBind).toHaveBeenCalledWith('sl-1', 'view', 'visitor@example.com');
    });

    it('binds null when visitorEmail is omitted (?? null coalescing)', async () => {
      await repo.logAction('sl-1', 'download');

      expect(mockBind).toHaveBeenCalledWith('sl-1', 'download', null);
    });
  });
});
