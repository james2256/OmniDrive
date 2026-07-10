import { useEffect, useState, useCallback } from 'react';
import { useDriveStore } from '../stores/driveStore';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';

export function TrashPage() {
  const { drives } = useDriveStore();
  const { addToast } = useToastStore();
  
  const [results, setResults] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const fetchTrash = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getTrashFiles();
      setResults(data.files);
    } catch (error) {
      addToast('error', 'Failed to load trash');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (fileId: string) => {
    try {
      await api.restoreFile(fileId);
      addToast('success', 'File restored successfully');
      fetchTrash();
    } catch (error) {
      addToast('error', 'Failed to restore file');
    }
  };

  const handlePermanentDelete = async (fileId: string) => {
    try {
      await api.deleteFilePermanent(fileId);
      addToast('success', 'File permanently deleted');
      fetchTrash();
    } catch (error) {
      addToast('error', 'Failed to permanently delete file');
    }
  };

  const getDriveInfo = useCallback((driveAccountId?: string) => {
    if (!driveAccountId) return { drive: null, index: 0 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  }, [drives]);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-800">Trash</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : results.length > 0 ? (
        <div className="bg-card rounded-xl border border-stone-200 overflow-hidden">
          <FileGrid
            files={results}
            subfolders={[]}
            getDriveInfo={getDriveInfo}
            onShare={() => {}}
            onMoveDrive={() => {}}
            onPreviewFile={setPreviewFile}
            isTargetShared={() => false}
            viewMode="list"
            isTrashView={true}
            onRestore={handleRestore}
            onPermanentDelete={handlePermanentDelete}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">Your trash is empty.</p>
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
