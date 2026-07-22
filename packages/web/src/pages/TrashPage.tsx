import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import { qk } from '../lib/queryKeys';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { useRestoreFile, usePermanentDeleteFile } from '../hooks/useFileMutations';
import { useRestoreDriveFolder, usePermanentDeleteDriveFolder } from '../hooks/useFolderMutations';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { Trash2 } from 'lucide-react';

export function TrashPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

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
  const handlePermanentDelete = (fileId: string) => permanentDeleteFileMut.mutate(fileId);
  const handleRestoreFolder = (driveId: string, folderId: string) =>
    restoreDriveFolderMut.mutate({ driveId, folderId });
  const handlePermanentDeleteFolder = (driveId: string, folderId: string) =>
    permanentDeleteDriveFolderMut.mutate({ driveId, folderId });

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
    </div>
  );
}
