import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import { qk } from '../lib/queryKeys';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { useStarFile, useUnstarFile } from '../hooks/useFileMutations';
import { useStarFolder, useUnstarFolder } from '../hooks/useFolderMutations';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { Star } from 'lucide-react';

export function StarredPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

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
    <div className="p-4 sm:p-6 space-y-6">
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
    </div>
  );
}
