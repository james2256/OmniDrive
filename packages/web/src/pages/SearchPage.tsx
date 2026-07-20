import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import { useSharedLinks } from '../hooks/useSharedLinks';
import { qk } from '../lib/queryKeys';
import type { FileEntry } from '../types';

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';

  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { addToast } = useToastStore();
  const queryClient = useQueryClient();
  const { data: sharedLinks = [] } = useSharedLinks();

  const [shareTarget, setShareTarget] = useState<{ id: string, type: 'file' | 'folder' } | null>(null);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const isTargetShared = useCallback(
    (id: string, type: 'file' | 'folder') =>
      sharedLinks.some((link) => link.targetId === id && link.targetType === type),
    [sharedLinks],
  );

  const { data: results = [], isLoading } = useQuery({
    queryKey: qk.search(query),
    queryFn: async () => {
      if (!query) return [];
      const data = await api.searchFiles(query);
      return data.files;
    },
    enabled: !!query,
  });

  const handleToggleStar = useCallback(
    (id: string, type: 'file' | 'folder', currentStarStatus: boolean) => {
      const promise =
        type === 'file'
          ? currentStarStatus
            ? api.unstarFile(id)
            : api.starFile(id)
          : currentStarStatus
            ? api.unstarFolder(id)
            : api.starFolder(id);

      promise
        .then(() => {
          addToast(
            'success',
            `${type === 'file' ? 'File' : 'Folder'} ${currentStarStatus ? 'unstarred' : 'starred'}`,
          );
          queryClient.invalidateQueries({ queryKey: qk.search(query) });
        })
        .catch(() => addToast('error', 'Failed to update star status'));
    },
    [addToast, query, queryClient],
  );

  const getDriveInfo = useCallback(
    (driveAccountId?: string | null) => {
      if (!driveAccountId) return { drive: null, index: 0 };
      const index = drives.findIndex((d) => d.id === driveAccountId);
      if (index === -1) return { drive: drives[0] || null, index: 0 };
      return { drive: drives[index], index };
    },
    [drives],
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-800">
          {query ? `Search results for "${query}"` : 'Search'}
        </h1>
      </div>

      {!query ? (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">Please enter a search term.</p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : results.length > 0 ? (
        <div className="bg-card rounded-xl border border-stone-200 overflow-hidden">
          <FileGrid
            files={results}
            subfolders={[]}
            getDriveInfo={getDriveInfo}
            isTargetShared={isTargetShared}
            viewMode="list"
            actions={{
              onShare: (id, type) => setShareTarget({ id, type }),
              onMoveDrive: (file) => setMoveDriveFiles([file]),
              onPreviewFile: setPreviewFile,
              onToggleStar: handleToggleStar,
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">No files found matching '{query}'.</p>
        </div>
      )}

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
          onSuccess={() => {
            setMoveDriveFiles([]);
            queryClient.invalidateQueries({ queryKey: qk.search(query) });
          }}
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
