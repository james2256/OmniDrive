import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceRepository } from '../src/repositories/workspace.repository';

/**
 * Direct unit tests for WorkspaceRepository. Verifies SQL fragments and bind
 * values. Complementary to integration/repositories.test.ts (which covers
 * the delete cascade through a real D1).
 *
 * NOTE: the task spec referenced `findById`, `findAllByUser`, `create`,
 * `update`, `findMemberRole`, `updateMemberRole` — those exact names don't
 * exist. The actual exports are `findByIdAndMember`, `findByIdAndOwner`,
 * `findWorkspacesByUser`, `createWorkspace`, `rename`, `addMember`,
 * `removeMember`, `countOwners`. Tests cover the actual exports + the
 * cascade delete per the spec.
 */

describe('WorkspaceRepository', () => {
  let repo: WorkspaceRepository;
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
    repo = new WorkspaceRepository(mockDb);
  });

  // ─── reads ───

  describe('findWorkspacesByUser', () => {
    it('JOINs workspace_members, selects 4 fields, ordered by name ASC', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'ws-1', name: 'WS' }] });

      const { results } = await repo.findWorkspacesByUser('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT w.id, w.name, w.created_at, w.updated_at');
      expect(sql).toContain('FROM workspaces w');
      expect(sql).toContain('JOIN workspace_members wm ON w.id = wm.workspace_id');
      expect(sql).toContain('WHERE wm.user_id = ?');
      expect(sql).toContain('ORDER BY w.name ASC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
      expect(results).toHaveLength(1);
    });
  });

  describe('findByIdAndMember', () => {
    it('selects * scoped to membership (two binds: workspaceId, userId)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'ws-1', name: 'WS' });

      const result = await repo.findByIdAndMember('ws-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT w.* FROM workspaces w');
      expect(sql).toContain('JOIN workspace_members wm ON w.id = wm.workspace_id');
      expect(sql).toContain('WHERE w.id = ? AND wm.user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1', 'u-1');
      expect(result).toEqual(expect.objectContaining({ id: 'ws-1' }));
    });
  });

  describe('findByIdAndOwner', () => {
    it('selects id by id + owner_id (ownership check, two binds)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'ws-1' });

      await repo.findByIdAndOwner('ws-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT id FROM workspaces WHERE id = ? AND owner_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1', 'u-1');
    });
  });

  describe('findSyncTtl', () => {
    it('selects sync_ttl_minutes by id', async () => {
      mockFirst.mockResolvedValueOnce({ sync_ttl_minutes: 30 });

      await repo.findSyncTtl('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT sync_ttl_minutes FROM workspaces WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('exists', () => {
    it('selects id by id only (no membership / ownership check)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'ws-1' });

      await repo.exists('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT id FROM workspaces WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
    });
  });

  // ─── mutations ───

  describe('createWorkspace', () => {
    it('runs a 2-statement batch: INSERT workspace + INSERT owner member', async () => {
      const workspaceId = await repo.createWorkspace('My WS', 'u-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(2);

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      expect(sqls[0]).toContain('INSERT INTO workspaces (id, name, owner_id)');
      expect(sqls[1]).toContain('INSERT INTO workspace_members (id, workspace_id, user_id, role)');

      // 1st bind: workspaceId, name, userId.
      expect(mockBind).toHaveBeenNthCalledWith(1, expect.any(String), 'My WS', 'u-1');
      // 2nd bind: memberId (generated), workspaceId, userId, 'owner'.
      expect(mockBind).toHaveBeenNthCalledWith(2, expect.any(String), workspaceId, 'u-1', 'owner');

      // Returned ID is the generated workspace ID.
      expect(workspaceId).toEqual(expect.any(String));
    });
  });

  describe('rename', () => {
    it('UPDATEs name + updated_at=CURRENT_TIMESTAMP (two binds)', async () => {
      await repo.rename('ws-1', 'New Name');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'UPDATE workspaces SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('New Name', 'ws-1');
    });
  });

  describe('delete (cascade)', () => {
    it('runs a 10-statement batch for manual cascade delete', async () => {
      await repo.delete('ws-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(10);
    });

    it('deletes the workspace row LAST (after all dependents)', async () => {
      await repo.delete('ws-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      const last = sqls[sqls.length - 1];
      expect(last).toBe('DELETE FROM workspaces WHERE id = ?');
    });

    it('binds workspaceId once per statement (10 binds total)', async () => {
      await repo.delete('ws-1');

      expect(mockBind).toHaveBeenCalledTimes(10);
      for (let i = 1; i <= 10; i++) {
        expect(mockBind).toHaveBeenNthCalledWith(i, 'ws-1');
      }
    });

    it('NULLs out files.workspace_id + workspace_folder_id (files survive)', async () => {
      await repo.delete('ws-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string).join('\n');
      expect(sqls).toContain(
        'UPDATE files SET workspace_id = NULL, workspace_folder_id = NULL WHERE workspace_id = ?',
      );
    });

    it('NULLs out audit_logs.workspace_id (ON DELETE SET NULL intent)', async () => {
      await repo.delete('ws-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string).join('\n');
      expect(sqls).toContain('UPDATE audit_logs SET workspace_id = NULL WHERE workspace_id = ?');
    });

    it('cascade-deletes all dependent tables in the correct order', async () => {
      await repo.delete('ws-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string).join('\n');
      expect(sqls).toContain(
        'DELETE FROM s3_multipart_parts WHERE upload_id IN (SELECT upload_id FROM s3_multipart_uploads WHERE workspace_id = ?)',
      );
      expect(sqls).toContain('DELETE FROM s3_multipart_uploads WHERE workspace_id = ?');
      expect(sqls).toContain('DELETE FROM s3_lifecycle_rules WHERE workspace_id = ?');
      expect(sqls).toContain('DELETE FROM workspace_policies WHERE workspace_id = ?');
      expect(sqls).toContain('DELETE FROM workspace_folders WHERE workspace_id = ?');
      expect(sqls).toContain('DELETE FROM s3_credentials WHERE workspace_id = ?');
      expect(sqls).toContain('DELETE FROM workspace_members WHERE workspace_id = ?');
    });
  });

  // ─── member management ───

  describe('findUserByEmail', () => {
    it('selects id by email (single bind)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'u-1' });

      const result = await repo.findUserByEmail('a@b.com');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT id FROM users WHERE email = ?');
      expect(mockBind).toHaveBeenCalledWith('a@b.com');
      expect(result).toEqual({ id: 'u-1' });
    });

    it('returns null when the email is not registered', async () => {
      mockFirst.mockResolvedValueOnce(null);
      const result = await repo.findUserByEmail('nobody@example.com');
      expect(result).toBeNull();
    });
  });

  describe('addMember', () => {
    it('INSERTs a workspace_members row with a generated memberId', async () => {
      await repo.addMember('ws-1', 'u-2', 'viewer');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO workspace_members (id, workspace_id, user_id, role)');
      // memberId is generated — verify the bind shape, not the literal value.
      expect(mockBind).toHaveBeenCalledWith(expect.any(String), 'ws-1', 'u-2', 'viewer');
    });

    it('accepts arbitrary role strings (owner, manager, viewer, etc.)', async () => {
      await repo.addMember('ws-1', 'u-2', 'manager');
      expect(mockBind).toHaveBeenNthCalledWith(1, expect.any(String), 'ws-1', 'u-2', 'manager');
    });
  });

  describe('countOwners', () => {
    it('counts members with role=owner (two binds: workspaceId, "owner")', async () => {
      mockFirst.mockResolvedValueOnce({ count: 2 });

      const result = await repo.countOwners('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM workspace_members');
      expect(sql).toContain('WHERE workspace_id = ? AND role = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1', 'owner');
      expect(result).toEqual({ count: 2 });
    });
  });

  describe('removeMember', () => {
    it('DELETEs a member scoped to workspaceId + userId (two binds)', async () => {
      await repo.removeMember('ws-1', 'u-2');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1', 'u-2');
    });
  });

  // ─── audit logs + policies ───

  describe('findAuditLogs', () => {
    it('JOINs users for actor_email, limits to 100', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'log-1', actor_email: 'a@b.com', action_type: 'ws.create' }],
      });

      const { results } = await repo.findAuditLogs('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT a.*, u.email as actor_email FROM audit_logs a');
      expect(sql).toContain('JOIN users u ON a.actor_id = u.id');
      expect(sql).toContain('WHERE workspace_id = ?');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT 100');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
      expect(results).toHaveLength(1);
    });
  });

  describe('findPolicies', () => {
    it('selects all policies for a workspace (single bind)', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'p-1', policy_type: 'data_retention' }] });

      const { results } = await repo.findPolicies('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM workspace_policies WHERE workspace_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
      expect(results).toHaveLength(1);
    });
  });

  describe('createPolicy', () => {
    it('INSERTs a policy then re-fetches via SELECT (2 prepare calls)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'p-1', policy_type: 'data_retention' });

      const result = await repo.createPolicy({
        workspaceId: 'ws-1',
        targetType: 'workspace',
        targetId: null,
        policyType: 'data_retention',
        config: '{"action":"auto_delete","days":7}',
      });

      // 2 prepare calls: INSERT + SELECT.
      expect(mockPrepare).toHaveBeenCalledTimes(2);
      const insertSql = mockPrepare.mock.calls[0][0] as string;
      expect(insertSql).toContain(
        'INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config)',
      );
      expect(mockBind).toHaveBeenNthCalledWith(
        1,
        expect.any(String), // generated policyId
        'ws-1',
        'workspace',
        null,
        'data_retention',
        '{"action":"auto_delete","days":7}',
      );
      const selectSql = mockPrepare.mock.calls[1][0] as string;
      expect(selectSql).toContain('SELECT * FROM workspace_policies WHERE id = ?');
      expect(mockBind).toHaveBeenNthCalledWith(2, expect.any(String)); // generated policyId
      expect(result).toEqual(expect.objectContaining({ id: 'p-1' }));
    });
  });

  describe('deletePolicy', () => {
    it('DELETEs a policy scoped to id + workspace_id (two binds)', async () => {
      await repo.deletePolicy('p-1', 'ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM workspace_policies WHERE id = ? AND workspace_id = ?');
      expect(mockBind).toHaveBeenCalledWith('p-1', 'ws-1');
    });
  });

  // ─── PR 2: workspace-list, member-batch-Stmts, policy reads ───

  describe('findWorkspacesWithRole', () => {
    it('SELECTs w.* + wm.role ordered by created_at DESC (distinct from findWorkspacesByUser)', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'ws-1', role: 'owner' }] });

      await repo.findWorkspacesWithRole('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT w.*, wm.role');
      expect(sql).toContain('JOIN workspace_members wm ON w.id = wm.workspace_id');
      expect(sql).toContain('WHERE wm.user_id = ?');
      expect(sql).toContain('ORDER BY w.created_at DESC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  describe('addMemberStmt', () => {
    it('returns a prepared INSERT (not run) for batch composition, 4 binds', () => {
      const stmt = repo.addMemberStmt('m-1', 'ws-1', 'u-1', 'editor');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
      );
      expect(mockBind).toHaveBeenCalledWith('m-1', 'ws-1', 'u-1', 'editor');
      // Stmt-returning methods MUST NOT call .run() — batch owns execution.
      expect(mockRun).not.toHaveBeenCalled();
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  describe('removeMemberStmt', () => {
    it('returns a prepared DELETE (not run) for batch composition, 2 binds', () => {
      const stmt = repo.removeMemberStmt('ws-1', 'u-2');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1', 'u-2');
      expect(mockRun).not.toHaveBeenCalled();
      expect(stmt).toEqual({ all: mockAll, first: mockFirst, run: mockRun });
    });
  });

  describe('findUsedBytes', () => {
    it('SELECTs used_bytes by workspace id via .first(), single bind', async () => {
      mockFirst.mockResolvedValueOnce({ used_bytes: 5000 });

      const result = await repo.findUsedBytes('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT used_bytes FROM workspaces WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
      expect(result).toEqual({ used_bytes: 5000 });
    });
  });

  describe('findStorageQuotaPolicy', () => {
    it('SELECTs config for storage_quota policy via .first(), single bind', async () => {
      mockFirst.mockResolvedValueOnce({ config: '{"max_bytes":1000}' });

      const result = await repo.findStorageQuotaPolicy('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT config FROM workspace_policies');
      expect(sql).toContain("policy_type = 'storage_quota'");
      expect(sql).toContain('WHERE workspace_id = ?');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
      expect(result).toEqual({ config: '{"max_bytes":1000}' });
    });
  });

  describe('findRetentionPolicyForFolder', () => {
    it('SELECTs retention policy via folder JOIN, binds folderId twice (anchor + target_id)', async () => {
      mockFirst.mockResolvedValueOnce({ config: '{"action":"prevent_deletion"}' });

      const result = await repo.findRetentionPolicyForFolder('folder-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('FROM workspace_policies p');
      expect(sql).toContain('JOIN workspace_folders f ON f.workspace_id = p.workspace_id');
      expect(sql).toContain("policy_type = 'data_retention'");
      expect(sql).toContain(
        "(p.target_type = 'workspace' OR (p.target_type = 'folder' AND p.target_id = ?))",
      );
      expect(mockBind).toHaveBeenCalledWith('folder-1', 'folder-1');
      expect(result).toEqual({ config: '{"action":"prevent_deletion"}' });
    });
  });

  describe('findAllAutoDeleteRetentionPolicies', () => {
    it('SELECTs all auto_delete policies via json_extract on config, no binds, .all()', async () => {
      mockAll.mockResolvedValueOnce({
        results: [
          {
            id: 'p-1',
            workspace_id: 'ws-1',
            target_type: 'workspace',
            target_id: null,
            config: '{}',
          },
        ],
      });

      const { results } = await repo.findAllAutoDeleteRetentionPolicies();

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM workspace_policies');
      expect(sql).toContain("policy_type = 'data_retention'");
      expect(sql).toContain("json_extract(config, '$.action') = 'auto_delete'");
      expect(mockBind).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });
});
