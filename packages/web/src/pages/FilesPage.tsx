import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useUploadStore } from '../stores/useUploadStore';
import { authApi } from '../lib/api/auth';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageHeader } from '../components/layout/PageHeader';
import { FileGrid } from '../components/files/FileGrid';
import { DropZone } from '../components/DropZone';
import { UploadModal } from '../components/UploadModal';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { ItemModals } from '../components/files/ItemModals';
import { ErrorState } from '../components/ErrorState';
import { ListSkeleton } from '../components/EmptyState';
import { Upload, FolderPlus, Info, HardDrive } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToastStore } from '../stores/useToastStore';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useItemModals } from '../hooks/useItemModals';
import { useMergedDrive } from '../hooks/useMergedDrive';
import { useUIStore } from '../stores/useUIStore';
import {
  useSelectionStore,
  useClearSelectionOnRouteChange,
  type SelectedItem,
} from '../stores/useSelectionStore';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { FilesToolbar } from '../components/layout/FilesToolbar';
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
      const { url } = await authApi.getGoogleOAuthUrl();
      window.location.href = url;
    } catch (e) {
      setIsConnecting(false);
      addToast('error', e instanceof Error ? e.message : 'Failed to start Google OAuth');
    }
  };

  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);

  const { subfolders, files, breadcrumb, isLoading, errorDrives, refresh } = useMergedDrive(
    folderId,
    driveIdParam,
  );

  // Shared modal state + handlers for file/folder item interactions
  const itemModals = useItemModals({
    onRefresh: refresh,
    allFolders: subfolders,
    files,
  });

  const getDriveInfo = useGetDriveInfo(drives);

  const filteredSubfolders = subfolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <DropZone>
      <div className="p-4 sm:p-6 space-y-2">
        <PageHeader
          title={
            folderId === 'root' ? 'My Drive' : (breadcrumb[breadcrumb.length - 1]?.name ?? 'Folder')
          }
          icon={HardDrive}
        />
        {/* Toolbar */}
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
          actions={
            <>
              <Button
                variant="secondary"
                size="md"
                className="rounded-md gap-1 hover:bg-slate-50 flex-shrink-0"
                onClick={() => setShowCreateFolder(true)}
              >
                <FolderPlus size={16} /> <span>New Folder</span>
              </Button>
              <Button
                variant="primary"
                size="md"
                className="rounded-md gap-1 flex-shrink-0"
                onClick={() => setShowModal(true)}
              >
                <Upload size={16} /> <span>Upload</span>
              </Button>
            </>
          }
          mobileActions={
            <>
              <Button
                variant="secondary"
                className="rounded-md gap-1 p-2 hover:bg-slate-50 flex-shrink-0 flex-1 justify-center"
                onClick={() => setShowCreateFolder(true)}
                title="New Folder"
              >
                <FolderPlus size={18} /> <span>New Folder</span>
              </Button>
              <Button
                variant="primary"
                className="rounded-md gap-1 p-2 flex-shrink-0 flex-1 justify-center"
                onClick={() => setShowModal(true)}
                title="Upload"
              >
                <Upload size={18} /> <span>Upload</span>
              </Button>
            </>
          }
          breadcrumb={<Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />}
        />

        {errorDrives.size > 0 && drives.length === 0 ? (
          <ErrorState onRetry={refresh} />
        ) : isLoading || isDrivesLoading ? (
          <ListSkeleton rows={6} />
        ) : drives.length === 0 ? (
          <div className="text-center p-12 text-slate-500 border rounded-xl bg-card flex flex-col items-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <Info size={24} className="text-slate-500" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Google Drive Connected</h3>
            <p className="mb-6 max-w-sm text-center">
              You need to connect at least one Google Drive account to start using OmniDrive.
            </p>
            <Button
              variant="primary"
              size="md"
              className="px-6 py-2.5 rounded-lg disabled:opacity-60"
              onClick={handleConnectGoogle}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting…' : 'Connect Google Drive Now'}
            </Button>
          </div>
        ) : (
          <div className="flex-1 bg-card rounded-xl border border-slate-200 overflow-hidden">
            <FileGrid
              files={filteredFiles}
              subfolders={filteredSubfolders}
              getDriveInfo={getDriveInfo}
              isTargetShared={isTargetShared}
              errorDrives={errorDrives}
              actions={{
                onNavigateFolder: (id: string, driveId: string) =>
                  navigate(`/files/${id}?driveId=${driveId}`),
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
        <UploadModal
          open={showModal}
          folderId={folderId}
          onClose={() => setShowModal(false)}
          onSuccess={refresh}
        />
        <ItemModals
          modals={itemModals}
          driveId={driveIdParam || drives[0]?.id || ''}
          onRefresh={refresh}
        />
      </div>
    </DropZone>
  );
}
