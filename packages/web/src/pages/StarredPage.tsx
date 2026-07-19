import { useEffect, useState, useCallback } from 'react';
import { useDriveStore } from '../stores/driveStore';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import type { FileEntry, WorkspaceFolder, DriveFolder } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';

export function StarredPage() {
  const { drives, fetchDrives } = useDriveStore();
  const { addToast } = useToastStore();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [wsFolders, setWsFolders] = useState<WorkspaceFolder[]>([]);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const fetchStarred = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getStarred();
      setFiles(data.files);
      setWsFolders(data.folders);
      setDriveFolders(data.driveFolders);
    } catch {
      addToast('error', 'Failed to load starred items');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchDrives();
    fetchStarred();
  }, [fetchDrives, fetchStarred]);

  const handleToggleStar = async (id: string, type: 'file' | 'folder', currentStarStatus: boolean, driveId?: string) => {
    try {
      if (type === 'file') {
        if (currentStarStatus) {
          await api.unstarFile(id);
          addToast('success', 'File unstarred');
          setFiles((prev) => prev.filter((f) => f.id !== id));
        } else {
          await api.starFile(id);
          addToast('success', 'File starred');
        }
      } else if (driveId) {
        // Google Drive folder — use the drive-folder star API
        if (currentStarStatus) {
          await api.unstarDriveFolder(driveId, id);
          addToast('success', 'Folder unstarred');
          setDriveFolders((prev) => prev.filter((f) => f.googleFolderId !== id));
        } else {
          await api.starDriveFolder(driveId, id);
          addToast('success', 'Folder starred');
        }
      } else {
        // Workspace folder — use the workspace-folder star API
        if (currentStarStatus) {
          await api.unstarFolder(id);
          addToast('success', 'Folder unstarred');
          setWsFolders((prev) => prev.filter((f) => f.id !== id));
        } else {
          await api.starFolder(id);
          addToast('success', 'Folder starred');
        }
      }
    } catch {
      addToast('error', 'Failed to update star status');
    }
  };

  const getDriveInfo = useCallback((driveAccountId?: string) => {
    if (!driveAccountId) return { drive: null, index: 0 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  }, [drives]);

  // Combine workspace folders and Drive folders into a single list for FileGrid.
  const allFolders = [...wsFolders, ...driveFolders];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-800">Starred</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : files.length > 0 || allFolders.length > 0 ? (
        <div className="bg-card rounded-xl border border-stone-200 overflow-hidden">
          <FileGrid
            files={files}
            subfolders={allFolders}
            getDriveInfo={getDriveInfo}
            isTargetShared={() => false}
            viewMode="list"
            actions={{
              onToggleStar: handleToggleStar,
              onPreviewFile: setPreviewFile,
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">No starred items found.</p>
        </div>
      )}
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}
