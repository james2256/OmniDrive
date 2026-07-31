import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3CredentialsRepository } from '../src/repositories/s3-credentials.repository';

/**
 * Direct unit tests for S3CredentialsRepository (small file — 3 methods).
 * Verifies SQL fragments + bind values. Complementary to
 * integration/repositories.test.ts (which covers insert → list → delete +
 * cross-user isolation + workspace scope through a real D1).
 */

describe('S3CredentialsRepository', () => {
  let repo: S3CredentialsRepository;
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
    repo = new S3CredentialsRepository(mockDb);
  });

  describe('insert', () => {
    it('INSERTs a credential with all 6 fields in order', async () => {
      await repo.insert({
        id: 'k-1',
        userId: 'u-1',
        accessKeyId: 'OMNI123',
        secretKeyEnc: 'enc-blob',
        description: 'rclone key',
        workspaceId: null,
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO s3_credentials');
      expect(sql).toContain(
        '(id, user_id, access_key_id, secret_key_enc, description, workspace_id)',
      );
      expect(mockBind).toHaveBeenCalledWith(
        'k-1',
        'u-1',
        'OMNI123',
        'enc-blob',
        'rclone key',
        null,
      );
    });

    it('passes null description + null workspaceId through unchanged', async () => {
      await repo.insert({
        id: 'k-2',
        userId: 'u-1',
        accessKeyId: 'OMNI456',
        secretKeyEnc: 'enc2',
        description: null,
        workspaceId: null,
      });
      expect(mockBind).toHaveBeenCalledWith('k-2', 'u-1', 'OMNI456', 'enc2', null, null);
    });

    it('passes workspaceId through when scoping to a workspace', async () => {
      await repo.insert({
        id: 'k-3',
        userId: 'u-1',
        accessKeyId: 'OMNI789',
        secretKeyEnc: 'enc3',
        description: 'scoped',
        workspaceId: 'ws-1',
      });
      expect(mockBind).toHaveBeenCalledWith('k-3', 'u-1', 'OMNI789', 'enc3', 'scoped', 'ws-1');
    });
  });

  describe('findAllByUser', () => {
    it('LEFT JOINs workspaces for workspace_name, single bind', async () => {
      mockAll.mockResolvedValueOnce({
        results: [
          {
            id: 'k-1',
            access_key_id: 'OMNI123',
            description: 'rclone key',
            workspace_id: null,
            workspace_name: null,
          },
        ],
      });

      const { results } = await repo.findAllByUser('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT c.id, c.access_key_id, c.description, c.created_at, c.workspace_id',
      );
      expect(sql).toContain('w.name as workspace_name');
      expect(sql).toContain(
        'FROM s3_credentials c LEFT JOIN workspaces w ON c.workspace_id = w.id',
      );
      expect(sql).toContain('WHERE c.user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('u-1');
      expect(results).toHaveLength(1);
    });

    it('uses LEFT JOIN so unscoped credentials (workspace_id=NULL) still appear', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'k-1', workspace_id: null }] });
      const { results } = await repo.findAllByUser('u-1');
      expect(results).toHaveLength(1);
      // Verify LEFT JOIN syntax in the SQL.
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('LEFT JOIN');
    });
  });

  describe('delete', () => {
    it('DELETEs a credential scoped to id AND user_id (two binds)', async () => {
      await repo.delete('k-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM s3_credentials WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('k-1', 'u-1');
    });

    it('uses both id + userId in WHERE — wrong user cannot delete another user key', async () => {
      // Cross-user isolation: the WHERE clause requires BOTH id and user_id,
      // so passing another user's userId deletes nothing (matched 0 rows).
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

      await repo.delete('k-1', 'wrong-user');

      expect(mockBind).toHaveBeenCalledWith('k-1', 'wrong-user');
    });
  });

  // ─── PR 3: S3 auth gateway credential lookup ───

  describe('findByAccessKeyId', () => {
    it('SELECTs * by access_key_id (no user scope), via .first()', async () => {
      mockFirst.mockResolvedValueOnce({
        id: 'k-1',
        access_key_id: 'OMNI123',
        secret_key_enc: 'enc',
      });

      const result = await repo.findByAccessKeyId('OMNI123');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT * FROM s3_credentials WHERE access_key_id = ?');
      expect(mockBind).toHaveBeenCalledWith('OMNI123');
      expect(result).toEqual({ id: 'k-1', access_key_id: 'OMNI123', secret_key_enc: 'enc' });
    });
  });
});
