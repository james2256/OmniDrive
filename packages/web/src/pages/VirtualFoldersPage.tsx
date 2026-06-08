import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { VirtualFolder, FileEntry, DriveFolder } from '../types';
import { VirtualFolderSidebar } from '../components/virtual-folders/VirtualFolderSidebar';
import { FileGrid } from '../components/files/FileGrid';
import { useToastStore } from '../stores/toastStore';
import { FolderPlus, RefreshCw } from 'lucide-react';
import { useSelectionStore } from '../stores/useSelectionStore';
import { useUIStore } from '../stores/useUIStore';

export function VirtualFoldersPage() {
  const [folders, setFolders] = useState<VirtualFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [subfolders, setSubfolders] = useState<VirtualFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const addToast = useToastStore(state => state.addToast);
  const { clearSelection, toggleSelection } = useSelectionStore();
  const setIsInfoPanelOpen = useUIStore(s => s.setIsInfoPanelOpen);

  const fetchTree = async () => {
    try {
      const res = await api.getVirtualFolderTree();
      setFolders(res.folders);
    } catch {
      addToast('error', 'Failed to load virtual folders');
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

  const handleCreateFolder = async () => {
    const name = prompt('New virtual folder name:');
    if (name?.trim()) {
      try {
        await api.createFolder(name.trim(), activeFolderId || undefined);
        fetchTree();
      } catch {
        addToast('error', 'Failed to create virtual folder');
      }
    }
  };

  const handleSync = async () => {
    if (!activeFolderId) return;
    setIsSyncing(true);
    try {
      await api.syncVirtualFolder(activeFolderId);
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
      addToast('success', 'Removed from virtual folder');
      if (activeFolderId) fetchContents(activeFolderId);
    } catch {
      addToast('error', 'Failed to remove file');
    }
  };

  const handleViewInfo = (item: FileEntry | VirtualFolder | DriveFolder, type: 'file' | 'folder') => {
    clearSelection();
    toggleSelection({ type, item } as any);
    setIsInfoPanelOpen(true);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <VirtualFolderSidebar folders={folders} activeFolderId={activeFolderId} onSelect={setActiveFolderId} />
      
      <div className="flex-1 flex flex-col h-full bg-gray-50 border-l border-gray-200">
        <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-800">
            {activeFolderId ? folders.find(f => f.id === activeFolderId)?.name : 'Select a Virtual Folder'}
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
              Select or create a Virtual Folder to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
