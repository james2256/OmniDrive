import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileGrid } from '../components/files/FileGrid';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import { qk } from '../lib/queryKeys';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useRestoreFile, usePermanentDeleteFile } from '../hooks/useFileMutations';
import { useRestoreDriveFolder, usePermanentDeleteDriveFolder } from '../hooks/useFolderMutations';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { Trash2 } from 'lucide-react';

export function TrashPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const queryClient = useQueryClient();

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [confirmFileDelete, setConfirmFileDelete] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{ driveId: string; folderId: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.trash,
    queryFn: () => api.getTrashFiles(),
  });

  const fileResults = data?.files ?? [];
  const folderResults = data?.folders ?? [];

  const restoreFileMut = useRestoreFile();
  const permanentDeleteFileMut = usePermanentDeleteFile();
  const restoreDriveFolderMut = useRestoreDriveFolder();
  const permanentDeleteDriveFolderMut = usePermanentDeleteDriveFolder();

  const handleRestore = (fileId: string) => restoreFileMut.mutate(fileId);
  const handlePermanentDelete = (fileId: string) => setConfirmFileDelete(fileId);
  const handleRestoreFolder = (driveId: string, folderId: string) =>
    restoreDriveFolderMut.mutate({ driveId, folderId });
  const handlePermanentDeleteFolder = (driveId: string, folderId: string) =>
    setConfirmFolderDelete({ driveId, folderId });

  const getDriveInfo = useCallback(
    (driveAccountId?: string) => {
      if (!driveAccountId) return { drive: null, index: 0 };
      const index = drives.findIndex((d) => d.id === driveAccountId);
      if (index === -1) return { drive: drives[0] || null, index: 0 };
      return { drive: drives[index], index };
    },
    [drives],
  );

  const hasItems = fileResults.length > 0 || folderResults.length > 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <BulkActionBar
        isTrashView={true}
        onActionComplete={() => queryClient.invalidateQueries({ queryKey: qk.trash })}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Trash</h1>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : hasItems ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={fileResults}
            subfolders={folderResults}
            getDriveInfo={getDriveInfo}
            isTargetShared={() => false}
            viewMode="list"
            isTrashView={true}
            actions={{
              onPreviewFile: setPreviewFile,
              onRestore: handleRestore,
              onPermanentDelete: handlePermanentDelete,
              onRestoreFolder: handleRestoreFolder,
              onPermanentDeleteFolder: handlePermanentDeleteFolder,
            }}
          />
        </div>
      ) : (
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          description="Deleted files and folders will appear here."
        />
      )}
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
      <ConfirmDialog
        open={confirmFileDelete !== null}
        title="Permanently Delete File"
        message="Permanently delete this file? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={permanentDeleteFileMut.isPending}
        onConfirm={() => {
          if (confirmFileDelete) permanentDeleteFileMut.mutate(confirmFileDelete);
          setConfirmFileDelete(null);
        }}
        onClose={() => setConfirmFileDelete(null)}
      />
      <ConfirmDialog
        open={confirmFolderDelete !== null}
        title="Permanently Delete Folder"
        message="Permanently delete this folder and ALL its contents? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={permanentDeleteDriveFolderMut.isPending}
        onConfirm={() => {
          if (confirmFolderDelete) permanentDeleteDriveFolderMut.mutate(confirmFolderDelete);
          setConfirmFolderDelete(null);
        }}
        onClose={() => setConfirmFolderDelete(null)}
      />
    </div>
  );
}
