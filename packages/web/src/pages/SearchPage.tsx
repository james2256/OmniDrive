import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { FileGrid } from '../components/files/FileGrid';
import { useItemModals } from '../hooks/useItemModals';
import { ItemModals } from '../components/files/ItemModals';
import { PageHeader } from '../components/layout/PageHeader';
import { filesApi } from '../lib/api/files';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useToggleStar } from '../hooks/useFileMutations';
import { qk } from '../lib/queryKeys';
import { ListSkeleton } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const metadataKey = searchParams.get('metadataKey') || null;
  const metadataValue = searchParams.get('metadataValue') || null;
  const metadata = metadataKey && metadataValue ? { [metadataKey]: metadataValue } : null;

  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { data: sharedLinks = [] } = useSharedLinks();

  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const toggleStar = useToggleStar();

  const {
    data: searchResults,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: qk.search(query),
    queryFn: async () => {
      if (!query) return null;
      return filesApi.searchFiles(query, undefined, metadata);
    },
    enabled: !!query,
  });

  const fileResults = searchResults?.files ?? [];
  const folderResults = searchResults?.subfolders ?? [];

  const getDriveInfo = useGetDriveInfo(drives);

  const itemModals = useItemModals({
    onRefresh: refetch,
    allFolders: [],
    files: fileResults,
  });

  return (
    <div className="p-4 sm:p-6 space-y-2">
      <PageHeader title={query ? `Search results for "${query}"` : 'Search'} icon={Search} />

      {!query ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <p className="text-lg">Please enter a search term.</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : fileResults.length > 0 || folderResults.length > 0 ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={fileResults}
            subfolders={folderResults}
            getDriveInfo={getDriveInfo}
            isTargetShared={isTargetShared}
            actions={{
              onShare: (id, type) => itemModals.setShareTarget({ id, type }),
              onMoveDrive: (file) => itemModals.setMoveDriveFiles([file]),
              onPreviewFile: itemModals.setPreviewFile,
              onToggleStar: toggleStar,
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <p className="text-lg">No results found matching '{query}'.</p>
        </div>
      )}

      <ItemModals modals={itemModals} driveId={drives[0]?.id ?? ''} onRefresh={refetch} />
    </div>
  );
}
