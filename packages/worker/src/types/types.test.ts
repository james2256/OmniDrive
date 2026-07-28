import { describe, it, expect } from 'vitest';
import type { FileEntry } from './domain';
import type { BreadcrumbItem } from './api';
import type { Env } from './env';
import type { AutomationRule } from './automation';
import { mapDriveRow, mapFileRow, mapFolderRow } from './db';

// Verify that the types/ sub-modules are independently importable — no barrel needed.
// If someone re-adds types/index.ts, these tests still pass (direct imports work
// regardless of whether a barrel exists). The grep audit in CI catches barrel imports.

describe('types/ sub-modules', () => {
  describe('domain.ts', () => {
    it('exports core domain interfaces', () => {
      const file: FileEntry = {
        id: 'test',
        userId: 'u1',
        driveAccountId: 'd1',
        googleFileId: 'g1',
        workspaceId: null,
        workspaceFolderId: null,
        googleParentId: null,
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 100,
        thumbnailUrl: null,
        webViewLink: null,
        webContentLink: null,
        isTrashed: false,
        isStarred: false,
        googleCreatedAt: null,
        googleModifiedAt: null,
        syncedAt: '2026-01-01',
        lastSyncedAt: null,
        syncStatus: 'idle',
        createdAt: '2026-01-01',
      };
      expect(file.name).toBe('test.txt');
    });
  });

  describe('db.ts', () => {
    it('exports mapper functions', () => {
      expect(typeof mapDriveRow).toBe('function');
      expect(typeof mapFileRow).toBe('function');
      expect(typeof mapFolderRow).toBe('function');
    });

    it('mapDriveRow converts a D1 row to domain type', () => {
      const row = {
        id: 'd1',
        user_id: 'u1',
        google_account_id: 'g1',
        email: 'test@test.com',
        name: 'Test Drive',
        type: 'oauth',
        is_primary: 1,
        root_folder_id: null,
        total_quota: 15_000_000_000,
        used_quota: 5_000_000_000,
        quota_override: null,
        quota_updated_at: null,
        created_at: '2026-01-01',
      };
      const drive = mapDriveRow(row);
      expect(drive.id).toBe('d1');
      expect(drive.isPrimary).toBe(true);
      expect(drive.totalQuota).toBe(15_000_000_000);
    });
  });

  describe('api.ts', () => {
    it('exports transport types (compile-time check)', () => {
      const bc: BreadcrumbItem = { id: 'root', name: 'Root' };
      expect(bc.name).toBe('Root');
    });
  });

  describe('env.ts', () => {
    it('exports Env type (compile-time check)', () => {
      const env: Pick<Env, 'DB'> = { DB: {} as never };
      expect(env.DB).toBeDefined();
    });
  });

  describe('automation.ts', () => {
    it('exports automation types (compile-time check)', () => {
      const rule: Pick<AutomationRule, 'triggerType'> = { triggerType: 'event' };
      expect(rule.triggerType).toBe('event');
    });
  });
});
