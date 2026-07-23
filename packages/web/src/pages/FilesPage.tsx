import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useUploadStore } from '../stores/useUploadStore';
import { useDrives } from '../hooks/useDrives';
import { Breadcrumb } from '../components/Breadcrumb';
import { FileGrid } from '../components/files/FileGrid';
import { DropZone } from '../components/DropZone';
import { UploadModal } from '../components/UploadModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { MoveModal } from '../components/MoveModal';
import { AddToWorkspaceModal } from '../components/workspaces/AddToWorkspaceModal';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RenameDialog';
import { Upload, FolderPlus, X, LayoutGrid, List, Info } from 'lucide-react';
import { useToastStore } from '../stores/useToastStore';
import { useSharedLinks } from '../hooks/useSharedLinks';
import { useMergedDrive } from '../hooks/useMergedDrive';
import { api } from '../lib/api';
import { useUIStore } from '../stores/useUIStore';
import { useSelectionStore, type SelectedItem } from '../stores/useSelectionStore';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import type { FileEntry, DriveFolder, WorkspaceFolder } from '../types';
import {
  useStarFile, useUnstarFile, useDeleteFile, useRenameFile,
} from '../hooks/useFileMutations';
import {
  useStarFolder, useUnstarFolder, useDeleteDriveFolder, useRenameDriveFolder,
} from '../hooks/useFolderMutations';

type RenameTarget =
  | { kind: 'file'; id: string; currentName: string }
  | { kind: 'folder'; driveId: string; folderId: string; currentName: string }
  | null;

export function FilesPage() {
  const { folderId = 'root' } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId');
  const navigate = useNavigate();
  
  const { data: drivesData, isLoading: isDrivesLoading } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { showModal, setShowModal } = useUploadStore();
  const { addToast } = useToastStore();
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string, type: 'file' | 'folder' } | null>(null);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [workspaceTarget, setWorkspaceTarget] = useState<FileEntry | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel, setIsInfoPanelOpen } = useUIStore();
  const { clearSelection, toggleSelection, selectedItems } = useSelectionStore();

  const handleViewInfo = (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => {
    clearSelection();
    toggleSelection({ type, item } as SelectedItem);
    setIsInfoPanelOpen(true);
  };

  // Mutation hooks — handle API call + toast + cache invalidation
  const starFileMut = useStarFile();
  const unstarFileMut = useUnstarFile();
  const deleteFileMut = useDeleteFile();
  const renameFileMut = useRenameFile();


  const starFolderMut = useStarFolder();
  const unstarFolderMut = useUnstarFolder();
  const deleteDriveFolderMut = useDeleteDriveFolder();
  const renameDriveFolderMut = useRenameDriveFolder();

  const handleConnectGoogle = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { url } = await api.getGoogleOAuthUrl();
      window.location.href = url;
    } catch (e) {
      setIsConnecting(false);
      addToast('error', e instanceof Error ? e.message : 'Failed to start Google OAuth');
    }
  };

  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = (id: string, type: 'file' | 'folder') =>
    sharedLinks.some((link) => link.targetId === id && link.targetType === type);

  const { subfolders, files, breadcrumb, isLoading, errorDrives, refresh } = useMergedDrive(folderId, driveIdParam);

  const [moveTarget, setMoveTarget] = useState<SelectedItem[]>([]);
  const [confirmFileDelete, setConfirmFileDelete] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{ driveId: string; folderId: string } | null>(null);

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
    } else {
      if (currentStarStatus) { unstarFolderMut.mutate({ id }); } else { starFolderMut.mutate({ id }); }
    }
  };

  const handleCreateFolder = () => {
    setShowCreateFolder(true);
  };

  const getDriveInfo = (driveAccountId?: string) => {
    if (!driveAccountId) return { drive: null, index: 0 };
    const index = drives.findIndex(d => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  };

  const filteredSubfolders = subfolders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <DropZone>
      <div className="flex flex-col h-full w-full">
        {/* Toolbar */}
        <BulkActionBar 
          onActionComplete={() => refresh()} 
          onMoveRequested={() => setMoveTarget(selectedItems)}
          onWorkspaceRequested={() => setWorkspaceTarget(selectedItems[0].item as FileEntry)}
          onMoveDriveRequested={() => {
            const files = selectedItems.filter(i => i.type === 'file').map(i => i.item as FileEntry);
            setMoveDriveFiles(files);
          }}
        />

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-4 pt-4 mb-4">
            {/* Mobile Row 1: filter + view toggle + info | Desktop: right side */}
            <div className="flex gap-1.5 sm:gap-2 items-center order-1 sm:order-2 sm:ml-auto">
              <div className="relative w-20 sm:w-48 flex-shrink-0">
                <input
                  type="text"
                  placeholder="Filter..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-2.5 sm:pl-3 pr-7 sm:pr-8 py-1.5 sm:py-2 text-xs sm:text-sm border border-slate-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className={`p-1.5 sm:p-2 ${viewMode === 'list' ? 'bg-blue-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                  title="List layout"
                  aria-label="List layout"
                >
                  <List size={16} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 sm:p-2 ${viewMode === 'grid' ? 'bg-blue-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                  title="Grid layout"
                  aria-label="Grid layout"
                >
                  <LayoutGrid size={16} />
                </button>
              </div>

              <button
                onClick={toggleInfoPanel}
                className={`p-1.5 sm:p-2 rounded-full flex-shrink-0 ${isInfoPanelOpen ? 'bg-blue-100 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
                title="View details"
                aria-label="View details"
              >
                <Info size={18} />
              </button>

              {/* Desktop: folder + upload inline with filter row */}
              <div className="hidden sm:flex gap-2">
                <button className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-md hover:bg-slate-50 flex-shrink-0" onClick={handleCreateFolder}>
                  <FolderPlus size={16} /> <span>New Folder</span>
                </button>
                <button className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex-shrink-0" onClick={() => setShowModal(true)}>
                  <Upload size={16} /> <span>Upload</span>
                </button>
              </div>
            </div>

            {/* Mobile Row 2: folder + upload */}
            <div className="flex gap-1.5 sm:hidden order-2">
              <button className="flex items-center justify-center p-1.5 text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-md hover:bg-slate-50 flex-shrink-0" onClick={handleCreateFolder} title="New Folder">
                <FolderPlus size={16} />
              </button>
              <button className="flex items-center justify-center p-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex-shrink-0" onClick={() => setShowModal(true)} title="Upload">
                <Upload size={16} />
              </button>
            </div>

            {/* Breadcrumb — below on mobile, left side on desktop */}
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden order-3 sm:order-1">
              <Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />
            </div>
          </div>

        {isLoading || isDrivesLoading ? (
          <div className="flex flex-col items-center justify-center p-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
            <p className="text-slate-500">Loading folder contents...</p>
          </div>
        ) : drives.length === 0 ? (
          <div className="text-center p-12 text-slate-500 border rounded-lg bg-card m-4 flex flex-col items-center shadow-sm">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
               <Info size={24} className="text-slate-500" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Google Drive Connected</h3>
            <p className="mb-6 max-w-sm text-center">You need to connect at least one Google Drive account to start using OmniDrive.</p>
            <button
              onClick={handleConnectGoogle}
              disabled={isConnecting}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-colors disabled:opacity-60"
            >
              {isConnecting ? 'Connecting…' : 'Connect Google Drive Now'}
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto bg-card rounded-lg border border-slate-200 m-4 shadow-sm">
            <FileGrid
              files={filteredFiles}
              subfolders={filteredSubfolders}
              getDriveInfo={getDriveInfo}
              isTargetShared={isTargetShared}
              errorDrives={errorDrives}
              actions={{
                onNavigateFolder: (id, driveId) => navigate(`/files/${id}?driveId=${driveId}`),
                onPreviewFile: setPreviewFile,
                onShare: (id, type) => setShareTarget({ id, type }),
                onRenameFile: handleRenameFile,
                onRenameFolder: handleRenameFolder,
                onRenameFileRequest: handleRenameFileRequest,
                onRenameFolderRequest: handleRenameFolderRequest,
                onDeleteFile: handleDeleteFile,
                onDeleteFolder: handleDeleteFolder,
                onMoveDrive: (file) => setMoveDriveFiles([file]),
                onMove: (items) => setMoveTarget(items),
                onAddToWorkspace: setWorkspaceTarget,
                onViewInfo: handleViewInfo,
                onToggleStar: handleToggleStar,
              }}
            />
          </div>
        )}

        {/* Modals — always mounted so Radix Dialog can play enter/exit animations */}
        <CreateFolderModal
          open={showCreateFolder}
          parentId={folderId === 'root' ? null : folderId}
          title="New Folder"
          driveId={driveIdParam ?? undefined}
          drives={drives}
          onClose={() => setShowCreateFolder(false)}
          onSuccess={refresh}
        />
        <UploadModal open={showModal} folderId={folderId} onClose={() => setShowModal(false)} onSuccess={refresh} />
        <FilePreviewModal open={!!previewFile} file={previewFile ?? undefined} onClose={() => setPreviewFile(null)} />
        <ShareModal
          open={!!shareTarget}
          targetType={shareTarget?.type ?? 'file'}
          targetId={shareTarget?.id ?? ''}
          onClose={() => setShareTarget(null)}
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
    </DropZone>
  );
}
