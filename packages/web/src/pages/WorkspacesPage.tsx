import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../lib/api';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useToggleStar } from '../hooks/useFileMutations';
import type { WorkspaceFolder, FileEntry, DriveFolder, BreadcrumbItem } from '../types';
import { WorkspaceSidebar } from '../components/workspaces/WorkspaceSidebar';
import { WorkspaceMainView } from '../components/workspaces/WorkspaceMainView';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RenameDialog';
import { useToastStore } from '../stores/useToastStore';
import { useSelectionStore, type SelectedItem } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { SetRetentionPolicyDialog } from '../components/workspaces/SetRetentionPolicyDialog';

export function WorkspacesPage() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [subfolders, setSubfolders] = useState<WorkspaceFolder[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [retentionTargetId, setRetentionTargetId] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState<{ parentId: string | null; title: string } | null>(null);
  const addToast = useToastStore(state => state.addToast);
  const { clearSelection, toggleSelection } = useSelectionStore();
  const setIsInfoPanelOpen = useUIStore(s => s.setIsInfoPanelOpen);
  const { data: drivesData } = useDrives();
  const drives = drivesData?.drives ?? [];
  const [wsSidebarOpen, setWsSidebarOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; currentName: string } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const fetchTree = useCallback(async () => {
    try {
      const res = await api.getWorkspaceTree();
      setFolders(res.folders);
    } catch {
      addToast('error', 'Failed to load workspaces');
    }
  }, [addToast]);

  const fetchContents = useCallback(async (folderId: string, isStale?: () => boolean) => {
    try {
      const res = await api.getFolderContents(folderId);
      if (isStale?.()) return;
      setFiles(res.files);
      setSubfolders(res.subfolders);
    } catch {
      if (isStale?.()) return;
      addToast('error', 'Failed to load folder contents');
    }
  }, [addToast]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    let ignore = false;
    if (activeFolderId) {
      fetchContents(activeFolderId, () => ignore);
    } else {
      setFiles([]);
      setSubfolders([]);
    }
    clearSelection();
    return () => { ignore = true; };
  }, [activeFolderId, clearSelection, fetchContents]);

  const openCreateModal = (parentId?: string | null) => {
    const title = parentId ? 'New Folder' : 'New Workspace';
    setCreateModal({ parentId: parentId ?? null, title });
  };

  const handleRename = (id: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;
    setRenameTarget({ id, currentName: folder.name });
  };

  const confirmRename = async (newName: string) => {
    if (!renameTarget) return;
    setIsRenaming(true);
    try {
      await api.updateFolder(renameTarget.id, { name: newName });
      fetchTree();
      setRenameTarget(null);
    } catch {
      addToast('error', 'Failed to rename workspace');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await api.deleteFolder(deleteTargetId);
      if (activeFolderId === deleteTargetId) {
        setActiveFolderId(null);
      }
      fetchTree();
    } catch {
      addToast('error', 'Failed to delete workspace');
    } finally {
      setIsDeleting(false);
      setDeleteTargetId(null);
    }
  };

  const handleSync = async () => {
    if (!activeFolderId) return;
    setIsSyncing(true);
    try {
      await api.syncWorkspace(activeFolderId);
      addToast('success', 'Sync started.');
      setTimeout(() => fetchContents(activeFolderId), 2000);
    } catch {
      addToast('error', 'Failed to start sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleViewInfo = useCallback((item: FileEntry | WorkspaceFolder | DriveFolder, type: 'file' | 'folder') => {
    clearSelection();
    toggleSelection({ type, item } as SelectedItem);
    setIsInfoPanelOpen(true);
  }, [clearSelection, toggleSelection, setIsInfoPanelOpen]);

  const activeFolder = useMemo(() => folders.find(f => f.id === activeFolderId) || null, [folders, activeFolderId]);

  const breadcrumbPath = useMemo(() => {
    const path: BreadcrumbItem[] = [];
    let current = activeFolder;
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      current = folders.find(f => f.id === current?.parentId) || null;
    }
    return path;
  }, [activeFolder, folders]);

  const getDriveInfo = useGetDriveInfo(drives);
  const onPreviewFile = useCallback((file: FileEntry) => setPreviewFile(file), []);
  const onShare = useCallback(() => {}, []);
  const onRenameFile = useCallback(() => {}, []);
  const onMoveDrive = useCallback(() => {}, []);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const errorDrives = useMemo(() => new Set<string>(), []);

  const onRemoveFromWorkspace = useCallback(async (id: string) => {
    try {
      await api.moveFile(id, null);
      addToast('success', 'Removed from workspace');
      setFiles(prev => prev.filter(f => f.id !== id));
    } catch {
      addToast('error', 'Failed to remove from workspace');
    }
  }, [addToast]);

  const toggleStar = useToggleStar();

  const handleSetRetentionPolicy = useCallback((id: string, type: 'file' | 'folder') => {
    if (type === 'folder') {
      setRetentionTargetId(id);
    }
  }, []);

  const fileTabProps = useMemo(() => ({
    files,
    subfolders,
    getDriveInfo,
    isTargetShared,
    errorDrives,
    actions: {
      onNavigateFolder: setActiveFolderId,
      onPreviewFile,
      onShare,
      onRenameFile,
      onDeleteFile: onRemoveFromWorkspace,
      onMoveDrive,
      onToggleStar: toggleStar,
      onViewInfo: handleViewInfo,
      onSetRetentionPolicy: handleSetRetentionPolicy,
    },
  }), [
    files,
    subfolders,
    getDriveInfo,
    onPreviewFile,
    onShare,
    onRenameFile,
    onRemoveFromWorkspace,
    onMoveDrive,
    toggleStar,
    isTargetShared,
    errorDrives,
    handleViewInfo,
    handleSetRetentionPolicy,
  ]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-card relative">
      {/* Mobile backdrop */}
      {wsSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setWsSidebarOpen(false)} aria-hidden />
      )}
      {/* Sidebar: mobile drawer (fixed) + desktop inline (always visible) */}
      <div className={`${wsSidebarOpen ? 'fixed left-0 top-0 bottom-0 z-50 shadow-xl' : 'hidden'} md:relative md:block md:shadow-none md:z-auto`}>
        <WorkspaceSidebar
          folders={folders}
          activeFolderId={activeFolderId}
          onSelect={(id) => { setActiveFolderId(id); setWsSidebarOpen(false); }}
          onRename={handleRename}
          onDelete={handleDelete}
          onNewSubfolder={openCreateModal}
        />
      </div>
      <WorkspaceMainView
        activeFolder={activeFolder}
        path={breadcrumbPath}
        onCreateFolder={() => activeFolder && openCreateModal(activeFolder.id)}
        onCreateRootFolder={() => openCreateModal(null)}
        onSync={handleSync}
        isSyncing={isSyncing}
        fileTabProps={fileTabProps}
        onToggleSidebar={() => setWsSidebarOpen(true)}
      />
      <CreateFolderModal
        open={!!createModal}
        parentId={createModal?.parentId ?? null}
        title={createModal?.title ?? 'New Folder'}
        onClose={() => setCreateModal(null)}
        onSuccess={fetchTree}
      />
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Delete Workspace"
        message="Are you sure you want to delete this workspace?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDelete}
        onClose={() => !isDeleting && setDeleteTargetId(null)}
      />
      <RenameDialog
        open={renameTarget !== null}
        initialName={renameTarget?.currentName ?? ''}
        title="Rename Workspace"
        loading={isRenaming}
        onConfirm={confirmRename}
        onClose={() => !isRenaming && setRenameTarget(null)}
      />
      <SetRetentionPolicyDialog
        open={!!retentionTargetId}
        onClose={() => setRetentionTargetId(null)}
        onSubmit={async (action, days) => {
          if (activeFolderId && retentionTargetId) {
            try {
              await api.createWorkspacePolicy(activeFolderId, {
                targetType: 'folder',
                targetId: retentionTargetId,
                policyType: 'data_retention',
                config: { action, days },
              });
              addToast('success', 'Policy applied successfully');
            } catch {
              addToast('error', 'Failed to apply policy');
            }
          }
        }}
      />
    </div>
  );
}
