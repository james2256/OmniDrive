import { useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { FileGrid } from '../components/files/FileGrid';
import { Breadcrumb } from '../components/Breadcrumb';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { FilesToolbar } from '../components/layout/FilesToolbar';
import { ItemModals } from '../components/files/ItemModals';
import { ErrorState } from '../components/ErrorState';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { FolderInput } from 'lucide-react';
import { drivesApi } from '../lib/api/drives';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useItemModals } from '../hooks/useItemModals';
import type {
  FileEntry,
  DriveFolder,
  BreadcrumbItem,
  DriveFolderContents,
  PaginationMeta,
} from '../types';
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
    DriveFolderContents & { pagination: PaginationMeta },
    Error,
    {
      pages: (DriveFolderContents & { pagination: PaginationMeta })[];
      pageParams: (string | undefined)[];
    },
    readonly ['external'],
    string | undefined
  >({
    queryKey: qk.external,
    queryFn: ({ pageParam }) => drivesApi.getExternal(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.pagination?.nextCursor ?? undefined,
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
    ? (externalInfinite.data?.pages.flatMap((p) => p.subfolders) ?? [])
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
    <div className="p-4 sm:p-6 space-y-2">
      <PageHeader
        title={
          folderId ? (breadcrumb[breadcrumb.length - 1]?.name ?? 'Folder') : 'My External Items'
        }
        icon={FolderInput}
        description={folderId ? undefined : 'Items you own that live outside My Drive'}
      />
      <FilesToolbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        viewMode={viewMode}
        setViewMode={setViewMode}
        isInfoPanelOpen={isInfoPanelOpen}
        toggleInfoPanel={toggleInfoPanel}
        bulkActionBar={
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
        }
        breadcrumb={<Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />}
      />

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : (isTopLevel ? externalInfinite.error : folderQuery.error) ? (
        <ErrorState
          onRetry={() => (isTopLevel ? externalInfinite.refetch() : folderQuery.refetch())}
        />
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
        <EmptyState
          icon={FolderInput}
          title="No external items"
          description="Items you own outside My Drive will appear here"
        />
      )}

      {/* Shared file/folder modals (preview, share, rename, delete, move, etc.) */}
      <ItemModals
        modals={itemModals}
        driveId={driveIdParam || drives[0]?.id || ''}
        onRefresh={refresh}
      />
    </div>
  );
}
