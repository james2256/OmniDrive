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
        ownedByMe: true,
        ownerEmail: null,
        metadata: '{}',
        googleCreatedAt: null,
        googleModifiedAt: null,
        syncedAt: '2026-01-01',
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

    it('mapFileRow maps owner_email → ownerEmail (null when column is null)', () => {
      const row = {
        id: 'f1',
        user_id: 'u1',
        drive_account_id: 'd1',
        google_file_id: 'g1',
        workspace_id: null,
        workspace_folder_id: null,
        google_parent_id: 'root',
        name: 'spec.pdf',
        mime_type: 'application/pdf',
        size: 100,
        thumbnail_url: null,
        web_view_link: null,
        web_content_link: null,
        is_trashed: 0,
        is_starred: 0,
        owned_by_me: 0,
        owner_email: null,
        metadata: '{}',
        google_created_at: null,
        google_modified_at: null,
        synced_at: '2026-01-01',
        last_synced_at: null,
        sync_status: 'idle',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };
      const file = mapFileRow(row);
      expect(file.ownedByMe).toBe(false);
      expect(file.ownerEmail).toBeNull();
    });

    it('mapFileRow maps owner_email → ownerEmail (string when column is populated)', () => {
      const row = {
        id: 'f1',
        user_id: 'u1',
        drive_account_id: 'd1',
        google_file_id: 'g1',
        workspace_id: null,
        workspace_folder_id: null,
        google_parent_id: 'root',
        name: 'spec.pdf',
        mime_type: 'application/pdf',
        size: 100,
        thumbnail_url: null,
        web_view_link: null,
        web_content_link: null,
        is_trashed: 0,
        is_starred: 0,
        owned_by_me: 0,
        owner_email: 'alice@example.com',
        metadata: '{}',
        google_created_at: null,
        google_modified_at: null,
        synced_at: '2026-01-01',
        last_synced_at: null,
        sync_status: 'idle',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      };
      const file = mapFileRow(row);
      expect(file.ownedByMe).toBe(false);
      expect(file.ownerEmail).toBe('alice@example.com');
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
