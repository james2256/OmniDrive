// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useItemModals } from './useItemModals';
import { useSelectionStore } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { getFolderIdentifier } from '../components/files/utils';
import type { FileEntry, DriveFolder } from '../types';

// Hoisted mutation mocks — useItemModals owns 4 mutation hooks + the
// useToggleStar passthrough; each must return a stable mock object with
// .mutate / .mutateAsync / .isPending so the hook's render branches don't
// throw when destructuring.
const mutMocks = vi.hoisted(() => ({
  deleteFile: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
  renameFile: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
  deleteDriveFolder: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
  renameDriveFolder: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
  toggleStar: vi.fn(),
}));

vi.mock('./useFileMutations', () => ({
  useDeleteFile: vi.fn(() => mutMocks.deleteFile),
  useRenameFile: vi.fn(() => mutMocks.renameFile),
  useToggleStar: vi.fn(() => mutMocks.toggleStar),
}));

vi.mock('./useFolderMutations', () => ({
  useDeleteDriveFolder: vi.fn(() => mutMocks.deleteDriveFolder),
  useRenameDriveFolder: vi.fn(() => mutMocks.renameDriveFolder),
}));

vi.mock('../stores/useSelectionStore', () => ({
  useSelectionStore: vi.fn(),
}));

vi.mock('../stores/useUIStore', () => ({
  useUIStore: vi.fn(),
}));

vi.mock('../components/files/utils', () => ({
  getFolderIdentifier: vi.fn(),
}));

const makeFile = (id: string, name: string): FileEntry =>
  ({
    id,
    userId: 'u1',
    driveAccountId: 'd1',
    googleFileId: 'g-' + id,
    workspaceId: null,
    workspaceFolderId: null,
    googleParentId: null,
    name,
    mimeType: 'text/plain',
    size: 10,
    thumbnailUrl: null,
    webViewLink: null,
    webContentLink: null,
    isTrashed: false,
    googleCreatedAt: null,
    googleModifiedAt: null,
    syncedAt: '2024-01-01',
    lastSyncedAt: null,
    syncStatus: 'idle',
    createdAt: '2024-01-01',
  }) as FileEntry;

const makeFolder = (googleFolderId: string, name: string): DriveFolder =>
  ({
    googleFolderId,
    name,
    isSynced: true,
  }) as DriveFolder;

describe('useItemModals', () => {
  const clearSelection = vi.fn();
  const toggleSelection = vi.fn();
  const setIsInfoPanelOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useSelectionStore as unknown as Mock).mockReturnValue({ clearSelection, toggleSelection });
    (useUIStore as unknown as Mock).mockReturnValue({ setIsInfoPanelOpen });
    // Reset pending flags + the toggleStar mock identity so per-test state
    // doesn't leak via the hoisted mutMocks object.
    mutMocks.deleteFile.isPending = false;
    mutMocks.renameFile.isPending = false;
    mutMocks.deleteDriveFolder.isPending = false;
    mutMocks.renameDriveFolder.isPending = false;
  });

  it('initial state has all modals closed', () => {
    const { result } = renderHook(() => useItemModals());

    expect(result.current.previewFile).toBeNull();
    expect(result.current.shareTarget).toBeNull();
    expect(result.current.moveDriveFiles).toEqual([]);
    expect(result.current.moveTarget).toEqual([]);
    expect(result.current.folderDownloadTarget).toBeNull();
    expect(result.current.workspaceTarget).toBeNull();
    expect(result.current.renameTarget).toBeNull();
    expect(result.current.confirmFileDelete).toBeNull();
    expect(result.current.confirmFolderDelete).toBeNull();
  });

  it('setPreviewFile opens the preview modal', () => {
    const { result } = renderHook(() => useItemModals());
    const file = makeFile('f1', 'a.txt');

    act(() => {
      result.current.setPreviewFile(file);
    });

    expect(result.current.previewFile).toBe(file);
  });

  it('setShareTarget opens the share modal', () => {
    const { result } = renderHook(() => useItemModals());
    const target = { id: 'f1', type: 'file' as const };

    act(() => {
      result.current.setShareTarget(target);
    });

    expect(result.current.shareTarget).toEqual(target);
  });

  it('setMoveTarget opens the move modal', () => {
    const { result } = renderHook(() => useItemModals());
    const items = [{ type: 'file', item: makeFile('f1', 'a.txt') }] as any;

    act(() => {
      result.current.setMoveTarget(items);
    });

    expect(result.current.moveTarget).toEqual(items);
  });

  it('setMoveDriveFiles opens the move-drive modal', () => {
    const { result } = renderHook(() => useItemModals());
    const files = [makeFile('f1', 'a.txt'), makeFile('f2', 'b.txt')];

    act(() => {
      result.current.setMoveDriveFiles(files);
    });

    expect(result.current.moveDriveFiles).toEqual(files);
  });

  it('setFolderDownloadTarget opens the folder-download modal', () => {
    const { result } = renderHook(() => useItemModals());
    const target = { driveId: 'd1', folderId: 'fold-1', name: 'Pics' };

    act(() => {
      result.current.setFolderDownloadTarget(target);
    });

    expect(result.current.folderDownloadTarget).toEqual(target);
  });

  it('setWorkspaceTarget opens the workspace modal', () => {
    const { result } = renderHook(() => useItemModals());
    const file = makeFile('f1', 'a.txt');

    act(() => {
      result.current.setWorkspaceTarget(file);
    });

    expect(result.current.workspaceTarget).toBe(file);
  });

  it('handleRenameFileRequest opens the rename dialog (file branch)', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleRenameFileRequest('f1', 'old-name.txt');
    });

    expect(result.current.renameTarget).toEqual({
      kind: 'file',
      id: 'f1',
      currentName: 'old-name.txt',
    });
  });

  it('handleRenameFolderRequest opens the rename dialog (folder branch)', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleRenameFolderRequest('d1', 'fold-1', 'old-folder');
    });

    expect(result.current.renameTarget).toEqual({
      kind: 'folder',
      driveId: 'd1',
      folderId: 'fold-1',
      currentName: 'old-folder',
    });
  });

  it('handleDeleteFile opens the confirm dialog with provided name', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleDeleteFile('f1', 'a.txt');
    });

    expect(result.current.confirmFileDelete).toEqual({ id: 'f1', name: 'a.txt' });
  });

  it('handleDeleteFile falls back to files lookup when name omitted', () => {
    const file = makeFile('f1', 'resolved-name.txt');
    const { result } = renderHook(() => useItemModals({ files: [file] }));

    act(() => {
      result.current.handleDeleteFile('f1');
    });

    expect(result.current.confirmFileDelete).toEqual({ id: 'f1', name: 'resolved-name.txt' });
  });

  it('handleDeleteFile uses "this file" when neither name nor matching file found', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleDeleteFile('f1');
    });

    expect(result.current.confirmFileDelete).toEqual({ id: 'f1', name: 'this file' });
  });

  it('handleDeleteFolder opens the confirm dialog with provided name', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleDeleteFolder('d1', 'fold-1', 'My Folder');
    });

    expect(result.current.confirmFolderDelete).toEqual({
      id: 'fold-1',
      name: 'My Folder',
      driveId: 'd1',
    });
  });

  it('handleDeleteFolder falls back to allFolders lookup via getFolderIdentifier', () => {
    const folder = makeFolder('fold-1', 'Resolved Folder');
    (getFolderIdentifier as Mock).mockReturnValue('fold-1');
    const { result } = renderHook(() => useItemModals({ allFolders: [folder] }));

    act(() => {
      result.current.handleDeleteFolder('d1', 'fold-1');
    });

    expect(getFolderIdentifier).toHaveBeenCalledWith(folder);
    expect(result.current.confirmFolderDelete).toEqual({
      id: 'fold-1',
      name: 'Resolved Folder',
      driveId: 'd1',
    });
  });

  it('handleDeleteFolder uses "this folder" when neither name nor matching folder found', () => {
    (getFolderIdentifier as Mock).mockReturnValue('other');
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleDeleteFolder('d1', 'fold-1');
    });

    expect(result.current.confirmFolderDelete).toEqual({
      id: 'fold-1',
      name: 'this folder',
      driveId: 'd1',
    });
  });

  it('handleViewInfo clears selection, toggles the item, opens info panel', () => {
    const { result } = renderHook(() => useItemModals());
    const file = makeFile('f1', 'a.txt');

    act(() => {
      result.current.handleViewInfo(file, 'file');
    });

    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(toggleSelection).toHaveBeenCalledTimes(1);
    expect(toggleSelection).toHaveBeenCalledWith({ type: 'file', item: file });
    expect(setIsInfoPanelOpen).toHaveBeenCalledWith(true);
  });

  it('toggleStar is the function returned by useToggleStar', () => {
    const { result } = renderHook(() => useItemModals());

    expect(result.current.toggleStar).toBe(mutMocks.toggleStar);

    act(() => {
      result.current.toggleStar('f1', 'file', false);
    });

    expect(mutMocks.toggleStar).toHaveBeenCalledWith('f1', 'file', false);
  });

  it('closeRename closes the rename dialog', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleRenameFileRequest('f1', 'old');
    });
    expect(result.current.renameTarget).not.toBeNull();

    act(() => {
      result.current.closeRename();
    });
    expect(result.current.renameTarget).toBeNull();
  });

  it('closeFileDelete closes the file delete confirm', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleDeleteFile('f1', 'a.txt');
    });
    expect(result.current.confirmFileDelete).not.toBeNull();

    act(() => {
      result.current.closeFileDelete();
    });
    expect(result.current.confirmFileDelete).toBeNull();
  });

  it('closeFolderDelete closes the folder delete confirm', () => {
    const { result } = renderHook(() => useItemModals());

    act(() => {
      result.current.handleDeleteFolder('d1', 'fold-1', 'F');
    });
    expect(result.current.confirmFolderDelete).not.toBeNull();

    act(() => {
      result.current.closeFolderDelete();
    });
    expect(result.current.confirmFolderDelete).toBeNull();
  });

  it('isRenaming reflects the rename mutation pending state', () => {
    mutMocks.renameFile.isPending = true;
    const { result } = renderHook(() => useItemModals());
    expect(result.current.isRenaming).toBe(true);
  });

  it('isRenaming reflects the folder rename mutation pending state', () => {
    mutMocks.renameDriveFolder.isPending = true;
    const { result } = renderHook(() => useItemModals());
    expect(result.current.isRenaming).toBe(true);
  });

  it('isDeletingFile reflects the delete-file pending state', () => {
    mutMocks.deleteFile.isPending = true;
    const { result } = renderHook(() => useItemModals());
    expect(result.current.isDeletingFile).toBe(true);
  });

  it('isDeletingFolder reflects the delete-folder pending state', () => {
    mutMocks.deleteDriveFolder.isPending = true;
    const { result } = renderHook(() => useItemModals());
    expect(result.current.isDeletingFolder).toBe(true);
  });

  it('handleRenameConfirm calls renameFile.mutateAsync for the file branch + onRefresh', async () => {
    const onRefresh = vi.fn();
    (mutMocks.renameFile.mutateAsync as Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    act(() => {
      result.current.handleRenameFileRequest('f1', 'old.txt');
    });

    await act(async () => {
      await result.current.handleRenameConfirm('new.txt');
    });

    expect(mutMocks.renameFile.mutateAsync).toHaveBeenCalledWith({
      fileId: 'f1',
      name: 'new.txt',
    });
    expect(result.current.renameTarget).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('handleRenameConfirm calls renameDriveFolder.mutateAsync for the folder branch', async () => {
    const onRefresh = vi.fn();
    (mutMocks.renameDriveFolder.mutateAsync as Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    act(() => {
      result.current.handleRenameFolderRequest('d1', 'fold-1', 'old');
    });

    await act(async () => {
      await result.current.handleRenameConfirm('new');
    });

    expect(mutMocks.renameDriveFolder.mutateAsync).toHaveBeenCalledWith({
      driveId: 'd1',
      folderId: 'fold-1',
      name: 'new',
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('handleRenameConfirm is a no-op when there is no renameTarget', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    await act(async () => {
      await result.current.handleRenameConfirm('new.txt');
    });

    expect(mutMocks.renameFile.mutateAsync).not.toHaveBeenCalled();
    expect(mutMocks.renameDriveFolder.mutateAsync).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('confirmFileDeleteAsync calls deleteFile.mutateAsync, clears confirm, calls onRefresh', async () => {
    const onRefresh = vi.fn();
    (mutMocks.deleteFile.mutateAsync as Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    act(() => {
      result.current.handleDeleteFile('f1', 'a.txt');
    });

    await act(async () => {
      await result.current.confirmFileDeleteAsync();
    });

    expect(mutMocks.deleteFile.mutateAsync).toHaveBeenCalledWith('f1');
    expect(result.current.confirmFileDelete).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('confirmFileDeleteAsync is a no-op when there is no confirmFileDelete', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    await act(async () => {
      await result.current.confirmFileDeleteAsync();
    });

    expect(mutMocks.deleteFile.mutateAsync).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('confirmFolderDeleteAsync calls deleteDriveFolder.mutateAsync, clears, onRefresh', async () => {
    const onRefresh = vi.fn();
    (mutMocks.deleteDriveFolder.mutateAsync as Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    act(() => {
      result.current.handleDeleteFolder('d1', 'fold-1', 'F');
    });

    await act(async () => {
      await result.current.confirmFolderDeleteAsync();
    });

    expect(mutMocks.deleteDriveFolder.mutateAsync).toHaveBeenCalledWith({
      driveId: 'd1',
      folderId: 'fold-1',
    });
    expect(result.current.confirmFolderDelete).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('confirmFolderDeleteAsync is a no-op when there is no confirmFolderDelete', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => useItemModals({ onRefresh }));

    await act(async () => {
      await result.current.confirmFolderDeleteAsync();
    });

    expect(mutMocks.deleteDriveFolder.mutateAsync).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
