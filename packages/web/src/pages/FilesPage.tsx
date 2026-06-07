import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useUploadStore } from '../stores/uploadStore';
import { useDriveStore } from '../stores/driveStore';
import { Breadcrumb } from '../components/Breadcrumb';
import { FileGrid } from '../components/files/FileGrid';
import { DropZone } from '../components/DropZone';
import { UploadModal } from '../components/UploadModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { Upload, FolderPlus, X } from 'lucide-react';
import { useToastStore } from '../stores/toastStore';
import { useSharedStore } from '../stores/sharedStore';
import { useMergedDrive } from '../hooks/useMergedDrive';
import { api } from '../lib/api';
import type { FileEntry } from '../types';

export function FilesPage() {
  const { folderId = 'root' } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId');
  const navigate = useNavigate();
  
  const drives = useDriveStore(state => state.drives);
  const { showModal, setShowModal } = useUploadStore();
  const { addToast } = useToastStore();
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string, type: 'file' | 'folder' } | null>(null);
  const [moveFileTarget, setMoveFileTarget] = useState<FileEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { fetchSharedLinks, isTargetShared } = useSharedStore();

  useEffect(() => {
    fetchSharedLinks();
  }, [fetchSharedLinks]);

  const { subfolders, files, breadcrumb, isLoading, errorDrives, refresh } = useMergedDrive(folderId, driveIdParam);

  const handleDeleteFile = async (id: string) => {
    if (confirm('Delete this file permanently from Google Drive?')) {
      try {
        await api.deleteFile(id);
        addToast('success', 'File deleted');
        refresh();
      } catch {
        addToast('error', 'Failed to delete file');
      }
    }
  };

  const handleRenameFile = async (id: string, name: string) => {
    try {
      await api.renameFile(id, name);
      addToast('success', 'File renamed');
      refresh();
    } catch {
      addToast('error', 'Failed to rename file');
    }
  };

  const handleCreateFolder = async () => {
    const name = prompt('New folder name:');
    if (name?.trim()) {
      try {
        await api.createFolder(name.trim(), folderId === 'root' ? undefined : folderId);
        refresh();
      } catch {
        addToast('error', 'Failed to create folder');
      }
    }
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
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4 px-4 pt-4">
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
            <Breadcrumb items={breadcrumb} driveId={driveIdParam || undefined} />
          </div>

          <div className="flex gap-2 items-center">
            <div className="relative">
              <input
                type="text"
                placeholder="Filter files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 pl-3 pr-8 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50" onClick={handleCreateFolder}>
              <FolderPlus size={16} /> New Folder
            </button>
            <button className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700" onClick={() => setShowModal(true)}>
              <Upload size={16} /> Upload
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
            <p className="text-gray-500">Loading folder contents...</p>
          </div>
        ) : drives.length === 0 ? (
          <div className="text-center p-12 text-gray-500 border rounded-lg bg-white m-4">
            <p className="mb-4">No drives connected yet</p>
            <Link to="/settings" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">
              Connect Google Drive
            </Link>
          </div>
        ) : (
          <div className="flex-1 overflow-auto bg-white rounded-lg border border-gray-200 m-4 shadow-sm">
            <FileGrid
              files={filteredFiles}
              subfolders={filteredSubfolders}
              getDriveInfo={getDriveInfo}
              onNavigateFolder={(id, driveId) => navigate(`/files/${id}?driveId=${driveId}`)}
              onPreviewFile={setPreviewFile}
              onShare={(id, type) => setShareTarget({ id, type })}
              onRenameFile={handleRenameFile}
              onDeleteFile={handleDeleteFile}
              onMoveDrive={setMoveFileTarget}
              isTargetShared={isTargetShared}
              errorDrives={errorDrives}
            />
          </div>
        )}

        {/* Modals */}
        {showModal && <UploadModal folderId={folderId} onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); refresh(); }} />}
        {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
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
              refresh();
              addToast('success', 'File moved successfully');
            }}
            onError={(msg) => addToast('error', msg)}
          />
        )}
      </div>
    </DropZone>
  );
}
