import { useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { List, LayoutGrid, Info, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { FileGrid } from '../components/files/FileGrid';
import { Breadcrumb } from '../components/Breadcrumb';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { ItemModals } from '../components/files/ItemModals';
import { drivesApi } from '../lib/api/drives';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useItemModals } from '../hooks/useItemModals';
import type { FileEntry, DriveFolder, BreadcrumbItem } from '../types';
import { qk } from '../lib/queryKeys';
import type { SelectedItem } from '../stores/useSelectionStore';
import { useSelectionStore, useClearSelectionOnRouteChange } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';

export function ExternalPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId') ?? null;
  const navigate = useNavigate();

  // Clear selection when navigating between external folders/drives.
  useClearSelectionOnRouteChange([folderId, driveIdParam]);

  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const { selectedItems } = useSelectionStore();
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel } = useUIStore();

  const [searchQuery, setSearchQuery] = useState('');

  // Top-level External page (no folderId) uses useInfiniteQuery for cursor
  // pagination. Folder drill-in uses useQuery (live Google API, no pagination).
  const isTopLevel = !folderId;

  const externalInfinite = useInfiniteQuery<
    { files: FileEntry[]; folders: DriveFolder[]; hasMore: boolean; nextCursor: string | null },
    Error,
    {
      pages: {
        files: FileEntry[];
        folders: DriveFolder[];
        hasMore: boolean;
        nextCursor: string | null;
      }[];
      pageParams: (string | undefined)[];
    },
    readonly ['external'],
    string | undefined
  >({
    queryKey: qk.external,
    queryFn: ({ pageParam }) => drivesApi.getExternal(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isTopLevel,
  });

  const folderQuery = useQuery({
    queryKey: qk.externalFolder(driveIdParam ?? '', folderId ?? ''),
    queryFn: async () => {
      if (driveIdParam && folderId) {
        const data = await drivesApi.getExternalFolderContents(driveIdParam, folderId);
        return {
          subfolders: data.subfolders ?? [],
          files: data.files ?? [],
          breadcrumb: [
            { id: 'root', name: 'My External Items' },
            ...(data.breadcrumb ?? [{ id: folderId, name: data.folder?.name ?? 'Folder' }]),
          ] as BreadcrumbItem[],
        };
      }
      throw new Error('Missing drive information for folder');
    },
    enabled: !isTopLevel && !!driveIdParam && !!folderId,
  });

  // Derive subfolders/files/breadcrumb from whichever query is active.
  const subfolders: DriveFolder[] = isTopLevel
    ? (externalInfinite.data?.pages[0]?.folders ?? [])
    : (folderQuery.data?.subfolders ?? []);
  const files: FileEntry[] = isTopLevel
    ? (externalInfinite.data?.pages.flatMap((p) => p.files) ?? [])
    : (folderQuery.data?.files ?? []);
  const breadcrumb: BreadcrumbItem[] = isTopLevel
    ? [{ id: 'root', name: 'My External Items' }]
    : (folderQuery.data?.breadcrumb ?? [{ id: 'root', name: 'My External Items' }]);
  const isLoading = isTopLevel ? externalInfinite.isLoading : folderQuery.isLoading;
  const hasMore = isTopLevel ? externalInfinite.hasNextPage : false;

  const filteredSubfolders = subfolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const refresh = useCallback(() => {
    // Invalidate both top-level and folder queries — ExternalPage uses either
    // depending on whether folderId is present.
    externalInfinite.refetch();
    if (folderId) folderQuery.refetch();
  }, [externalInfinite, folderId, folderQuery]);

  // Shared modal state + handlers for file/folder item interactions
  const itemModals = useItemModals({
    onRefresh: refresh,
    allFolders: subfolders,
    files,
  });

  const getDriveInfo = useGetDriveInfo(drives);

  return (
    <div className="flex flex-col h-full w-full">
      <BulkActionBar
        onActionComplete={() => refresh()}
        onMoveRequested={() => itemModals.setMoveTarget(selectedItems)}
        onWorkspaceRequested={() =>
          itemModals.setWorkspaceTarget(selectedItems[0].item as FileEntry)
        }
        onMoveDriveRequested={() => {
          const fileItems = selectedItems
            .filter((i) => i.type === 'file')
            .map((i) => i.item as FileEntry);
          itemModals.setMoveDriveFiles(fileItems);
        }}
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-4 pt-4 mb-4">
          <div className="flex gap-2 items-center order-1 sm:order-2 sm:ml-auto w-full sm:w-auto">
            <div className="relative flex-1 sm:w-48 sm:flex-initial flex-shrink-0 sm:flex-shrink">
              <input
                type="text"
                placeholder="Filter..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3 pr-8 py-2 text-sm border border-slate-400 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              {searchQuery && (
                <Button
                  type="button"
                  variant="ghost"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 hover:bg-transparent p-1"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                >
                  <X size={14} />
                </Button>
              )}
            </div>

            <div className="flex items-center border border-slate-400 rounded-md overflow-hidden bg-card flex-shrink-0">
              <Button
                variant="ghost"
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                title="List layout"
                aria-label="List layout"
              >
                <List size={18} />
              </Button>
              <Button
                variant="ghost"
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                title="Grid layout"
                aria-label="Grid layout"
              >
                <LayoutGrid size={18} />
              </Button>
            </div>

            <Button
              variant="ghost"
              onClick={toggleInfoPanel}
              className={`p-2 rounded-full flex-shrink-0 ${isInfoPanelOpen ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100'}`}
              title="View details"
              aria-label="View details"
            >
              <Info size={20} />
            </Button>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden order-2 sm:order-1">
            <Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : filteredSubfolders.length > 0 || filteredFiles.length > 0 ? (
          <>
            <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
              <FileGrid
                files={filteredFiles}
                subfolders={filteredSubfolders}
                getDriveInfo={getDriveInfo}
                isTargetShared={isTargetShared}
                errorDrives={new Set<string>()}
                actions={{
                  onNavigateFolder: (id: string, driveId: string) =>
                    navigate(`/external/${id}?driveId=${driveId}`),
                  onPreviewFile: itemModals.setPreviewFile,
                  onShare: (id: string, type: 'file' | 'folder') =>
                    itemModals.setShareTarget({ id, type }),
                  onRenameFileRequest: itemModals.handleRenameFileRequest,
                  onRenameFolderRequest: itemModals.handleRenameFolderRequest,
                  onDeleteFile: itemModals.handleDeleteFile,
                  onDeleteFolder: itemModals.handleDeleteFolder,
                  onDownloadFolder: (driveId: string, folderId: string, name: string) =>
                    itemModals.setFolderDownloadTarget({ driveId, folderId, name }),
                  onMove: (items: SelectedItem[]) => itemModals.setMoveTarget(items),
                  onViewInfo: itemModals.handleViewInfo,
                  onToggleStar: itemModals.toggleStar,
                }}
              />
            </div>
            {hasMore && (
              <div className="flex justify-center mt-4">
                <Button
                  variant="ghost"
                  onClick={() => externalInfinite.fetchNextPage()}
                  disabled={externalInfinite.isFetchingNextPage}
                  className="text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20"
                >
                  {externalInfinite.isFetchingNextPage ? 'Loading...' : 'Load More'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <p className="text-lg">No external items found.</p>
          </div>
        )}
      </div>

      {/* Shared file/folder modals (preview, share, rename, delete, move, etc.) */}
      <ItemModals
        modals={itemModals}
        driveId={driveIdParam || drives[0]?.id || ''}
        onRefresh={refresh}
      />
    </div>
  );
}
