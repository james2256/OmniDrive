import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { FilesToolbar } from '../components/layout/FilesToolbar';
import { FileGrid } from '../components/files/FileGrid';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { ItemModals } from '../components/files/ItemModals';
import { filesApi } from '../lib/api/files';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useItemModals } from '../hooks/useItemModals';
import { qk } from '../lib/queryKeys';
import { useSelectionStore } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import type { FileEntry } from '../types';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Star } from 'lucide-react';

export function StarredPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedItems } = useSelectionStore();
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.starred,
    queryFn: () => filesApi.getStarred(),
  });

  const files = data?.files ?? [];
  const wsFolders = data?.folders ?? [];
  const driveFolders = data?.driveFolders ?? [];
  const allFolders = [...wsFolders, ...driveFolders];

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredFolders = allFolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.starred });
  }, [queryClient]);

  const getDriveInfo = useGetDriveInfo(drives);

  // Shared modal state + handlers for file/folder item interactions
  const itemModals = useItemModals({
    onRefresh: refresh,
    allFolders,
    files,
  });

  return (
    <div className="p-4 sm:p-6 space-y-2">
      <PageHeader
        title="Starred"
        icon={Star}
        description="Files and folders you've starred for quick access"
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
            onActionComplete={refresh}
            onMoveRequested={() => itemModals.setMoveTarget(selectedItems)}
            onMoveDriveRequested={() => {
              const fileItems = selectedItems
                .filter((i) => i.type === 'file')
                .map((i) => i.item as FileEntry);
              itemModals.setMoveDriveFiles(fileItems);
            }}
          />
        }
      />

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : filteredFiles.length > 0 || filteredFolders.length > 0 ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={filteredFiles}
            subfolders={filteredFolders}
            getDriveInfo={getDriveInfo}
            isTargetShared={isTargetShared}
            viewMode={viewMode}
            actions={{
              // Double-click on a folder navigates to the appropriate view.
              // driveId='virtual' for workspace folders, real drive id for
              // Google Drive folders.
              onNavigateFolder: (folderId: string, driveId: string) => {
                if (driveId === 'virtual') {
                  navigate(`/files/${folderId}`);
                } else {
                  navigate(`/external/${folderId}?driveId=${driveId}`);
                }
              },
              onToggleStar: itemModals.toggleStar,
              onPreviewFile: itemModals.setPreviewFile,
              onShare: (id: string, type: 'file' | 'folder') =>
                itemModals.setShareTarget({ id, type }),
              onRenameFileRequest: itemModals.handleRenameFileRequest,
              onRenameFolderRequest: itemModals.handleRenameFolderRequest,
              onDeleteFile: itemModals.handleDeleteFile,
              onDeleteFolder: itemModals.handleDeleteFolder,
              onMoveDrive: (file: FileEntry) => itemModals.setMoveDriveFiles([file]),
              onDownloadFolder: (driveId: string, folderId: string, name: string) =>
                itemModals.setFolderDownloadTarget({ driveId, folderId, name }),
              onMove: (items) => itemModals.setMoveTarget(items),
              onAddToWorkspace: itemModals.setWorkspaceTarget,
              onViewInfo: itemModals.handleViewInfo,
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
      <ItemModals modals={itemModals} driveId={drives[0]?.id ?? ''} onRefresh={refresh} />
    </div>
  );
}
