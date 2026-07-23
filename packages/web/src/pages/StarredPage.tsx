import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileGrid } from '../components/files/FileGrid';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import { qk } from '../lib/queryKeys';
import { useSelectionStore } from '../stores/useSelectionStore';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { useStarFile, useUnstarFile, useDeleteFile } from '../hooks/useFileMutations';
import { useStarFolder, useUnstarFolder, useDeleteDriveFolder } from '../hooks/useFolderMutations';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { Star } from 'lucide-react';

export function StarredPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const queryClient = useQueryClient();

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const selectedItems = useSelectionStore((s) => s.selectedItems);

  const { data, isLoading } = useQuery({
    queryKey: qk.starred,
    queryFn: () => api.getStarred(),
  });

  const files = data?.files ?? [];
  const wsFolders = data?.folders ?? [];
  const driveFolders = data?.driveFolders ?? [];

  const starFileMut = useStarFile();
  const unstarFileMut = useUnstarFile();
  const starFolderMut = useStarFolder();
  const unstarFolderMut = useUnstarFolder();
  const deleteFileMut = useDeleteFile();
  const deleteDriveFolderMut = useDeleteDriveFolder();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.starred });
  }, [queryClient]);

  const handleToggleStar = useCallback(
    (id: string, type: 'file' | 'folder', currentStarStatus: boolean, driveId?: string) => {
      if (type === 'file') {
        if (currentStarStatus) { unstarFileMut.mutate(id); } else { starFileMut.mutate(id); }
      } else if (driveId) {
        if (currentStarStatus) { unstarFolderMut.mutate({ id, driveId }); } else { starFolderMut.mutate({ id, driveId }); }
      } else {
        if (currentStarStatus) { unstarFolderMut.mutate({ id }); } else { starFolderMut.mutate({ id }); }
      }
    },
    [starFileMut, unstarFileMut, starFolderMut, unstarFolderMut],
  );

  const handleDeleteFile = (id: string) => deleteFileMut.mutate(id);
  const handleDeleteFolder = (driveId: string, folderId: string) =>
    deleteDriveFolderMut.mutate({ driveId, folderId });

  const getDriveInfo = useCallback(
    (driveAccountId?: string) => {
      if (!driveAccountId) return { drive: null, index: 0 };
      const index = drives.findIndex((d) => d.id === driveAccountId);
      if (index === -1) return { drive: drives[0] || null, index: 0 };
      return { drive: drives[index], index };
    },
    [drives],
  );

  const allFolders = [...wsFolders, ...driveFolders];

  return (
    <div className="p-2 sm:p-6 space-y-4 sm:space-y-6">
      <BulkActionBar
        onActionComplete={refresh}
        onMoveDriveRequested={() => {
          const fileItems = selectedItems
            .filter((i) => i.type === 'file')
            .map((i) => i.item as FileEntry);
          setMoveDriveFiles(fileItems);
        }}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Starred</h1>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : files.length > 0 || allFolders.length > 0 ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={files}
            subfolders={allFolders}
            getDriveInfo={getDriveInfo}
            isTargetShared={() => false}
            viewMode="list"
            actions={{
              onToggleStar: handleToggleStar,
              onPreviewFile: setPreviewFile,
              onShare: (id, type) => setShareTarget({ id, type }),
              onDeleteFile: handleDeleteFile,
              onDeleteFolder: handleDeleteFolder,
              onMoveDrive: (file) => setMoveDriveFiles([file]),
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
      {moveDriveFiles.length > 0 && (
        <MoveDriveModal
          files={moveDriveFiles}
          onClose={() => setMoveDriveFiles([])}
          onSuccess={() => setMoveDriveFiles([])}
        />
      )}
    </div>
  );
}
