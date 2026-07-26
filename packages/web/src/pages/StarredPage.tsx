import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileGrid } from '../components/files/FileGrid';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { MoveModal } from '../components/MoveModal';
import { FolderDownloadModal } from '../components/FolderDownloadModal';
import { RenameDialog } from '../components/RenameDialog';
import { AddToWorkspaceModal } from '../components/workspaces/AddToWorkspaceModal';
import { DeleteConfirmDialogs } from '../components/files/DeleteConfirmDialogs';
import { api } from '../lib/api';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { qk } from '../lib/queryKeys';
import { useSelectionStore, type SelectedItem } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { useToastStore } from '../stores/useToastStore';
import type { FileEntry, DriveFolder, WorkspaceFolder } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { useToggleStar, useDeleteFile, useRenameFile } from '../hooks/useFileMutations';
import { useDeleteDriveFolder, useRenameDriveFolder } from '../hooks/useFolderMutations';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { Star } from 'lucide-react';

type RenameTarget =
  | { kind: 'file'; id: string; currentName: string }
  | { kind: 'folder'; driveId: string; folderId: string; currentName: string }
  | null;

export function StarredPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { clearSelection, toggleSelection, selectedItems } = useSelectionStore();
  const { setIsInfoPanelOpen } = useUIStore();
  const { addToast } = useToastStore();

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [moveTarget, setMoveTarget] = useState<SelectedItem[]>([]);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<FileEntry | null>(null);
  const [folderDownloadTarget, setFolderDownloadTarget] = useState<{ driveId: string; folderId: string; name: string } | null>(null);
  const [confirmFileDelete, setConfirmFileDelete] = useState<{ id: string; name: string } | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{ id: string; name: string; driveId: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.starred,
    queryFn: () => api.getStarred(),
  });

  const files = data?.files ?? [];
  const wsFolders = data?.folders ?? [];
  const driveFolders = data?.driveFolders ?? [];

  const deleteFileMut = useDeleteFile();
  const deleteDriveFolderMut = useDeleteDriveFolder();
  const renameFileMut = useRenameFile();
  const renameDriveFolderMut = useRenameDriveFolder();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.starred });
  }, [queryClient]);

  const toggleStar = useToggleStar();

  const allFolders = [...wsFolders, ...driveFolders];

  // Bug 5: Route destructive deletes through a confirmation dialog
  // instead of mutating immediately. The `name` is resolved from the loaded
  // list when FileGrid only passes the id (its `onDeleteFile` type is
  // `(id: string) => void`).
  const handleDeleteFile = (id: string, name?: string) => {
    const resolvedName = name ?? files.find((f) => f.id === id)?.name ?? 'this file';
    setConfirmFileDelete({ id, name: resolvedName });
  };
  const handleDeleteFolder = (driveId: string, folderId: string, name?: string) => {
    const resolvedName =
      name ?? allFolders.find((f) => f.id === folderId)?.name ?? 'this folder';
    setConfirmFolderDelete({ id: folderId, name: resolvedName, driveId });
  };

  // Bug 6: Wire rename context-menu actions through a RenameDialog.
  const handleRenameFile = (id: string, name: string) => {
    renameFileMut.mutate({ fileId: id, name });
  };
  const handleRenameFolder = (driveId: string, folderId: string, name: string) => {
    renameDriveFolderMut.mutate({ driveId, folderId, name });
  };
  const handleRenameFileRequest = (fileId: string, currentName: string) => {
    setRenameTarget({ kind: 'file', id: fileId, currentName });
  };
  const handleRenameFolderRequest = (driveId: string, folderId: string, currentName: string) => {
    setRenameTarget({ kind: 'folder', driveId, folderId, currentName });
  };
  const handleRenameConfirm = (newName: string) => {
    if (!renameTarget) return;
    if (renameTarget.kind === 'file') {
      handleRenameFile(renameTarget.id, newName);
    } else {
      handleRenameFolder(renameTarget.driveId, renameTarget.folderId, newName);
    }
    setRenameTarget(null);
  };

  const handleViewInfo = (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => {
    clearSelection();
    toggleSelection({ type, item } as SelectedItem);
    setIsInfoPanelOpen(true);
  };

  const getDriveInfo = useGetDriveInfo(drives);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <BulkActionBar
        onActionComplete={refresh}
        onMoveRequested={() => setMoveTarget(selectedItems)}
        onMoveDriveRequested={() => {
          const fileItems = selectedItems
            .filter((i) => i.type === 'file')
            .map((i) => i.item as FileEntry);
          setMoveDriveFiles(fileItems);
        }}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-800">Starred</h1>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : files.length > 0 || allFolders.length > 0 ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={files}
            subfolders={allFolders}
            getDriveInfo={getDriveInfo}
            isTargetShared={isTargetShared}
            viewMode="list"
            actions={{
              // Bug 7: Double-click on a folder did nothing — now navigates
              // to the appropriate view. `useItemInteractions` passes
              // driveId='virtual' for workspace folders and the real drive id
              // for Google Drive folders.
              onNavigateFolder: (folderId, driveId) => {
                if (driveId === 'virtual') {
                  navigate(`/files/${folderId}`);
                } else {
                  navigate(`/external/${folderId}?driveId=${driveId}`);
                }
              },
              onToggleStar: toggleStar,
              onPreviewFile: setPreviewFile,
              onShare: (id, type) => setShareTarget({ id, type }),
              onRenameFile: handleRenameFile,
              onRenameFolder: handleRenameFolder,
              onRenameFileRequest: handleRenameFileRequest,
              onRenameFolderRequest: handleRenameFolderRequest,
              onDeleteFile: handleDeleteFile,
              onDeleteFolder: handleDeleteFolder,
              onMoveDrive: (file) => setMoveDriveFiles([file]),
              onDownloadFolder: (driveId, folderId, name) => setFolderDownloadTarget({ driveId, folderId, name }),
              onMove: (items) => setMoveTarget(items),
              onAddToWorkspace: setWorkspaceTarget,
              onViewInfo: handleViewInfo,
            }}
          />
        </div>
      ) : (
        <EmptyState
          icon={Star}
          title="No starred items"
          description="Star files and folders to find them quickly here."
        />
      )}
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
      <ShareModal
        open={!!shareTarget}
        targetType={shareTarget?.type ?? 'file'}
        targetId={shareTarget?.id ?? ''}
        onClose={() => setShareTarget(null)}
      />
      {/* L-4: MoveDriveModal is always mounted (no conditional) so the
          Radix Dialog enter animation plays. MoveDriveModal derives its
          `open` state from `files.length > 0` internally. */}
      <MoveDriveModal
        files={moveDriveFiles}
        onClose={() => setMoveDriveFiles([])}
        onSuccess={() => {
          setMoveDriveFiles([]);
          clearSelection();
          refresh();
        }}
      />
      <MoveModal
        open={moveTarget.length > 0}
        items={moveTarget}
        driveId={drives[0]?.id ?? ''}
        onClose={() => setMoveTarget([])}
        onSuccess={() => {
          clearSelection();
          refresh();
        }}
      />
      <FolderDownloadModal
        open={folderDownloadTarget !== null}
        onClose={() => setFolderDownloadTarget(null)}
        driveId={folderDownloadTarget?.driveId}
        folderId={folderDownloadTarget?.folderId}
        folderName={folderDownloadTarget?.name ?? ''}
      />
      <AddToWorkspaceModal
        open={!!workspaceTarget}
        file={workspaceTarget ?? undefined}
        onClose={() => setWorkspaceTarget(null)}
        onSuccess={() => {
          setWorkspaceTarget(null);
          addToast('success', 'Added to workspace');
          refresh();
        }}
      />
      <RenameDialog
        open={renameTarget !== null}
        initialName={renameTarget?.currentName ?? ''}
        title={renameTarget?.kind === 'folder' ? 'Rename Folder' : 'Rename File'}
        loading={renameFileMut.isPending || renameDriveFolderMut.isPending}
        onConfirm={handleRenameConfirm}
        onClose={() => setRenameTarget(null)}
      />
      <DeleteConfirmDialogs
        mode="soft"
        confirmFile={confirmFileDelete}
        confirmFolder={confirmFolderDelete}
        fileLoading={deleteFileMut.isPending}
        folderLoading={deleteDriveFolderMut.isPending}
        onConfirmFile={async (id) => {
          await deleteFileMut.mutateAsync(id);
          setConfirmFileDelete(null);
        }}
        onConfirmFolder={async (id) => {
          // `id` here is the folderId from DeleteConfirmDialogs; the
          // matching driveId is held in the confirm state.
          if (confirmFolderDelete) {
            await deleteDriveFolderMut.mutateAsync({
              driveId: confirmFolderDelete.driveId,
              folderId: id,
            });
          }
          setConfirmFolderDelete(null);
        }}
        onCloseFile={() => setConfirmFileDelete(null)}
        onCloseFolder={() => setConfirmFolderDelete(null)}
      />
    </div>
  );
}
