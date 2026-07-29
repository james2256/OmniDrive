import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '../lib/api/workspaces';
import { foldersApi } from '../lib/api/folders';
import { filesApi } from '../lib/api/files';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { useItemModals } from '../hooks/useItemModals';
import type { FileEntry, BreadcrumbItem } from '../types';
import { WorkspaceSidebar } from '../components/workspaces/WorkspaceSidebar';
import { WorkspaceMainView } from '../components/workspaces/WorkspaceMainView';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RenameDialog';
import { useToastStore } from '../stores/useToastStore';
import { useSelectionStore, type SelectedItem } from '../stores/useSelectionStore';
import { ItemModals } from '../components/files/ItemModals';
import { SetRetentionPolicyDialog } from '../components/workspaces/SetRetentionPolicyDialog';
import { ListSkeleton } from '../components/EmptyState';
import { qk } from '../lib/queryKeys';

export function WorkspacesPage() {
  const queryClient = useQueryClient();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [retentionTargetId, setRetentionTargetId] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState<{ parentId: string | null; title: string } | null>(
    null,
  );
  const addToast = useToastStore((state) => state.addToast);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const { data: drivesData } = useDrives();
  const drives = drivesData?.drives ?? [];
  const [wsSidebarOpen, setWsSidebarOpen] = useState(false);
  // Sidebar-managed workspace-folder actions (rename/delete workspace folders,
  // distinct from file-item actions handled by useItemModals)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; currentName: string } | null>(
    null,
  );
  const [isRenaming, setIsRenaming] = useState(false);

  // Tree query — replaces manual fetchTree + isLoadingTree + folders state.
  // Auto-fetches on mount; refetches on window focus; invalidated on rename/delete/create.
  const { data: treeData, isLoading: isLoadingTree } = useQuery({
    queryKey: qk.workspaceTree,
    queryFn: () => foldersApi.getWorkspaceTree(),
  });
  const folders = useMemo(() => treeData?.folders ?? [], [treeData]);

  // Contents query — replaces manual fetchContents + files/subfolders state.
  // enabled: !!activeFolderId prevents fetching when no folder is selected.
  // TanStack Query handles stale/cancel internally (no manual isStale guard).
  const { data: contentsData } = useQuery({
    queryKey: qk.workspaceContents(activeFolderId ?? ''),
    queryFn: () => foldersApi.getFolderContents(activeFolderId ?? ''),
    enabled: !!activeFolderId,
  });
  const files = useMemo(() => contentsData?.files ?? [], [contentsData]);
  const subfolders = useMemo(() => contentsData?.subfolders ?? [], [contentsData]);

  // Clear selection when navigating between folders (UI state, not data state).
  useEffect(() => {
    clearSelection();
  }, [activeFolderId, clearSelection]);

  const refreshContents = useCallback(() => {
    if (activeFolderId) {
      queryClient.invalidateQueries({ queryKey: qk.workspaceContents(activeFolderId) });
    }
  }, [activeFolderId, queryClient]);

  const openCreateModal = (parentId?: string | null) => {
    const title = parentId ? 'New Folder' : 'New Workspace';
    setCreateModal({ parentId: parentId ?? null, title });
  };

  // ─── Sidebar workspace-folder actions (rename/delete workspace folders) ───

  const handleRename = (id: string) => {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    setRenameTarget({ id, currentName: folder.name });
  };

  const confirmRename = async (newName: string) => {
    if (!renameTarget) return;
    setIsRenaming(true);
    try {
      await foldersApi.updateFolder(renameTarget.id, { name: newName });
      queryClient.invalidateQueries({ queryKey: qk.workspaceTree });
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
      await foldersApi.deleteFolder(deleteTargetId);
      if (activeFolderId === deleteTargetId) {
        setActiveFolderId(null);
      }
      queryClient.invalidateQueries({ queryKey: qk.workspaceTree });
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
      await foldersApi.syncWorkspace(activeFolderId);
      addToast('success', 'Sync started.');
      queryClient.invalidateQueries({ queryKey: qk.workspaceContents(activeFolderId) });
    } catch {
      addToast('error', 'Failed to start sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const activeFolder = useMemo(
    () => folders.find((f) => f.id === activeFolderId) || null,
    [folders, activeFolderId],
  );

  const breadcrumbPath = useMemo(() => {
    const path: BreadcrumbItem[] = [];
    let current = activeFolder;
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      current = folders.find((f) => f.id === current?.parentId) || null;
    }
    return path;
  }, [activeFolder, folders]);

  const getDriveInfo = useGetDriveInfo(drives);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const errorDrives = useMemo(() => new Set<string>(), []);

  // Remove a file from the current workspace (non-destructive: moves to root).
  // Distinct from "Delete" (permanent) — both are available in the context menu.
  const onRemoveFromWorkspace = useCallback(
    async (id: string) => {
      try {
        await filesApi.moveFile(id, null);
        addToast('success', 'Removed from workspace');
        queryClient.invalidateQueries({ queryKey: qk.workspaceContents(activeFolderId ?? '') });
      } catch {
        addToast('error', 'Failed to remove from workspace');
      }
    },
    [addToast, activeFolderId, queryClient],
  );

  const handleSetRetentionPolicy = useCallback((id: string, type: 'file' | 'folder') => {
    if (type === 'folder') {
      setRetentionTargetId(id);
    }
  }, []);

  // Shared modal state + handlers for file/folder item interactions
  // (preview, share, rename, delete, move, move-drive, download, add-to-workspace)
  const itemModals = useItemModals({
    onRefresh: refreshContents,
    allFolders: subfolders,
    files,
  });

  const fileTabProps = useMemo(
    () => ({
      files,
      subfolders,
      getDriveInfo,
      isTargetShared,
      errorDrives,
      actions: {
        onNavigateFolder: setActiveFolderId,
        onPreviewFile: itemModals.setPreviewFile,
        onShare: (id: string, type: 'file' | 'folder') => itemModals.setShareTarget({ id, type }),
        onRenameFileRequest: itemModals.handleRenameFileRequest,
        onDeleteFile: itemModals.handleDeleteFile,
        onRemoveFromWorkspace,
        onMoveDrive: (file: FileEntry) => itemModals.setMoveDriveFiles([file]),
        onMove: (items: SelectedItem[]) => itemModals.setMoveTarget(items),
        onToggleStar: itemModals.toggleStar,
        onViewInfo: itemModals.handleViewInfo,
        onSetRetentionPolicy: handleSetRetentionPolicy,
      },
    }),
    [
      files,
      subfolders,
      getDriveInfo,
      isTargetShared,
      errorDrives,
      itemModals,
      onRemoveFromWorkspace,
      handleSetRetentionPolicy,
    ],
  );

  return (
    <div className="flex h-full w-full overflow-hidden relative">
      {/* Mobile backdrop */}
      {wsSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setWsSidebarOpen(false)}
          aria-hidden
        />
      )}
      {/* Sidebar: mobile drawer (fixed) + desktop inline (always visible) */}
      <div
        className={`${wsSidebarOpen ? 'fixed left-0 top-0 bottom-0 z-50 shadow-xl' : 'hidden'} md:relative md:block md:shadow-none md:z-auto`}
      >
        {isLoadingTree ? (
          <div
            className="w-64 border-r border-slate-200 bg-slate-50/50 p-4 h-full"
            aria-busy="true"
            aria-label="Loading workspaces"
          >
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Workspaces
            </div>
            <ListSkeleton rows={6} />
          </div>
        ) : (
          <WorkspaceSidebar
            folders={folders}
            activeFolderId={activeFolderId}
            onSelect={(id) => {
              setActiveFolderId(id);
              setWsSidebarOpen(false);
            }}
            onRename={handleRename}
            onDelete={handleDelete}
            onNewSubfolder={openCreateModal}
          />
        )}
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
        onSuccess={() => queryClient.invalidateQueries({ queryKey: qk.workspaceTree })}
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
          if (activeFolderId && retentionTargetId && activeFolder) {
            try {
              await workspacesApi.createWorkspacePolicy(activeFolder.workspaceId, {
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
      {/* Shared file/folder modals (preview, share, rename, delete, move, etc.) */}
      <ItemModals modals={itemModals} driveId={drives[0]?.id ?? ''} onRefresh={refreshContents} />
    </div>
  );
}
