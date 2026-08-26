import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the rbac module so we can control getWorkspaceRole + hasPermission +
// checkFolderEditorAccess (the folder-access primitive used by assertCanShare).
// assertWorkspaceRole is a real pass-through to getWorkspaceRole + hasPermission.
vi.mock('../src/lib/rbac', () => ({
  getWorkspaceRole: vi.fn(),
  hasPermission: vi.fn(),
  checkFolderEditorAccess: vi.fn(),
  assertWorkspaceRole: vi.fn(async (db, _wsId, _userId, _role) => {
    const { getWorkspaceRole, hasPermission } = await import('../src/lib/rbac');
    const role = await getWorkspaceRole(db, _wsId, _userId);
    if (!role || !hasPermission(role, _role)) {
      const { ForbiddenError } = await import('../src/lib/errors');
      throw new ForbiddenError();
    }
  }),
}));

import { FileService } from '../src/services/file.service';
import { SharedService } from '../src/services/shared.service';
import { getWorkspaceRole, hasPermission } from '../src/lib/rbac';
import type { FileRow } from '../src/types';
import type { DriveProvider } from '../src/types/drive-provider';

// The FileService mutations compose db.batch([...]) from *Stmt builders, so
// the mock D1 needs both `prepare` (statement construction) and `batch`
// (atomic execution). Batched statements are captured for order assertions.
const mockBatch = vi.fn(async (stmts: unknown[]) =>
  stmts.map(() => ({ success: true, meta: { changes: 1 } })),
);
const mockDb = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({ all: vi.fn(), first: vi.fn(), run: vi.fn() })),
  })),
  batch: mockBatch,
} as unknown as D1Database;
const mockDriveProvider = {
  trashFile: vi.fn(),
  untrashFile: vi.fn(),
  deleteFile: vi.fn(),
  starFile: vi.fn(),
  unstarFile: vi.fn(),
} as unknown as DriveProvider;

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
    owned_by_me: 1,
    ...overrides,
  } as FileRow;
}

/** Distinguishable statement stubs for batch-order assertions. */
const stmt = (label: string) => ({ label }) as never;

describe('FileService RBAC (unit)', () => {
  let fileService: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    fileService = new FileService(mockDb, mockDriveProvider);
  });

  it('owner can trash their own file (personal file)', async () => {
    const file = makeFileRow({ user_id: 'user-1', workspace_id: null });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    const flipSpy = vi
      .spyOn(fileService['fileRepo'], 'markTrashedByIdAndUserIfActiveStmt')
      .mockReturnValue(stmt('flip'));
    vi.spyOn(fileService['driveProvider'], 'trashFile').mockResolvedValue(undefined);

    await fileService.trashFile('user-1', 'file-1');

    expect(flipSpy).toHaveBeenCalledWith('file-1', 'user-1');
    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  it('workspace editor can trash a file owned by another member', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: 'ws-1' });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    const flipSpy = vi
      .spyOn(fileService['fileRepo'], 'markTrashedByIdAndUserIfActiveStmt')
      .mockReturnValue(stmt('flip'));
    vi.spyOn(fileService['driveProvider'], 'trashFile').mockResolvedValue(undefined);
    vi.mocked(getWorkspaceRole).mockResolvedValue('editor');
    vi.mocked(hasPermission).mockReturnValue(true);

    await fileService.trashFile('editor-1', 'file-1');

    expect(flipSpy).toHaveBeenCalledWith('file-1', 'owner-1');
    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  it('workspace viewer cannot trash a file (403)', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: 'ws-1' });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.mocked(getWorkspaceRole).mockResolvedValue('viewer');
    vi.mocked(hasPermission).mockReturnValue(false);

    await expect(fileService.trashFile('viewer-1', 'file-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('non-member cannot trash a personal file owned by another user (403)', async () => {
    const file = makeFileRow({ user_id: 'owner-1', workspace_id: null });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);

    await expect(fileService.trashFile('other-user', 'file-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('trashing an already-trashed file is a fast-path no-op (no Drive call, no batch)', async () => {
    // Every trash path (this service, the sync engine, automation) applies
    // its own gated deltas exactly once at flip time, so an early return
    // cannot skip a pending delta — and it keeps the Drive API uncalled for
    // duplicate trashes (one external subrequest saved per duplicate).
    const file = makeFileRow({ user_id: 'user-1', workspace_id: null, is_trashed: 1 });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    const deltaSpy = vi.spyOn(fileService['fileRepo'], 'applyStorageDeltaIfFileInStateStmt');
    const flipSpy = vi.spyOn(fileService['fileRepo'], 'markTrashedByIdAndUserIfActiveStmt');
    vi.spyOn(fileService['driveProvider'], 'trashFile').mockResolvedValue(undefined);

    await fileService.trashFile('user-1', 'file-1');

    expect(fileService['driveProvider'].trashFile).not.toHaveBeenCalled();
    expect(deltaSpy).not.toHaveBeenCalled();
    expect(flipSpy).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  // ─── Batch composition: statement order is load-bearing ───
  // The gated deltas MUST be emitted before the conditional flip so their
  // EXISTS gates observe the pre-transition state. A flip-first order makes
  // the gates see the post-transition state and silently skip every delta.

  it('trashFile batches [gated stats delta, gated workspace release, conditional flip] in order', async () => {
    const file = makeFileRow({ user_id: 'user-1', workspace_id: 'ws-1' });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    vi.mocked(hasPermission).mockReturnValue(true);
    const deltaStmt = stmt('stats-delta');
    const wsStmt = stmt('ws-release');
    const flipStmt = stmt('flip');
    const deltaSpy = vi
      .spyOn(fileService['fileRepo'], 'applyStorageDeltaIfFileInStateStmt')
      .mockReturnValue(deltaStmt);
    const wsSpy = vi
      .spyOn(fileService['workspaceRepo'], 'updateUsedBytesIfFileInStateStmt')
      .mockReturnValue(wsStmt);
    const flipSpy = vi
      .spyOn(fileService['fileRepo'], 'markTrashedByIdAndUserIfActiveStmt')
      .mockReturnValue(flipStmt);
    vi.spyOn(fileService['driveProvider'], 'trashFile').mockResolvedValue(undefined);

    await fileService.trashFile('user-1', 'file-1');

    expect(deltaSpy).toHaveBeenCalledWith('user-1', 'text/plain', -100, 'file-1', 0);
    expect(wsSpy).toHaveBeenCalledWith('ws-1', -100, 'file-1', 0);
    expect(flipSpy).toHaveBeenCalledWith('file-1', 'user-1');

    expect(mockBatch).toHaveBeenCalledTimes(1);
    const batchArg = mockBatch.mock.calls[0][0] as { label: string }[];
    expect(batchArg).toHaveLength(3);
    expect(batchArg[0]).toBe(deltaStmt);
    expect(batchArg[1]).toBe(wsStmt);
    expect(batchArg[2]).toBe(flipStmt);
  });

  it('trashFile on a non-owned file batches the flip only (no quota deltas)', async () => {
    const file = makeFileRow({ user_id: 'owner-1', owned_by_me: 0 });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    const deltaSpy = vi.spyOn(fileService['fileRepo'], 'applyStorageDeltaIfFileInStateStmt');
    const wsSpy = vi.spyOn(fileService['workspaceRepo'], 'updateUsedBytesIfFileInStateStmt');
    vi.spyOn(fileService['driveProvider'], 'trashFile').mockResolvedValue(undefined);

    await fileService.trashFile('owner-1', 'file-1');

    expect(deltaSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(mockBatch).toHaveBeenCalledTimes(1);
    expect(mockBatch.mock.calls[0][0]).toHaveLength(1);
  });

  it('restoreFile batches [gated stats delta, gated workspace reserve, conditional un-flip] in order', async () => {
    const file = makeFileRow({ user_id: 'user-1', workspace_id: 'ws-1', is_trashed: 1 });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    vi.mocked(hasPermission).mockReturnValue(true);
    const deltaStmt = stmt('stats-delta');
    const wsStmt = stmt('ws-reserve');
    const unflipStmt = stmt('unflip');
    const deltaSpy = vi
      .spyOn(fileService['fileRepo'], 'applyStorageDeltaIfFileInStateStmt')
      .mockReturnValue(deltaStmt);
    const wsSpy = vi
      .spyOn(fileService['workspaceRepo'], 'updateUsedBytesIfFileInStateStmt')
      .mockReturnValue(wsStmt);
    const unflipSpy = vi
      .spyOn(fileService['fileRepo'], 'markUntrashedByIdAndUserIfTrashedStmt')
      .mockReturnValue(unflipStmt);
    vi.spyOn(fileService['driveProvider'], 'untrashFile').mockResolvedValue(undefined);

    await fileService.restoreFile('user-1', 'file-1');

    // Restore gates observe the pre-transition TRASHED state (is_trashed = 1).
    expect(deltaSpy).toHaveBeenCalledWith('user-1', 'text/plain', 100, 'file-1', 1);
    expect(wsSpy).toHaveBeenCalledWith('ws-1', 100, 'file-1', 1);
    expect(unflipSpy).toHaveBeenCalledWith('file-1', 'user-1');

    expect(mockBatch).toHaveBeenCalledTimes(1);
    const batchArg = mockBatch.mock.calls[0][0] as { label: string }[];
    expect(batchArg).toHaveLength(3);
    expect(batchArg[0]).toBe(deltaStmt);
    expect(batchArg[1]).toBe(wsStmt);
    expect(batchArg[2]).toBe(unflipStmt);
  });

  it('restoreFile on a non-trashed file throws NotFoundError', async () => {
    const file = makeFileRow({ user_id: 'user-1', is_trashed: 0 });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);

    await expect(fileService.restoreFile('user-1', 'file-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockBatch).not.toHaveBeenCalled();
    expect(fileService['driveProvider'].untrashFile).not.toHaveBeenCalled();
  });

  it('permanentDelete batches the conditional DELETE only — no deltas, shared-links cleanup after the batch', async () => {
    const file = makeFileRow({ user_id: 'user-1', workspace_id: 'ws-1', is_trashed: 1 });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    vi.mocked(hasPermission).mockReturnValue(true);
    vi.spyOn(fileService['policyService'], 'checkRetentionProtection').mockResolvedValue(false);
    vi.spyOn(fileService['driveProvider'], 'deleteFile').mockResolvedValue(undefined);
    const deltaSpy = vi.spyOn(fileService['fileRepo'], 'applyStorageDeltaIfFileInStateStmt');
    const wsSpy = vi.spyOn(fileService['workspaceRepo'], 'updateUsedBytesIfFileInStateStmt');
    const deleteStmt = stmt('delete');
    const deleteSpy = vi
      .spyOn(fileService['fileRepo'], 'deleteByIdAndUserIfTrashedStmt')
      .mockReturnValue(deleteStmt);
    // Execution-order log: the shared-links cleanup MUST follow the deletion
    // batch (a failed batch leaves file + links intact; a failed cleanup
    // leaves harmless orphaned links, not dead links for a live file).
    const events: string[] = [];
    mockBatch.mockImplementationOnce(async (stmts: unknown[]) => {
      events.push('batch');
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    });
    const sharedCleanupSpy = vi.fn(async () => {
      events.push('links');
    });
    const { SharedRepository } = await import('../src/repositories/shared.repository');
    vi.spyOn(SharedRepository.prototype, 'deleteByTarget').mockImplementation(
      sharedCleanupSpy as never,
    );

    await fileService.permanentDelete('user-1', 'file-1');

    // NO stats delta and NO workspace release — both fired at trash time by
    // whichever path flipped the row; releasing again would double-release.
    expect(deltaSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('file-1', 'user-1');
    expect(sharedCleanupSpy).toHaveBeenCalledWith('file-1', 'file');
    expect(events).toEqual(['batch', 'links']);

    expect(mockBatch).toHaveBeenCalledTimes(1);
    expect(mockBatch.mock.calls[0][0]).toEqual([deleteStmt]);
  });

  it('permanentDelete on a non-trashed file throws NotFoundError (only trash is permanently deletable)', async () => {
    const file = makeFileRow({ user_id: 'user-1', is_trashed: 0 });
    vi.spyOn(fileService['fileRepo'], 'findById').mockResolvedValue(file);

    await expect(fileService.permanentDelete('user-1', 'file-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockBatch).not.toHaveBeenCalled();
    expect(fileService['driveProvider'].deleteFile).not.toHaveBeenCalled();
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
    });

    expect(id).toBe('link-1');
    expect(sharedService['sharedRepo'].insertWithUniqueSlug).toHaveBeenCalled();
  });

  it('getDownloadContext returns context for editor-created link (file owned by another)', async () => {
    const file = makeFileRow({
      user_id: 'owner-1',
      workspace_id: 'ws-1',
      drive_account_id: 'drive-1',
    });
    vi.spyOn(sharedService['fileRepo'], 'findById').mockResolvedValue(file);
    vi.spyOn(sharedService['driveRepo'], 'findById').mockResolvedValue({
      id: 'drive-1',
    } as never);
    vi.mocked(getWorkspaceRole).mockResolvedValue('editor');
    vi.mocked(hasPermission).mockReturnValue(true);

    const link = {
      id: 'link-1',
      userId: 'editor-1',
      targetType: 'file' as const,
      targetId: 'file-1',
      targetName: undefined,
      passwordHash: null,
      expiresAt: null,
      allowDownloads: true,
      maxDownloads: null,
      webhookUrl: null,
      viewCount: 0,
      downloadCount: 0,
      createdAt: '',
    };

    const ctx = await sharedService.getDownloadContext(link);
    expect(ctx).not.toBeNull();
    expect(ctx?.file).toBe(file);
    expect(ctx?.driveAccountId).toBe('drive-1');
  });

  it('updateLink: undefined fields keep existing, null clears', async () => {
    const existingRow = {
      id: 'link-1',
      user_id: 'user-1',
      target_type: 'file' as const,
      target_id: 'file-1',
      password_hash: 'old-hash',
      expires_at: '2025-12-31',
      allow_downloads: 1,
      max_downloads: 5,
      webhook_url: 'https://old.webhook',
      view_count: 0,
      download_count: 0,
      created_at: '',
    };
    vi.spyOn(sharedService['sharedRepo'], 'findByIdAndUser').mockResolvedValue(
      existingRow as never,
    );
    const updateSpy = vi.spyOn(sharedService['sharedRepo'], 'update').mockResolvedValue(1);

    // Pass only password=null (clear) — everything else undefined (keep)
    await sharedService.updateLink('user-1', 'link-1', { password: null });

    expect(updateSpy).toHaveBeenCalledWith(
      'link-1',
      'user-1',
      expect.objectContaining({
        passwordHash: null,
        expiresAt: '2025-12-31',
        maxDownloads: 5,
        webhookUrl: 'https://old.webhook',
      }),
    );
  });
});
