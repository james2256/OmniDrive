import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';

const starredKeys = {
  all: ['starred'] as const,
};

interface ToggleStarArgs {
  id: string;
  type: 'file' | 'folder';
  currentStarStatus: boolean;
  driveId?: string;
}

export function StarredPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { addToast } = useToastStore();
  const queryClient = useQueryClient();

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: starredKeys.all,
    queryFn: () => api.getStarred(),
  });

  const files = data?.files ?? [];
  const wsFolders = data?.folders ?? [];
  const driveFolders = data?.driveFolders ?? [];

  const toggleStarMutation = useMutation({
    mutationFn: async ({ id, type, currentStarStatus, driveId }: ToggleStarArgs) => {
      if (type === 'file') {
        return currentStarStatus ? api.unstarFile(id) : api.starFile(id);
      }
      if (driveId) {
        return currentStarStatus
          ? api.unstarDriveFolder(driveId, id)
          : api.starDriveFolder(driveId, id);
      }
      return currentStarStatus ? api.unstarFolder(id) : api.starFolder(id);
    },
    onSuccess: (_data, variables) => {
      addToast(
        'success',
        `${variables.type === 'file' ? 'File' : 'Folder'} ${variables.currentStarStatus ? 'unstarred' : 'starred'}`,
      );
      queryClient.invalidateQueries({ queryKey: starredKeys.all });
    },
    onError: () => addToast('error', 'Failed to update star status'),
  });

  const handleToggleStar = useCallback(
    (id: string, type: 'file' | 'folder', currentStarStatus: boolean, driveId?: string) => {
      toggleStarMutation.mutate({ id, type, currentStarStatus, driveId });
    },
    [toggleStarMutation],
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

  // Combine workspace folders and Drive folders into a single list for FileGrid.
  const allFolders = [...wsFolders, ...driveFolders];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-800">Starred</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : files.length > 0 || allFolders.length > 0 ? (
        <div className="bg-card rounded-xl border border-stone-200 overflow-hidden">
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
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">No starred items found.</p>
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
