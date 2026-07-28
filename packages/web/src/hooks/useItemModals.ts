import { useState, useCallback } from 'react';
import { useSelectionStore, type SelectedItem } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { useDeleteFile, useRenameFile, useToggleStar } from './useFileMutations';
import { useDeleteDriveFolder, useRenameDriveFolder } from './useFolderMutations';
import type { FileEntry, DriveFolder, WorkspaceFolder } from '../types';
import { getFolderIdentifier } from '../components/files/utils';

type RenameTarget =
  | { kind: 'file'; id: string; currentName: string }
  | { kind: 'folder'; driveId: string; folderId: string; currentName: string }
  | null;

export interface UseItemModalsOptions {
  /** Called after any mutation (delete, rename) to refresh the page's data. */
  onRefresh?: () => void;
  /** All loaded folders (for resolving folder names in delete confirmation). */
  allFolders?: (DriveFolder | WorkspaceFolder)[];
  /** All loaded files (for resolving file names in delete confirmation). */
  files?: FileEntry[];
}

export interface UseItemModalsResult {
  // State values for controlling which modal is open
  previewFile: FileEntry | null;
  shareTarget: { id: string; type: 'file' | 'folder' } | null;
  moveDriveFiles: FileEntry[];
  moveTarget: SelectedItem[];
  folderDownloadTarget: { driveId: string; folderId: string; name: string } | null;
  workspaceTarget: FileEntry | null;
  renameTarget: RenameTarget;
  confirmFileDelete: { id: string; name: string } | null;
  confirmFolderDelete: { id: string; name: string; driveId: string } | null;
  // Loading states
  isRenaming: boolean;
  isDeletingFile: boolean;
  isDeletingFolder: boolean;
  // Action handlers — wire to ItemActions
  handleDeleteFile: (id: string, name?: string) => void;
  handleDeleteFolder: (driveId: string, folderId: string, name?: string) => void;
  handleRenameFileRequest: (fileId: string, currentName: string) => void;
  handleRenameFolderRequest: (driveId: string, folderId: string, currentName: string) => void;
  handleRenameConfirm: (newName: string) => Promise<void>;
  handleViewInfo: (
    item: FileEntry | DriveFolder | WorkspaceFolder,
    type: 'file' | 'folder',
  ) => void;
  // Confirm handlers (called by ConfirmDialog onConfirm)
  confirmFileDeleteAsync: () => Promise<void>;
  confirmFolderDeleteAsync: () => Promise<void>;
  // Setters for opening modals directly
  setPreviewFile: (f: FileEntry | null) => void;
  setShareTarget: (t: { id: string; type: 'file' | 'folder' } | null) => void;
  setMoveDriveFiles: (f: FileEntry[]) => void;
  setMoveTarget: (items: SelectedItem[]) => void;
  setFolderDownloadTarget: (t: { driveId: string; folderId: string; name: string } | null) => void;
  setWorkspaceTarget: (f: FileEntry | null) => void;
  // Close handlers (reset state)
  closeRename: () => void;
  closeFileDelete: () => void;
  closeFolderDelete: () => void;
  // The toggleStar callback (unified for files + folders)
  toggleStar: ReturnType<typeof useToggleStar>;
}

/**
 * Shared hook: all modal state + handlers for file/folder item interactions.
 *
 * Used by FilesPage, StarredPage, ExternalPage, and WorkspacesPage to eliminate
 * 4-way duplication of ~80 lines of state + handlers + modal wiring.
 *
 * The hook owns the mutation hooks (deleteFile, renameFile, etc.) and calls
 * `onRefresh` after each mutation so the page can re-fetch its own data
 * (pages use different data-loading strategies: react-query vs local state).
 */
export function useItemModals(options: UseItemModalsOptions = {}): UseItemModalsResult {
  const { onRefresh, allFolders = [], files = [] } = options;
  const { clearSelection, toggleSelection } = useSelectionStore();
  const { setIsInfoPanelOpen } = useUIStore();

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(
    null,
  );
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [moveTarget, setMoveTarget] = useState<SelectedItem[]>([]);
  const [folderDownloadTarget, setFolderDownloadTarget] = useState<{
    driveId: string;
    folderId: string;
    name: string;
  } | null>(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<FileEntry | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [confirmFileDelete, setConfirmFileDelete] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{
    id: string;
    name: string;
    driveId: string;
  } | null>(null);

  const deleteFileMut = useDeleteFile();
  const renameFileMut = useRenameFile();
  const deleteDriveFolderMut = useDeleteDriveFolder();
  const renameDriveFolderMut = useRenameDriveFolder();
  const toggleStar = useToggleStar();

  const handleDeleteFile = useCallback(
    (id: string, name?: string) => {
      const resolvedName = name ?? files.find((f) => f.id === id)?.name ?? 'this file';
      setConfirmFileDelete({ id, name: resolvedName });
    },
    [files],
  );

  const handleDeleteFolder = useCallback(
    (driveId: string, folderId: string, name?: string) => {
      const resolvedName =
        name ?? allFolders.find((f) => getFolderIdentifier(f) === folderId)?.name ?? 'this folder';
      setConfirmFolderDelete({ id: folderId, name: resolvedName, driveId });
    },
    [allFolders],
  );

  const handleRenameFileRequest = useCallback((fileId: string, currentName: string) => {
    setRenameTarget({ kind: 'file', id: fileId, currentName });
  }, []);

  const handleRenameFolderRequest = useCallback(
    (driveId: string, folderId: string, currentName: string) => {
      setRenameTarget({ kind: 'folder', driveId, folderId, currentName });
    },
    [],
  );

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      if (renameTarget.kind === 'file') {
        await renameFileMut.mutateAsync({ fileId: renameTarget.id, name: newName });
      } else {
        await renameDriveFolderMut.mutateAsync({
          driveId: renameTarget.driveId,
          folderId: renameTarget.folderId,
          name: newName,
        });
      }
      setRenameTarget(null);
      onRefresh?.();
    },
    [renameTarget, renameFileMut, renameDriveFolderMut, onRefresh],
  );

  const handleViewInfo = useCallback(
    (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => {
      clearSelection();
      toggleSelection({ type, item } as SelectedItem);
      setIsInfoPanelOpen(true);
    },
    [clearSelection, toggleSelection, setIsInfoPanelOpen],
  );

  const confirmFileDeleteAsync = useCallback(async () => {
    if (!confirmFileDelete) return;
    await deleteFileMut.mutateAsync(confirmFileDelete.id);
    setConfirmFileDelete(null);
    onRefresh?.();
  }, [confirmFileDelete, deleteFileMut, onRefresh]);

  const confirmFolderDeleteAsync = useCallback(async () => {
    if (!confirmFolderDelete) return;
    await deleteDriveFolderMut.mutateAsync({
      driveId: confirmFolderDelete.driveId,
      folderId: confirmFolderDelete.id,
    });
    setConfirmFolderDelete(null);
    onRefresh?.();
  }, [confirmFolderDelete, deleteDriveFolderMut, onRefresh]);

  return {
    previewFile,
    shareTarget,
    moveDriveFiles,
    moveTarget,
    folderDownloadTarget,
    workspaceTarget,
    renameTarget,
    confirmFileDelete,
    confirmFolderDelete,
    isRenaming: renameFileMut.isPending || renameDriveFolderMut.isPending,
    isDeletingFile: deleteFileMut.isPending,
    isDeletingFolder: deleteDriveFolderMut.isPending,
    handleDeleteFile,
    handleDeleteFolder,
    handleRenameFileRequest,
    handleRenameFolderRequest,
    handleRenameConfirm,
    handleViewInfo,
    confirmFileDeleteAsync,
    confirmFolderDeleteAsync,
    setPreviewFile,
    setShareTarget,
    setMoveDriveFiles,
    setMoveTarget,
    setFolderDownloadTarget,
    setWorkspaceTarget,
    closeRename: () => setRenameTarget(null),
    closeFileDelete: () => setConfirmFileDelete(null),
    closeFolderDelete: () => setConfirmFolderDelete(null),
    toggleStar,
  };
}
