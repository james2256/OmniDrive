import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FolderRepository } from '../src/repositories/folder.repository';

/**
 * Direct unit tests for FolderRepository. Verifies SQL fragments and bind
 * values. Complementary to integration/repositories.test.ts (cascade delete
 * is also covered end-to-end there with a real D1).
 *
 * NOTE: the task spec referenced `getWorkspaceTree`, `getFolderContents`,
 * `create`, `update` — none of those exact names exist. The actual exports
 * are `findParentWorkspace`, `findMembership`, `findByIdWithWorkspace`,
 * `findRootFoldersByWorkspace`, `findSubfoldersByParent`, `findAllByUser`,
 * `star`, `unstar`, `delete`, `insert`, `updateFields`, `updateSyncStatus`,
 * `updateSyncComplete`. Tests cover the actual exports with focus on
 * `delete` (cascade), `star`, `unstar` per the spec.
 */

describe('FolderRepository', () => {
  let repo: FolderRepository;
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
    repo = new FolderRepository(mockDb);
  });

  // ─── reads ───

  describe('findParentWorkspace', () => {
    it('JOINs workspace_members to enforce membership (two binds: userId, parentId)', async () => {
      mockFirst.mockResolvedValueOnce({ workspace_id: 'ws-1' });

      const result = await repo.findParentWorkspace('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT f.workspace_id FROM workspace_folders f');
      expect(sql).toContain('JOIN workspace_members wm ON f.workspace_id = wm.workspace_id');
      expect(sql).toContain('AND wm.user_id = ?');
      expect(sql).toContain('WHERE f.id = ?');
      expect(mockBind).toHaveBeenCalledWith('u-1', 'f-1');
      expect(result).toEqual({ workspace_id: 'ws-1' });
    });
  });

  describe('findMembership', () => {
    it('returns id + workspace_id for the folder if user is a member', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'f-1', workspace_id: 'ws-1' });

      const result = await repo.findMembership('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT f.id, f.workspace_id FROM workspace_folders f');
      expect(mockBind).toHaveBeenCalledWith('u-1', 'f-1');
      expect(result).toEqual({ id: 'f-1', workspace_id: 'ws-1' });
    });
  });

  describe('searchFolders', () => {
    it('LIKE search with workspace_members JOIN + workspaces JOIN, default limit 20', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'f-1', name: 'Reports' }] });

      await repo.searchFolders('u-1', 'rep');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('FROM workspace_folders f');
      expect(sql).toContain('JOIN workspace_members wm ON f.workspace_id = wm.workspace_id');
      expect(sql).toContain('JOIN workspaces w ON f.workspace_id = w.id');
      expect(sql).toContain('WHERE f.name LIKE ?');
      expect(sql).toContain('ORDER BY f.updated_at DESC LIMIT ?');
      // binds: userId, '%query%', limit
      expect(mockBind).toHaveBeenCalledWith('u-1', '%rep%', 20);
    });

    it('accepts a custom limit (3rd positional arg)', async () => {
      await repo.searchFolders('u-1', 'rep', 50);
      expect(mockBind).toHaveBeenCalledWith('u-1', '%rep%', 50);
    });
  });

  describe('findByIdWithWorkspace', () => {
    it('returns folder row + ws_name, JOIN membership + workspaces (two binds)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'f-1', ws_name: 'WS' });

      const result = await repo.findByIdWithWorkspace('f-1', 'u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT f.*, w.name as ws_name');
      expect(sql).toContain('JOIN workspaces w ON f.workspace_id = w.id');
      expect(sql).toContain('JOIN workspace_members wm ON f.workspace_id = wm.workspace_id');
      expect(mockBind).toHaveBeenCalledWith('u-1', 'f-1');
      expect(result).toEqual(expect.objectContaining({ id: 'f-1' }));
    });
  });

  describe('findRootFoldersByWorkspace', () => {
    it('selects folders with parent_id IS NULL, single bind', async () => {
      await repo.findRootFoldersByWorkspace('ws-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT * FROM workspace_folders WHERE workspace_id = ? AND parent_id IS NULL',
      );
      expect(sql).toContain('ORDER BY name ASC');
      expect(mockBind).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('findSubfoldersByParent', () => {
    it('selects subfolders of a parent, single bind', async () => {
      await repo.findSubfoldersByParent('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT * FROM workspace_folders WHERE parent_id = ? ORDER BY name ASC',
      );
      expect(mockBind).toHaveBeenCalledWith('f-1');
    });
  });

  describe('findAllByUser', () => {
    it('selects all folders a user can access via membership JOIN', async () => {
      await repo.findAllByUser('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT f.* FROM workspace_folders f');
      expect(sql).toContain('JOIN workspace_members wm ON f.workspace_id = wm.workspace_id');
      expect(sql).toContain('WHERE wm.user_id = ?');
      expect(sql).toContain('ORDER BY f.name ASC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  // ─── mutations ───

  describe('star', () => {
    it('UPDATEs is_starred=1 with updated_at=CURRENT_TIMESTAMP (single bind)', async () => {
      await repo.star('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'UPDATE workspace_folders SET is_starred = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('f-1');
    });
  });

  describe('unstar', () => {
    it('UPDATEs is_starred=0 with updated_at=CURRENT_TIMESTAMP (single bind)', async () => {
      await repo.unstar('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'UPDATE workspace_folders SET is_starred = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('f-1');
    });
  });

  describe('insert', () => {
    it('INSERTs a folder with id, workspace_id, name, parent_id, icon, color', async () => {
      await repo.insert({
        id: 'f-1',
        workspaceId: 'ws-1',
        name: 'Folder',
        parentId: null,
        icon: '📁',
        color: '#fff',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO workspace_folders');
      expect(sql).toContain('(id, workspace_id, name, parent_id, icon, color)');
      expect(mockBind).toHaveBeenCalledWith('f-1', 'ws-1', 'Folder', null, '📁', '#fff');
    });
  });

  describe('updateFields', () => {
    it('UPDATEs only the provided fields + sets updated_at=CURRENT_TIMESTAMP', async () => {
      await repo.updateFields('f-1', { name: 'New Name' });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'UPDATE workspace_folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('New Name', 'f-1');
    });

    it('combines multiple fields in the SET clause', async () => {
      await repo.updateFields('f-1', { name: 'N', icon: '📂', color: '#000', parentId: 'p-1' });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('icon = ?');
      expect(sql).toContain('color = ?');
      expect(sql).toContain('parent_id = ?');
      expect(sql).toContain('updated_at = CURRENT_TIMESTAMP');
      // binds are in field order (name, icon, color, parentId), then folderId last
      expect(mockBind).toHaveBeenCalledWith('N', '📂', '#000', 'p-1', 'f-1');
    });

    it('skips the call entirely when no fields are provided (resolve immediately)', async () => {
      const result = await repo.updateFields('f-1', {});

      expect(mockPrepare).not.toHaveBeenCalled();
      // Returns void Promise.resolve().
      expect(result).toBeUndefined();
    });

    it('nulls parentId when null is explicitly passed', async () => {
      await repo.updateFields('f-1', { parentId: null });
      expect(mockBind).toHaveBeenCalledWith(null, 'f-1');
    });
  });

  describe('updateSyncStatus', () => {
    it('UPDATEs sync_status (two binds: status, folderId)', async () => {
      await repo.updateSyncStatus('f-1', 'syncing');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE workspace_folders SET sync_status = ? WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('syncing', 'f-1');
    });

    it('accepts "idle" and "error" status values', async () => {
      await repo.updateSyncStatus('f-1', 'idle');
      expect(mockBind).toHaveBeenNthCalledWith(1, 'idle', 'f-1');
      await repo.updateSyncStatus('f-1', 'error');
      expect(mockBind).toHaveBeenNthCalledWith(2, 'error', 'f-1');
    });
  });

  describe('updateSyncComplete', () => {
    it('UPDATEs sync_status=idle + last_synced_at=now', async () => {
      await repo.updateSyncComplete('f-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain("UPDATE workspace_folders SET sync_status = 'idle'");
      expect(sql).toContain("last_synced_at = datetime('now')");
      expect(mockBind).toHaveBeenCalledWith('f-1');
    });
  });

  // ─── cascade delete ───

  describe('delete (cascade)', () => {
    it('runs a 4-statement batch with recursive CTEs', async () => {
      await repo.delete('f-1');

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const stmts = mockBatch.mock.calls[0][0] as unknown[];
      expect(stmts).toHaveLength(4);
    });

    it('uses a recursive CTE in all 3 cascade statements', async () => {
      await repo.delete('f-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      expect(sqls).toHaveLength(4);
      // Statements 1-3 use WITH RECURSIVE; statement 4 is the plain DELETE.
      expect(sqls[0]).toContain('WITH RECURSIVE descendants');
      expect(sqls[1]).toContain('WITH RECURSIVE descendants');
      expect(sqls[2]).toContain('WITH RECURSIVE descendants');
      expect(sqls[3]).toBe('DELETE FROM workspace_folders WHERE id = ?');
    });

    it('binds folderId once per statement (4 binds total)', async () => {
      await repo.delete('f-1');

      expect(mockBind).toHaveBeenCalledTimes(4);
      for (let i = 1; i <= 4; i++) {
        expect(mockBind).toHaveBeenNthCalledWith(i, 'f-1');
      }
    });

    it('first deletes subfolders, then folder-scoped policies, then detaches files, then the folder itself', async () => {
      await repo.delete('f-1');

      const sqls = mockPrepare.mock.calls.map((c) => c[0] as string);
      expect(sqls[0]).toContain('DELETE FROM workspace_folders WHERE id IN');
      expect(sqls[0]).toContain('parent_id = ?');
      expect(sqls[1]).toContain("DELETE FROM workspace_policies WHERE target_type = 'folder'");
      expect(sqls[1]).toContain('target_id IN');
      expect(sqls[2]).toContain('UPDATE files SET workspace_folder_id = NULL');
      expect(sqls[2]).toContain('workspace_folder_id IN');
      expect(sqls[3]).toBe('DELETE FROM workspace_folders WHERE id = ?');
    });
  });

  // ─── PR 2: metadata UPDATE + dashboard list/starred reads ───

  describe('updateMetadata', () => {
    it('UPDATEs metadata JSON scoped by id + workspace_id (3 binds, JSON-stringified)', async () => {
      await repo.updateMetadata('f-1', 'ws-1', { author: 'alice' });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'UPDATE workspace_folders SET metadata = ? WHERE id = ? AND workspace_id = ?',
      );
      // Binds: JSON.stringify(metadata), folderId, workspaceId.
      expect(mockBind).toHaveBeenCalledWith('{"author":"alice"}', 'f-1', 'ws-1');
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('findRecentFolders', () => {
    it('SELECTs recent folders with ws_name JOIN, LIMIT 20 by default', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'f-1', ws_name: 'WS' }] });

      await repo.findRecentFolders('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT f.*, w.name as ws_name');
      expect(sql).toContain(
        'JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?',
      );
      expect(sql).toContain('LEFT JOIN workspaces w ON f.workspace_id = w.id');
      expect(sql).toContain('ORDER BY f.updated_at DESC');
      expect(sql).toContain('LIMIT ?');
      expect(mockBind).toHaveBeenCalledWith('u-1', 20);
    });

    it('accepts a custom limit', async () => {
      await repo.findRecentFolders('u-1', 50);
      expect(mockBind).toHaveBeenCalledWith('u-1', 50);
    });
  });

  describe('findStarredFolders', () => {
    it('SELECTs starred folders with ws_name JOIN, is_starred=1, via .all()', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'f-1', is_starred: 1 }] });

      await repo.findStarredFolders('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT f.*, w.name as ws_name FROM workspace_folders f');
      expect(sql).toContain('JOIN workspace_members wm ON f.workspace_id = wm.workspace_id');
      expect(sql).toContain('JOIN workspaces w ON f.workspace_id = w.id');
      expect(sql).toContain('wm.user_id = ?');
      expect(sql).toContain('f.is_starred = 1');
      expect(sql).toContain('ORDER BY f.updated_at DESC');
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });
});
