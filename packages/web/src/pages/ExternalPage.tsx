import { useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { List, LayoutGrid, Info, X } from 'lucide-react';
import { FileGrid } from '../components/files/FileGrid';
import { Breadcrumb } from '../components/Breadcrumb';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { MoveModal } from '../components/MoveModal';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { FolderDownloadModal } from '../components/FolderDownloadModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RenameDialog';
import { AddToWorkspaceModal } from '../components/workspaces/AddToWorkspaceModal';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import { useSharedLinks } from '../hooks/useSharedLinks';
import type { FileEntry, DriveFolder, BreadcrumbItem, WorkspaceFolder } from '../types';
import { qk } from '../lib/queryKeys';
import type { SelectedItem } from '../stores/useSelectionStore';
import { useSelectionStore, useClearSelectionOnRouteChange } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { useToastStore } from '../stores/useToastStore';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { useDeleteFile, useRenameFile, useStarFile, useUnstarFile } from '../hooks/useFileMutations';
import { useDeleteDriveFolder, useRenameDriveFolder, useStarFolder, useUnstarFolder } from '../hooks/useFolderMutations';

export function ExternalPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId') ?? null;
  const navigate = useNavigate();

  // Bug 2: clear selection when navigating between external folders/drives.
  useClearSelectionOnRouteChange([folderId, driveIdParam]);

  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useCallback(
    (id: string, type: 'file' | 'folder') =>
      sharedLinks.some((link) => link.targetId === id && link.targetType === type),
    [sharedLinks],
  );
  const { selectedItems, clearSelection, toggleSelection } = useSelectionStore();
  const queryClient = useQueryClient();
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel, setIsInfoPanelOpen } = useUIStore();
  const { addToast } = useToastStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveTarget, setMoveTarget] = useState<SelectedItem[]>([]);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [folderDownloadTarget, setFolderDownloadTarget] = useState<{ driveId: string; folderId: string; name: string } | null>(null);
  const [confirmFileDelete, setConfirmFileDelete] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{ driveId: string; folderId: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    | { kind: 'file'; id: string; currentName: string }
    | { kind: 'folder'; driveId: string; folderId: string; currentName: string }
    | null
  >(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<FileEntry | null>(null);

  // Top-level External page (no folderId) uses useInfiniteQuery for cursor
  // pagination. Folder drill-in uses useQuery (live Google API, no pagination).
  const isTopLevel = !folderId;

  const externalInfinite = useInfiniteQuery<
    { files: FileEntry[]; folders: DriveFolder[]; hasMore: boolean; nextCursor: string | null },
    Error,
    { pages: { files: FileEntry[]; folders: DriveFolder[]; hasMore: boolean; nextCursor: string | null }[]; pageParams: (string | undefined)[] },
    readonly ['external'],
    string | undefined
  >({
    queryKey: qk.external,
    queryFn: ({ pageParam }) => api.getExternal(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isTopLevel,
  });

  const folderQuery = useQuery({
    queryKey: qk.externalFolder(driveIdParam ?? '', folderId ?? ''),
    queryFn: async () => {
      if (driveIdParam && folderId) {
        const data = await api.getExternalFolderContents(driveIdParam, folderId);
        return {
          subfolders: data.subfolders ?? [],
          files: data.files ?? [],
          breadcrumb: [{ id: 'root', name: 'My External Items' }, { id: folderId, name: 'Folder' }] as BreadcrumbItem[],
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
    ? (externalInfinite.data?.pages.flatMap(p => p.files) ?? [])
    : (folderQuery.data?.files ?? []);
  const breadcrumb: BreadcrumbItem[] = isTopLevel
    ? [{ id: 'root', name: 'My External Items' }]
    : (folderQuery.data?.breadcrumb ?? [{ id: 'root', name: 'My External Items' }]);
  const isLoading = isTopLevel ? externalInfinite.isLoading : folderQuery.isLoading;
  const hasMore = isTopLevel ? externalInfinite.hasNextPage : false;

  const filteredSubfolders = subfolders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.external });
  }, [queryClient]);

  const deleteFileMut = useDeleteFile();
  const deleteDriveFolderMut = useDeleteDriveFolder();
  const renameFileMut = useRenameFile();
  const renameDriveFolderMut = useRenameDriveFolder();
  const starFileMut = useStarFile();
  const unstarFileMut = useUnstarFile();
  const starFolderMut = useStarFolder();
  const unstarFolderMut = useUnstarFolder();

  const handleDeleteFile = (id: string) => {
    setConfirmFileDelete(id);
  };

  const handleDeleteFolder = (driveId: string, folderId: string) => {
    setConfirmFolderDelete({ driveId, folderId });
  };

  const handleRenameFile = (id: string, name: string) => {
    renameFileMut.mutate({ fileId: id, name });
  };

  const handleRenameFolder = (driveId: string, folderId: string, name: string) => {
    renameDriveFolderMut.mutate({ driveId, folderId, name });
  };

  const handleRenameFileRequest = (fileId: string, currentName: string) => {
    setRenameTarget({ kind: 'file', id: fileId, currentName });
  };

  const handleRenameFolderRequest = (driveId: string, folderId: string, currentName: string) => {
    setRenameTarget({ kind: 'folder', driveId, folderId, currentName });
  };

  const handleRenameConfirm = async (newName: string) => {
    if (!renameTarget) return;
    if (renameTarget.kind === 'file') {
      await renameFileMut.mutateAsync({ fileId: renameTarget.id, name: newName });
    } else {
      await renameDriveFolderMut.mutateAsync({
        driveId: renameTarget.driveId,
        folderId: renameTarget.folderId,
        name: newName,
      });
    }
    setRenameTarget(null);
  };

  const handleToggleStar = (id: string, type: 'file' | 'folder', currentStarStatus: boolean, driveId?: string) => {
    if (type === 'file') {
      if (currentStarStatus) { unstarFileMut.mutate(id); } else { starFileMut.mutate(id); }
    } else if (driveId) {
      if (currentStarStatus) { unstarFolderMut.mutate({ id, driveId }); } else { starFolderMut.mutate({ id, driveId }); }
    }
  };

  const handleViewInfo = (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => {
    clearSelection();
    toggleSelection({ type, item } as SelectedItem);
    setIsInfoPanelOpen(true);
  };

  const getDriveInfo = useCallback((driveAccountId?: string) => {
    if (!driveAccountId) return { drive: null, index: -1 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: null, index: -1 };
    return { drive: drives[index], index };
  }, [drives]);

  return (
    <div className="flex flex-col h-full w-full">
      <BulkActionBar
        onActionComplete={() => refresh()}
        onMoveRequested={() => setMoveTarget(selectedItems)}
        onWorkspaceRequested={() => setWorkspaceTarget(selectedItems[0].item as FileEntry)}
        onMoveDriveRequested={() => {
          const fileItems = selectedItems.filter(i => i.type === 'file').map(i => i.item as FileEntry);
          setMoveDriveFiles(fileItems);
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
                className="w-full pl-3 pr-8 py-2 text-sm border border-slate-400 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-1"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center border border-slate-400 rounded-md overflow-hidden bg-card flex-shrink-0">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                title="List layout"
                aria-label="List layout"
              >
                <List size={18} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                title="Grid layout"
                aria-label="Grid layout"
              >
                <LayoutGrid size={18} />
              </button>
            </div>

            <button
              onClick={toggleInfoPanel}
              className={`p-2 rounded-full flex-shrink-0 ${isInfoPanelOpen ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100'}`}
              title="View details"
              aria-label="View details"
            >
              <Info size={20} />
            </button>
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
                  onNavigateFolder: (id, driveId) => navigate(`/external/${id}?driveId=${driveId}`),
                  onPreviewFile: setPreviewFile,
                  onShare: (id, type) => setShareTarget({ id, type }),
                  onRenameFile: handleRenameFile,
                  onRenameFolder: handleRenameFolder,
                  onRenameFileRequest: handleRenameFileRequest,
                  onRenameFolderRequest: handleRenameFolderRequest,
                  onDeleteFile: handleDeleteFile,
                  onDeleteFolder: handleDeleteFolder,
                  onDownloadFolder: (driveId, folderId, name) => setFolderDownloadTarget({ driveId, folderId, name }),
                  onMove: (items) => setMoveTarget(items),
                  onViewInfo: handleViewInfo,
                  onToggleStar: handleToggleStar,
                }}
              />
            </div>
            {hasMore && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => externalInfinite.fetchNextPage()}
                  disabled={externalInfinite.isFetchingNextPage}
                  className="px-4 py-2 text-sm font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {externalInfinite.isFetchingNextPage ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <p className="text-lg">No external items found.</p>
          </div>
        )}
      </div>

      {/* Modals */}
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
      <MoveModal
        open={moveTarget.length > 0}
        items={moveTarget}
        driveId={driveIdParam || drives[0]?.id || ''}
        onClose={() => setMoveTarget([])}
        onSuccess={() => {
          clearSelection();
          refresh();
        }}
      />
      <MoveDriveModal
        files={moveDriveFiles}
        onClose={() => setMoveDriveFiles([])}
        onSuccess={() => {
          setMoveDriveFiles([]);
          clearSelection();
          refresh();
        }}
      />
      <FolderDownloadModal
        open={folderDownloadTarget !== null}
        onClose={() => setFolderDownloadTarget(null)}
        driveId={folderDownloadTarget?.driveId}
        folderId={folderDownloadTarget?.folderId}
        folderName={folderDownloadTarget?.name ?? ''}
      />
      <AddToWorkspaceModal
        open={!!workspaceTarget}
        file={workspaceTarget ?? undefined}
        onClose={() => setWorkspaceTarget(null)}
        onSuccess={() => {
          setWorkspaceTarget(null);
          addToast('success', 'Added to workspace');
          refresh();
        }}
      />

      <ConfirmDialog
        open={confirmFileDelete !== null}
        title="Delete File"
        message="Delete this file permanently from Google Drive?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={deleteFileMut.isPending}
        onConfirm={async () => {
          if (confirmFileDelete) {
            await deleteFileMut.mutateAsync(confirmFileDelete);
          }
          setConfirmFileDelete(null);
        }}
        onClose={() => setConfirmFileDelete(null)}
      />
      <ConfirmDialog
        open={confirmFolderDelete !== null}
        title="Delete Folder"
        message="Delete this folder and ALL its contents from Google Drive?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={deleteDriveFolderMut.isPending}
        onConfirm={async () => {
          if (confirmFolderDelete) {
            await deleteDriveFolderMut.mutateAsync(confirmFolderDelete);
          }
          setConfirmFolderDelete(null);
        }}
        onClose={() => setConfirmFolderDelete(null)}
      />

      <RenameDialog
        open={renameTarget !== null}
        initialName={renameTarget?.currentName ?? ''}
        title={renameTarget?.kind === 'folder' ? 'Rename Folder' : 'Rename File'}
        loading={renameFileMut.isPending || renameDriveFolderMut.isPending}
        onConfirm={handleRenameConfirm}
        onClose={() => setRenameTarget(null)}
      />
    </div>
  );
}
