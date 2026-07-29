import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminRepository } from '../src/repositories/admin.repository';

/**
 * Direct unit tests for AdminRepository. Each method is exercised in isolation
 * against a mocked D1 (prepare/bind/all/first/run chain). Verifies SQL fragments
 * and bind values. Complementary to integration/repositories.test.ts (which
 * exercises the same repository through a real D1 / Miniflare).
 */

describe('AdminRepository', () => {
  let repo: AdminRepository;
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
    repo = new AdminRepository(mockDb);
  });

  // ─── users reads ───

  describe('findSuperAdminStatus', () => {
    it('queries is_super_admin for the given userId', async () => {
      mockFirst.mockResolvedValueOnce({ is_super_admin: 1 });

      const result = await repo.findSuperAdminStatus('u-123');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT is_super_admin FROM users WHERE id = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('u-123');
      expect(result).toEqual({ is_super_admin: 1 });
    });

    it('returns null when the user does not exist (D1 .first() default)', async () => {
      mockFirst.mockResolvedValueOnce(null);
      const result = await repo.findSuperAdminStatus('no-such-user');
      expect(result).toBeNull();
      expect(mockBind).toHaveBeenCalledWith('no-such-user');
    });
  });

  describe('findAllUsers', () => {
    it('selects limited fields with no bind and a LIMIT 100', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'u1', username: 'alice', is_super_admin: 1, is_blocked: 0 }],
      });

      const { results } = await repo.findAllUsers();

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT id, username, email, name, avatar_url, is_super_admin, is_blocked',
      );
      expect(sql).toContain('FROM users');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT 100');
      // no .bind(...) call — the unbound path is used
      expect(mockBind).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });

  describe('findByUsername', () => {
    it('selects id by username with a single bind', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'u1' });

      const result = await repo.findByUsername('alice');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE username = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('alice');
      expect(result).toEqual({ id: 'u1' });
    });
  });

  describe('findByEmail', () => {
    it('selects id by email with a single bind', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'u1' });

      const result = await repo.findByEmail('a@b.com');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE email = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('a@b.com');
      expect(result).toEqual({ id: 'u1' });
    });
  });

  describe('insertUser', () => {
    it('INSERTs a new user with all six fields bound in order', async () => {
      await repo.insertUser({
        id: 'u-new',
        username: 'carol',
        passwordHash: '$2a$...',
        email: 'c@d.com',
        name: 'Carol',
        isSuperAdmin: 0,
      });

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
      expect(mockBind).toHaveBeenCalledWith('u-new', 'carol', '$2a$...', 'c@d.com', 'Carol', 0);
    });
  });

  // ─── role / status / delete ───

  describe('promoteToAdmin', () => {
    it('UPDATEs is_super_admin=1 with a single userId bind', async () => {
      await repo.promoteToAdmin('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE users SET is_super_admin = 1');
      expect(sql).toContain("updated_at = datetime('now')");
      expect(sql).toContain('WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('demoteFromAdmin', () => {
    it('UPDATEs is_super_admin=0 with last-admin guard subquery', async () => {
      await repo.demoteFromAdmin('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE users SET is_super_admin = 0');
      expect(sql).toContain('WHERE id = ?');
      expect(sql).toContain('SELECT COUNT(*) FROM users WHERE is_super_admin = 1');
      expect(sql).toContain('> 1');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('blockUser', () => {
    it('runs a 2-statement batch: UPDATE is_blocked=1 + DELETE sessions', async () => {
      await repo.blockUser('u-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(2);

      // 2 prepare calls (one per statement), each with the expected SQL fragment.
      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      expect(sqls).toContainEqual(expect.stringContaining('UPDATE users SET is_blocked = 1'));
      expect(sqls).toContainEqual(
        expect.stringContaining('DELETE FROM sessions WHERE user_id = ?'),
      );

      // Each statement binds the same userId.
      expect(mockBind).toHaveBeenNthCalledWith(1, 'u-1');
      expect(mockBind).toHaveBeenNthCalledWith(2, 'u-1');
    });
  });

  describe('unblockUser', () => {
    it('UPDATEs is_blocked=0 with a single userId bind', async () => {
      await repo.unblockUser('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE users SET is_blocked = 0');
      expect(sql).toContain("updated_at = datetime('now')");
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('deleteUser', () => {
    it('runs a 24-statement batch for manual cascade delete', async () => {
      // 10 grandchild (subquery) + 4 intermediate + 9 direct child + 1 user = 24.
      await repo.deleteUser('u-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(24);
    });

    it('deletes the user row last (after all dependents)', async () => {
      await repo.deleteUser('u-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      const last = sqls[sqls.length - 1];
      expect(last).toBe('DELETE FROM users WHERE id = ?');
    });

    it('binds userId for every statement (no off-by-one or missing binds)', async () => {
      await repo.deleteUser('u-1');

      // All 24 statements bind exactly one value (the userId).
      expect(mockBind).toHaveBeenCalledTimes(24);
      for (let i = 1; i <= 24; i++) {
        expect(mockBind).toHaveBeenNthCalledWith(i, 'u-1');
      }
    });

    it('includes cascade deletes for the core dependent tables', async () => {
      await repo.deleteUser('u-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string).join('\n');
      expect(sqls).toContain('DELETE FROM s3_multipart_parts');
      expect(sqls).toContain('DELETE FROM s3_multipart_uploads WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM shared_links WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM automation_rules WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM drive_accounts WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM workspaces WHERE owner_id = ?');
      expect(sqls).toContain('DELETE FROM files WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM workspace_members WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM sessions WHERE user_id = ?');
      expect(sqls).toContain('DELETE FROM audit_logs WHERE actor_id = ?');
      expect(sqls).toContain('DELETE FROM invitation_codes WHERE created_by = ?');
      expect(sqls).toContain('DELETE FROM s3_credentials WHERE user_id = ?');
    });

    it('uses subquery-based deletes for grandchild tables', async () => {
      await repo.deleteUser('u-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string).join('\n');
      expect(sqls).toContain(
        'DELETE FROM s3_multipart_parts WHERE upload_id IN (SELECT upload_id FROM s3_multipart_uploads WHERE user_id = ?)',
      );
      expect(sqls).toContain(
        'DELETE FROM sync_state WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = ?)',
      );
      expect(sqls).toContain(
        'DELETE FROM drive_folders WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = ?)',
      );
      expect(sqls).toContain(
        'DELETE FROM workspace_policies WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?)',
      );
    });
  });

  // ─── invitations ───

  describe('findAllInvitations', () => {
    it('selects all invitation codes with no bind, ordered by created_at DESC', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'inv1', code: 'CODE123' }] });

      const { results } = await repo.findAllInvitations();

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM invitation_codes');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(mockBind).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });

  describe('insertInvitation', () => {
    it('INSERTs an invitation code with id, code, created_by, max_uses', async () => {
      await repo.insertInvitation({ id: 'inv1', code: 'CODE123', createdBy: 'u1', maxUses: 5 });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO invitation_codes'),
      );
      expect(mockBind).toHaveBeenCalledWith('inv1', 'CODE123', 'u1', 5);
    });
  });

  describe('deleteInvitation', () => {
    it('DELETEs an invitation by id', async () => {
      await repo.deleteInvitation('inv1');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM invitation_codes WHERE id = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('inv1');
    });
  });

  // ─── audit_logs ───

  describe('findRecentAuditLogs', () => {
    it('JOINs users + workspaces and limits to 100, no bind', async () => {
      mockAll.mockResolvedValueOnce({
        results: [
          {
            id: 'log1',
            actor_email: 'a@b.com',
            workspace_name: 'WS',
            action_type: 'file.delete',
          },
        ],
      });

      const { results } = await repo.findRecentAuditLogs();

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('FROM audit_logs a');
      expect(sql).toContain('JOIN users u ON a.actor_id = u.id');
      expect(sql).toContain('LEFT JOIN workspaces w ON a.workspace_id = w.id');
      expect(sql).toContain('ORDER BY a.created_at DESC');
      expect(sql).toContain('LIMIT 100');
      expect(mockBind).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });
});
