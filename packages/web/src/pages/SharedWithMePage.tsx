import { useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { List, LayoutGrid, Info, X } from 'lucide-react';
import { FileGrid } from '../components/files/FileGrid';
import { Breadcrumb } from '../components/Breadcrumb';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { MoveModal } from '../components/MoveModal';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RenameDialog';
import { api } from '../lib/api';
import { useDrives } from '../hooks/useDrives';
import type { FileEntry, DriveFolder, BreadcrumbItem, WorkspaceFolder } from '../types';
import { qk } from '../lib/queryKeys';
import type { SelectedItem } from '../stores/useSelectionStore';
import { useSelectionStore } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { useDeleteFile, useRenameFile, useStarFile, useUnstarFile } from '../hooks/useFileMutations';
import { useDeleteDriveFolder, useRenameDriveFolder, useStarFolder, useUnstarFolder } from '../hooks/useFolderMutations';

export function SharedWithMePage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId') ?? null;
  const navigate = useNavigate();

  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { selectedItems, clearSelection, toggleSelection } = useSelectionStore();
  const queryClient = useQueryClient();
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel, setIsInfoPanelOpen } = useUIStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveTarget, setMoveTarget] = useState<SelectedItem[]>([]);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [confirmFileDelete, setConfirmFileDelete] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{ driveId: string; folderId: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    | { kind: 'file'; id: string; currentName: string }
    | { kind: 'folder'; driveId: string; folderId: string; currentName: string }
    | null
  >(null);

  const queryKey = folderId && driveIdParam
    ? qk.sharedWithMeFolder(driveIdParam, folderId)
    : qk.sharedWithMe;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!folderId) {
        const data = await api.getSharedWithMe();
        return {
          subfolders: data.folders ?? [],
          files: data.files ?? [],
          breadcrumb: [{ id: 'root', name: 'Shared with me' }] as BreadcrumbItem[],
        };
      }
      if (driveIdParam) {
        const data = await api.getSharedFolderContents(driveIdParam, folderId);
        return {
          subfolders: data.subfolders ?? [],
          files: data.files ?? [],
          breadcrumb: [{ id: 'root', name: 'Shared with me' }, { id: folderId, name: 'Folder' }] as BreadcrumbItem[],
        };
      }
      throw new Error('Missing drive information for folder');
    },
    enabled: !folderId || !!driveIdParam,
  });

  const subfolders: DriveFolder[] = data?.subfolders ?? [];
  const files: FileEntry[] = data?.files ?? [];
  const breadcrumb: BreadcrumbItem[] = data?.breadcrumb ?? [{ id: 'root', name: 'Shared with me' }];

  const filteredSubfolders = subfolders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.sharedWithMe });
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

  const handleRenameConfirm = (newName: string) => {
    if (!renameTarget) return;
    if (renameTarget.kind === 'file') {
      handleRenameFile(renameTarget.id, newName);
    } else {
      handleRenameFolder(renameTarget.driveId, renameTarget.folderId, newName);
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
    if (!driveAccountId) return { drive: drives[0] || null, index: 0 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  }, [drives]);

  return (
    <div className="flex flex-col h-full w-full">
      <BulkActionBar
        onActionComplete={() => refresh()}
        onMoveRequested={() => setMoveTarget(selectedItems)}
        onMoveDriveRequested={() => {
          const fileItems = selectedItems.filter(i => i.type === 'file').map(i => i.item as FileEntry);
          setMoveDriveFiles(fileItems);
        }}
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2 sm:gap-3 px-4 pt-4">
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden order-2 md:order-1">
            <Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />
          </div>

          <div className="flex gap-1.5 sm:gap-2 items-center flex-wrap order-1 md:order-2">
            <div className="relative w-24 sm:w-48">
              <input
                type="text"
                placeholder="Filter..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3 pr-8 py-2 text-sm border border-slate-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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

            <div className="flex items-center border border-slate-400 rounded-md overflow-hidden bg-card mr-1">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-blue-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                title="List layout"
                aria-label="List layout"
              >
                <List size={18} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-blue-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                title="Grid layout"
                aria-label="Grid layout"
              >
                <LayoutGrid size={18} />
              </button>
            </div>

            <button
              onClick={toggleInfoPanel}
              className={`p-2 rounded-full mr-1 ${isInfoPanelOpen ? 'bg-blue-100 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
              title="View details"
              aria-label="View details"
            >
              <Info size={20} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : filteredSubfolders.length > 0 || filteredFiles.length > 0 ? (
          <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
            <FileGrid
              files={filteredFiles}
              subfolders={filteredSubfolders}
              getDriveInfo={getDriveInfo}
              isTargetShared={() => false}
              actions={{
                onNavigateFolder: (id, driveId) => navigate(`/shared-with-me/${id}?driveId=${driveId}`),
                onPreviewFile: setPreviewFile,
                onShare: (id, type) => setShareTarget({ id, type }),
                onRenameFile: handleRenameFile,
                onRenameFolder: handleRenameFolder,
                onRenameFileRequest: handleRenameFileRequest,
                onRenameFolderRequest: handleRenameFolderRequest,
                onDeleteFile: handleDeleteFile,
                onDeleteFolder: handleDeleteFolder,
                onMove: (items) => setMoveTarget(items),
                onViewInfo: handleViewInfo,
                onToggleStar: handleToggleStar,
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <p className="text-lg">No shared items found.</p>
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

      <ConfirmDialog
        open={confirmFileDelete !== null}
        title="Delete File"
        message="Delete this file permanently from Google Drive?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={deleteFileMut.isPending}
        onConfirm={() => {
          if (confirmFileDelete) deleteFileMut.mutate(confirmFileDelete);
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
        onConfirm={() => {
          if (confirmFolderDelete) deleteDriveFolderMut.mutate(confirmFolderDelete);
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
