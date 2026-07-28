import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileGrid } from '../components/files/FileGrid';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { api } from '../lib/api';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useToggleStar } from '../hooks/useFileMutations';
import { qk } from '../lib/queryKeys';
import { invalidateAfterFileMutation } from '../lib/invalidate';
import type { FileEntry } from '../types';

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';

  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const queryClient = useQueryClient();
  const { data: sharedLinks = [] } = useSharedLinks();

  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(
    null,
  );
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const toggleStar = useToggleStar();

  const { data: searchResults, isLoading } = useQuery({
    queryKey: qk.search(query),
    queryFn: async () => {
      if (!query) return null;
      return api.searchFiles(query);
    },
    enabled: !!query,
  });

  const fileResults = searchResults?.files ?? [];
  const folderResults = [...(searchResults?.driveFolders ?? []), ...(searchResults?.folders ?? [])];

  const getDriveInfo = useGetDriveInfo(drives);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">
          {query ? `Search results for "${query}"` : 'Search'}
        </h1>
      </div>

      {!query ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <p className="text-lg">Please enter a search term.</p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : fileResults.length > 0 || folderResults.length > 0 ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={fileResults}
            subfolders={folderResults}
            getDriveInfo={getDriveInfo}
            isTargetShared={isTargetShared}
            viewMode="list"
            actions={{
              onShare: (id, type) => setShareTarget({ id, type }),
              onMoveDrive: (file) => setMoveDriveFiles([file]),
              onPreviewFile: setPreviewFile,
              onToggleStar: toggleStar,
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <p className="text-lg">No results found matching '{query}'.</p>
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
            invalidateAfterFileMutation(queryClient);
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
