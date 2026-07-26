import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useUploadStore } from '../stores/useUploadStore';
import { api } from '../lib/api';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { Breadcrumb } from '../components/Breadcrumb';
import { FileGrid } from '../components/files/FileGrid';
import { DropZone } from '../components/DropZone';
import { UploadModal } from '../components/UploadModal';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { ItemModals } from '../components/files/ItemModals';
import { Upload, FolderPlus, X, LayoutGrid, List, Info } from 'lucide-react';
import { useToastStore } from '../stores/useToastStore';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useItemModals } from '../hooks/useItemModals';
import { useMergedDrive } from '../hooks/useMergedDrive';
import { useUIStore } from '../stores/useUIStore';
import { useSelectionStore, useClearSelectionOnRouteChange, type SelectedItem } from '../stores/useSelectionStore';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import type { FileEntry } from '../types';

export function FilesPage() {
  const { folderId = 'root' } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId');
  const navigate = useNavigate();

  // Clear global selection whenever the folder/drive route changes, so the
  // BulkActionBar from folder A doesn't act on invisible items in folder B.
  useClearSelectionOnRouteChange([folderId, driveIdParam]);

  const { data: drivesData, isLoading: isDrivesLoading } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { showModal, setShowModal } = useUploadStore();
  const { addToast } = useToastStore();
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel } = useUIStore();
  const { selectedItems } = useSelectionStore();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

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
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);

  const { subfolders, files, breadcrumb, isLoading, errorDrives, refresh } = useMergedDrive(folderId, driveIdParam);

  // Shared modal state + handlers for file/folder item interactions
  const itemModals = useItemModals({
    onRefresh: refresh,
    allFolders: subfolders,
    files,
  });

  const getDriveInfo = useGetDriveInfo(drives);

  const filteredSubfolders = subfolders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <DropZone>
      <div className="flex flex-col h-full w-full">
        {/* Toolbar */}
        <BulkActionBar
          onActionComplete={() => refresh()}
          onMoveRequested={() => itemModals.setMoveTarget(selectedItems)}
          onWorkspaceRequested={() => itemModals.setWorkspaceTarget(selectedItems[0].item as FileEntry)}
          onMoveDriveRequested={() => {
            const fileItems = selectedItems.filter(i => i.type === 'file').map(i => i.item as FileEntry);
            itemModals.setMoveDriveFiles(fileItems);
          }}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-4 pt-4 mb-4">
            {/* Mobile Row 1: filter + view toggle + info | Desktop: right side */}
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

              {/* Desktop: folder + upload inline with filter row */}
              <div className="hidden sm:flex gap-2">
                <button className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-md hover:bg-slate-50 flex-shrink-0" onClick={() => setShowCreateFolder(true)}>
                  <FolderPlus size={16} /> <span>New Folder</span>
                </button>
                <button className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-primary rounded-md hover:opacity-90 flex-shrink-0" onClick={() => setShowModal(true)}>
                  <Upload size={16} /> <span>Upload</span>
                </button>
              </div>
            </div>

            {/* Mobile Row 2: folder + upload */}
            <div className="flex gap-2 sm:hidden order-2">
              <button className="flex items-center justify-center gap-1 p-2 text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-md hover:bg-slate-50 flex-shrink-0 flex-1" onClick={() => setShowCreateFolder(true)} title="New Folder">
                <FolderPlus size={18} /> <span>New Folder</span>
              </button>
              <button className="flex items-center justify-center gap-1 p-2 text-sm font-medium text-white bg-primary rounded-md hover:opacity-90 flex-shrink-0 flex-1" onClick={() => setShowModal(true)} title="Upload">
                <Upload size={18} /> <span>Upload</span>
              </button>
            </div>

            {/* Breadcrumb — below on mobile, left side on desktop */}
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden order-3 sm:order-1">
              <Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />
            </div>
          </div>

        {isLoading || isDrivesLoading ? (
          <div className="flex flex-col items-center justify-center p-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
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
              className="px-6 py-2.5 bg-primary text-white rounded-lg hover:opacity-90 font-medium shadow-sm transition-colors disabled:opacity-60"
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
                onNavigateFolder: (id: string, driveId: string) => navigate(`/files/${id}?driveId=${driveId}`),
                onPreviewFile: itemModals.setPreviewFile,
                onShare: (id: string, type: 'file' | 'folder') => itemModals.setShareTarget({ id, type }),
                onRenameFileRequest: itemModals.handleRenameFileRequest,
                onRenameFolderRequest: itemModals.handleRenameFolderRequest,
                onDeleteFile: itemModals.handleDeleteFile,
                onDeleteFolder: itemModals.handleDeleteFolder,
                onMoveDrive: (file: FileEntry) => itemModals.setMoveDriveFiles([file]),
                onDownloadFolder: (driveId: string, folderId: string, name: string) => itemModals.setFolderDownloadTarget({ driveId, folderId, name }),
                onMove: (items: SelectedItem[]) => itemModals.setMoveTarget(items),
                onAddToWorkspace: itemModals.setWorkspaceTarget,
                onViewInfo: itemModals.handleViewInfo,
                onToggleStar: itemModals.toggleStar,
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
        <ItemModals modals={itemModals} driveId={driveIdParam || drives[0]?.id || ''} onRefresh={refresh} />
      </div>
    </DropZone>
  );
}
