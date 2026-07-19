import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';

const trashKeys = {
  all: ['trash'] as const,
};

export function TrashPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { addToast } = useToastStore();
  const queryClient = useQueryClient();

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: trashKeys.all,
    queryFn: () => api.getTrashFiles(),
  });

  const fileResults = data?.files ?? [];
  const folderResults = data?.folders ?? [];

  const invalidateTrash = () => queryClient.invalidateQueries({ queryKey: trashKeys.all });

  const handleRestore = async (fileId: string) => {
    try {
      await api.restoreFile(fileId);
      addToast('success', 'File restored successfully');
      invalidateTrash();
    } catch {
      addToast('error', 'Failed to restore file');
    }
  };

  const handlePermanentDelete = async (fileId: string) => {
    try {
      await api.deleteFilePermanent(fileId);
      addToast('success', 'File permanently deleted');
      invalidateTrash();
    } catch {
      addToast('error', 'Failed to permanently delete file');
    }
  };

  const handleRestoreFolder = async (driveId: string, folderId: string) => {
    try {
      await api.restoreDriveFolder(driveId, folderId);
      addToast('success', 'Folder restored successfully');
      invalidateTrash();
    } catch {
      addToast('error', 'Failed to restore folder');
    }
  };

  const handlePermanentDeleteFolder = async (driveId: string, folderId: string) => {
    try {
      await api.deleteDriveFolderPermanent(driveId, folderId);
      addToast('success', 'Folder permanently deleted');
      invalidateTrash();
    } catch {
      addToast('error', 'Failed to permanently delete folder');
    }
  };

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
        <h1 className="text-2xl font-semibold text-stone-800">Trash</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : hasItems ? (
        <div className="bg-card rounded-xl border border-stone-200 overflow-hidden">
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
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">Your trash is empty.</p>
        </div>
      )}
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}
