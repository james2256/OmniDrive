import { describe, it, expect, vi } from 'vitest';
import { roleLevel, hasPermission, checkFolderEditorAccess } from '../src/lib/rbac';

describe('rbac', () => {
  describe('roleLevel', () => {
    it('returns correct levels for each role', () => {
      expect(roleLevel('viewer')).toBe(1);
      expect(roleLevel('auditor')).toBe(1);
      expect(roleLevel('commenter')).toBe(2);
      expect(roleLevel('editor')).toBe(3);
      expect(roleLevel('manager')).toBe(4);
      expect(roleLevel('owner')).toBe(5);
    });
  });

  describe('hasPermission', () => {
    it('owner has all permissions', () => {
      expect(hasPermission('owner', 'viewer')).toBe(true);
      expect(hasPermission('owner', 'manager')).toBe(true);
      expect(hasPermission('owner', 'owner')).toBe(true);
    });

    it('viewer cannot access editor+ actions', () => {
      expect(hasPermission('viewer', 'editor')).toBe(false);
      expect(hasPermission('viewer', 'manager')).toBe(false);
      expect(hasPermission('viewer', 'owner')).toBe(false);
    });

    it('editor can access editor actions but not manager', () => {
      expect(hasPermission('editor', 'editor')).toBe(true);
      expect(hasPermission('editor', 'viewer')).toBe(true);
      expect(hasPermission('editor', 'manager')).toBe(false);
    });

    it('auditor has same level as viewer', () => {
      expect(hasPermission('auditor', 'viewer')).toBe(true);
      expect(hasPermission('viewer', 'auditor')).toBe(true); // same level
      expect(hasPermission('auditor', 'editor')).toBe(false);
    });
  });

  describe('checkFolderEditorAccess', () => {
    // Mock D1 to control findMembership (FolderRepository) + findMemberRole
    // (WorkspaceRepository). checkFolderEditorAccess orchestrates both.
    function makeMockDb(
      folderRow: { id: string; workspace_id: string } | null,
      memberRow: { role: string } | null,
    ): D1Database {
      const prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(folderRow ?? memberRow),
        }),
      });
      // FolderRepository.findMembership uses the first .first() call → folderRow.
      // WorkspaceRepository.findMemberRole uses the second .first() call → memberRow.
      const firstCalls = [folderRow, memberRow];
      let callIndex = 0;
      prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockImplementation(async () => firstCalls[callIndex++] ?? null),
        }),
      });
      return { prepare } as unknown as D1Database;
    }

    it('returns false when folder does not exist (no membership row)', async () => {
      const db = makeMockDb(null, null);
      const result = await checkFolderEditorAccess(db, 'nonexistent-folder', 'user-1');
      expect(result).toBe(false);
    });

    it('returns false when user is not a workspace member', async () => {
      const db = makeMockDb({ id: 'folder-1', workspace_id: 'ws-1' }, null);
      const result = await checkFolderEditorAccess(db, 'folder-1', 'user-1');
      expect(result).toBe(false);
    });

    it('returns false when user is a viewer (below editor)', async () => {
      const db = makeMockDb({ id: 'folder-1', workspace_id: 'ws-1' }, { role: 'viewer' });
      const result = await checkFolderEditorAccess(db, 'folder-1', 'user-1');
      expect(result).toBe(false);
    });

    it('returns true when user is an editor', async () => {
      const db = makeMockDb({ id: 'folder-1', workspace_id: 'ws-1' }, { role: 'editor' });
      const result = await checkFolderEditorAccess(db, 'folder-1', 'user-1');
      expect(result).toBe(true);
    });

    it('returns true when user is an owner (above editor)', async () => {
      const db = makeMockDb({ id: 'folder-1', workspace_id: 'ws-1' }, { role: 'owner' });
      const result = await checkFolderEditorAccess(db, 'folder-1', 'user-1');
      expect(result).toBe(true);
    });
  });
});
