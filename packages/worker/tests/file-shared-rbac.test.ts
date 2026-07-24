import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the rbac module so we can control getWorkspaceRole + hasPermission
vi.mock('../src/lib/rbac', () => ({
  getWorkspaceRole: vi.fn(),
  hasPermission: vi.fn(),
}));

import { FileService } from '../src/services/file.service';
import { SharedService } from '../src/services/shared.service';
import { getWorkspaceRole, hasPermission } from '../src/lib/rbac';
import type { FileRow } from '../src/types';

const mockDb = {} as D1Database;

function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: 'file-1',
    user_id: 'owner-1',
    drive_account_id: 'drive-1',
    google_file_id: 'gfile-1',
    workspace_id: null,
    workspace_folder_id: null,
    google_parent_id: null,
    name: 'test.txt',
    mime_type: 'text/plain',
    size: 100,
    thumbnail_url: null,
    web_view_link: null,
    web_content_link: null,
    is_trashed: 0,
    is_starred: 0,
    metadata: '',
    google_created_at: null,
    google_modified_at: null,
    synced_at: '',
    last_synced_at: null,
    sync_status: 'idle',
    updated_at: '',
    ...overrides,
  } as FileRow;
}

describe('FileService RBAC (unit)', () => {
  let fileService: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    fileService = new FileService(mockDb, 'client-id', 'secret', '0'.repeat(64));
  });

  it('owner can trash their own file (personal file)', async () => {
    const file = makeFileRow({ user_id: 'user-1', workspace_id: null });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.spyOn(fileService['fileRepo'], 'markTrashed').mockResolvedValue(undefined);
    vi.spyOn(fileService['driveService'], 'trashFile').mockResolvedValue(undefined);

    await fileService.trashFile('user-1', 'file-1');

    expect(fileService['fileRepo'].markTrashed).toHaveBeenCalledWith('file-1', 'user-1');
  });

  it('workspace editor can trash a file owned by another member', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: 'ws-1' });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.spyOn(fileService['fileRepo'], 'markTrashed').mockResolvedValue(undefined);
    vi.spyOn(fileService['driveService'], 'trashFile').mockResolvedValue(undefined);
    vi.mocked(getWorkspaceRole).mockResolvedValue('editor');
    vi.mocked(hasPermission).mockReturnValue(true);

    await fileService.trashFile('editor-1', 'file-1');

    expect(fileService['fileRepo'].markTrashed).toHaveBeenCalledWith('file-1', 'owner-1');
  });

  it('workspace viewer cannot trash a file (403)', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: 'ws-1' });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.mocked(getWorkspaceRole).mockResolvedValue('viewer');
    vi.mocked(hasPermission).mockReturnValue(false);

    await expect(fileService.trashFile('viewer-1', 'file-1')).rejects.toMatchObject({ status: 403 });
  });

  it('non-member cannot trash a personal file owned by another user (403)', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: null });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);

    await expect(fileService.trashFile('other-user', 'file-1')).rejects.toMatchObject({ status: 403 });
  });
});

describe('SharedService RBAC (unit)', () => {
  let sharedService: SharedService;

  beforeEach(() => {
    vi.clearAllMocks();
    sharedService = new SharedService(mockDb);
  });

  it('workspace editor can share a file owned by another member', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: 'ws-1' });
    vi.spyOn(sharedService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.spyOn(sharedService['sharedRepo'], 'insertWithUniqueSlug').mockResolvedValue('link-1');
    vi.mocked(getWorkspaceRole).mockResolvedValue('editor');
    vi.mocked(hasPermission).mockReturnValue(true);

    const id = await sharedService.createLink('editor-1', {
      targetType: 'file',
      targetId: 'file-1',
      allowDownloads: true,
      allowUploads: false,
      requireEmail: false,
    });

    expect(id).toBe('link-1');
    expect(sharedService['sharedRepo'].insertWithUniqueSlug).toHaveBeenCalled();
  });

  it('getDownloadContext returns context for editor-created link (file owned by another)', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: 'ws-1', drive_account_id: 'drive-1' });
    vi.spyOn(sharedService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.spyOn(sharedService['driveRepo'], 'findByIdAndUser').mockResolvedValue({ id: 'drive-1' } as never);
    vi.mocked(getWorkspaceRole).mockResolvedValue('editor');
    vi.mocked(hasPermission).mockReturnValue(true);

    const link = {
      id: 'link-1', userId: 'editor-1', targetType: 'file' as const, targetId: 'file-1',
      targetName: undefined, passwordHash: null, expiresAt: null, allowDownloads: true,
      allowUploads: false, maxDownloads: null, requireEmail: false, webhookUrl: null,
      viewCount: 0, downloadCount: 0, createdAt: '',
    };

    const ctx = await sharedService.getDownloadContext(link);
    expect(ctx).not.toBeNull();
    expect(ctx?.file).toBe(file);
    expect(ctx?.driveAccountId).toBe('drive-1');
  });

  it('updateLink: undefined fields keep existing, null clears', async () => {
    const existingRow = {
      id: 'link-1', user_id: 'user-1', target_type: 'file' as const, target_id: 'file-1',
      password_hash: 'old-hash', expires_at: '2025-12-31', allow_downloads: 1,
      allow_uploads: 0, max_downloads: 5, require_email: 1, webhook_url: 'https://old.webhook',
      view_count: 0, download_count: 0, created_at: '',
    };
    vi.spyOn(sharedService['sharedRepo'], 'findByIdAndUser').mockResolvedValue(existingRow as never);
    const updateSpy = vi.spyOn(sharedService['sharedRepo'], 'update').mockResolvedValue(1);

    // Pass only password=null (clear) — everything else undefined (keep)
    await sharedService.updateLink('user-1', 'link-1', { password: null });

    expect(updateSpy).toHaveBeenCalledWith('link-1', 'user-1', expect.objectContaining({
      passwordHash: null,
      expiresAt: '2025-12-31',
      maxDownloads: 5,
      webhookUrl: 'https://old.webhook',
    }));
  });
});
