import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDriveStore } from '../stores/driveStore';
import { useSharedStore } from '../stores/sharedStore';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { api } from '../lib/api';
import type { FileEntry } from '../types';

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  
  const { drives } = useDriveStore();
  const { isTargetShared } = useSharedStore();
  const { addToast } = useToastStore();
  
  const [results, setResults] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const [shareTarget, setShareTarget] = useState<{ id: string, type: 'file' | 'folder' } | null>(null);
  const [moveFileTarget, setMoveFileTarget] = useState<FileEntry | null>(null);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const fetchResults = async (q: string) => {
    if (!q) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await api.searchFiles(q);
      setResults(data.files);
    } catch (error) {
      addToast('error', 'Failed to perform search');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchResults(query);
  }, [query]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">Search results for "{query}"</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : results.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <FileGrid
            files={results}
            subfolders={[]}
            getDriveInfo={(driveAccountId) => {
              if (!driveAccountId) return { drive: null, index: 0 };
              const index = drives.findIndex((d) => d.id === driveAccountId);
              if (index === -1) return { drive: drives[0] || null, index: 0 };
              return { drive: drives[index], index };
            }}
            onShare={(id, type) => setShareTarget({ id, type })}
            onMoveDrive={setMoveFileTarget}
            onPreviewFile={setPreviewFile}
            isTargetShared={isTargetShared}
            viewMode="list"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <p className="text-lg">No files found matching '{query}'.</p>
        </div>
      )}

      {shareTarget && (
        <ShareModal
          targetType={shareTarget.type}
          targetId={shareTarget.id}
          onClose={() => setShareTarget(null)}
        />
      )}

      {moveFileTarget && (
        <MoveDriveModal
          file={moveFileTarget}
          onClose={() => setMoveFileTarget(null)}
          onSuccess={() => {
            setMoveFileTarget(null);
            fetchResults(query);
            addToast('success', 'File moved successfully');
          }}
          onError={(msg) => addToast('error', msg)}
        />
      )}

      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
