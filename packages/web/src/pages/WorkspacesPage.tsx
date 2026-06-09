import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { WorkspaceFolder, FileEntry, DriveFolder } from '../types';
import { WorkspaceSidebar } from '../components/workspaces/WorkspaceSidebar';
import { FileGrid } from '../components/files/FileGrid';
import { useToastStore } from '../stores/toastStore';
import { FolderPlus, RefreshCw } from 'lucide-react';
import { useSelectionStore, type SelectedItem } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';
import { BulkActionBar } from '../components/layout/BulkActionBar';

export function WorkspacesPage() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [subfolders, setSubfolders] = useState<WorkspaceFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const addToast = useToastStore(state => state.addToast);
  const { clearSelection, toggleSelection, selectedItems } = useSelectionStore();
  const setIsInfoPanelOpen = useUIStore(s => s.setIsInfoPanelOpen);

  const fetchTree = async () => {
    try {
      const res = await api.getWorkspaceTree();
      setFolders(res.folders);
    } catch {
      addToast('error', 'Failed to load workspaces');
    }
  };

  const fetchContents = async (folderId: string) => {
    setIsLoading(true);
    try {
      const res = await api.getFolderContents(folderId);
      setFiles(res.files);
      setSubfolders(res.subfolders);
    } catch {
      addToast('error', 'Failed to load folder contents');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, []);

  useEffect(() => {
    if (activeFolderId) {
      fetchContents(activeFolderId);
    } else {
      setFiles([]);
      setSubfolders([]);
    }
  }, [activeFolderId]);

  useEffect(() => {
    clearSelection();
    return () => clearSelection();
  }, [activeFolderId, clearSelection]);

  const handleCreateFolder = async () => {
    const name = prompt('New workspace name:');
    if (name?.trim()) {
      try {
        await api.createFolder(name.trim(), activeFolderId || undefined);
        fetchTree();
      } catch {
        addToast('error', 'Failed to create workspace');
      }
    }
  };

  const handleSync = async () => {
    if (!activeFolderId) return;
    setIsSyncing(true);
    try {
      await api.syncWorkspace(activeFolderId);
      addToast('success', 'Sync started. Give it a moment to complete.');
      // Wait a bit then refresh
      setTimeout(() => fetchContents(activeFolderId), 2000);
    } catch {
      addToast('error', 'Failed to start sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRemoveFile = async (id: string) => {
    try {
      await api.moveFile(id, null);
      addToast('success', 'Removed from workspace');
      if (activeFolderId) fetchContents(activeFolderId);
    } catch {
      addToast('error', 'Failed to remove file');
    }
  };

  const handleViewInfo = (item: FileEntry | WorkspaceFolder | DriveFolder, type: 'file' | 'folder') => {
    clearSelection();
    toggleSelection({ type, item } as SelectedItem);
    setIsInfoPanelOpen(true);
  };

  const handleRenameWorkspace = async (id: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;
    const name = prompt('Rename workspace:', folder.name);
    if (name?.trim() && name.trim() !== folder.name) {
      try {
        await api.updateFolder(id, { name: name.trim() });
        fetchTree();
      } catch {
        addToast('error', 'Failed to rename workspace');
      }
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (confirm('Are you sure you want to delete this workspace?')) {
      try {
        await api.deleteFolder(id);
        if (activeFolderId === id) setActiveFolderId(null);
        fetchTree();
      } catch {
        addToast('error', 'Failed to delete workspace');
      }
    }
  };

  const handleCreateSubfolder = async (parentId: string) => {
    const name = prompt('New subfolder name:');
    if (name?.trim()) {
      try {
        await api.createFolder(name.trim(), parentId);
        fetchTree();
      } catch {
        addToast('error', 'Failed to create subfolder');
      }
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <WorkspaceSidebar 
        folders={folders} 
        activeFolderId={activeFolderId} 
        onSelect={setActiveFolderId}
        onRename={handleRenameWorkspace}
        onDelete={handleDeleteWorkspace}
        onNewSubfolder={handleCreateSubfolder}
      />
      
      <div className="flex-1 flex flex-col h-full bg-gray-50 border-l border-gray-200">
        {selectedItems.length > 0 ? (
          <BulkActionBar 
            onActionComplete={() => activeFolderId && fetchContents(activeFolderId)} 
          />
        ) : (
          <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-800">
              {activeFolderId ? folders.find(f => f.id === activeFolderId)?.name : 'Select a Workspace'}
            </h2>
            <div className="flex gap-2">
              <button onClick={handleCreateFolder} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                <FolderPlus size={16} /> New Folder
              </button>
              {activeFolderId && (
                <>
                  <button onClick={handleSync} disabled={isSyncing} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                    <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} /> Sync
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
          ) : activeFolderId ? (
            <FileGrid
              files={files}
              subfolders={subfolders}
              getDriveInfo={() => ({ drive: null as any, index: 0 })}
              onNavigateFolder={setActiveFolderId}
              onPreviewFile={() => {}}
              onShare={() => {}}
              onRenameFile={() => {}}
              onDeleteFile={handleRemoveFile}
              onMoveDrive={() => {}}
              isTargetShared={() => false}
              errorDrives={new Set()}
              onViewInfo={handleViewInfo}
            />
          ) : (
            <div className="text-center p-12 text-gray-500">
              Select or create a Workspace to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
