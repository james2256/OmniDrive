import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFileStore } from '../stores/fileStore';
import { useUploadStore } from '../stores/uploadStore';
import { useDriveStore } from '../stores/driveStore';
import { Breadcrumb } from '../components/Breadcrumb';
import { FolderCard } from '../components/FolderCard';
import { FileCard } from '../components/FileCard';
import { DropZone } from '../components/DropZone';
import { UploadModal } from '../components/UploadModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { Upload, FolderPlus, X } from 'lucide-react';
import { getDriveColor } from '../lib/utils';
import { useToastStore } from '../stores/toastStore';
import type { FileEntry } from '../types';

export function FilesPage() {
  const { folderId } = useParams();
  const { subfolders, files, breadcrumb, isLoading, searchResults, fetchContents, createFolder, deleteFolder, deleteFile, renameFile, searchFiles, clearSearch } = useFileStore();
  const { drives } = useDriveStore();
  const { showModal, setShowModal, addFiles } = useUploadStore();
  const { addToast } = useToastStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  useEffect(() => {
    fetchContents(folderId);
  }, [folderId, fetchContents]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchFiles(searchQuery.trim());
    }
  };

  const handleCreateFolder = () => {
    const name = prompt('New folder name:');
    if (name?.trim()) {
      createFolder(name.trim(), folderId).catch(() => addToast('error', 'Failed to create folder'));
    }
  };

  const handleDeleteFile = async (id: string) => {
    if (confirm('Delete this file permanently from Google Drive?')) {
      try {
        await deleteFile(id);
        addToast('success', 'File deleted');
      } catch {
        addToast('error', 'Failed to delete file');
      }
    }
  };

  const handleRenameFile = async (id: string, name: string) => {
    try {
      await renameFile(id, name);
      addToast('success', 'File renamed');
    } catch {
      addToast('error', 'Failed to rename file');
    }
  };

  const displayFiles = searchResults ?? files;

  return (
    <DropZone>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <Breadcrumb items={breadcrumb} />
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 'var(--space-xs)' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) clearSearch();
                }}
                style={{ width: 200, paddingRight: 28 }}
              />
              {searchResults && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}
                  onClick={() => { setSearchQuery(''); clearSearch(); }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </form>
          <button className="btn btn-secondary btn-sm" onClick={handleCreateFolder}>
            <FolderPlus size={16} /> New Folder
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.onchange = () => {
              if (input.files?.length) addFiles(Array.from(input.files));
            };
            input.click();
          }}>
            <Upload size={16} /> Upload
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="card" style={{ padding: 'var(--space-sm)' }}>
          {/* Folders */}
          {!searchResults && subfolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onDelete={(id) => deleteFolder(id).catch(() => addToast('error', 'Failed to delete folder'))}
              onRename={(id, name) => {
                // Inline rename via store update is possible but we keep it simple
                api.updateFolder(id, { name }).then(() => fetchContents(folderId));
              }}
            />
          ))}

          {/* Divider */}
          {!searchResults && subfolders.length > 0 && displayFiles.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: 'var(--space-xs) var(--space-md)' }} />
          )}

          {/* Files */}
          {displayFiles.map((file) => {
            const driveIndex = drives.findIndex((d) => d.id === file.driveAccountId);
            return (
              <FileCard
                key={file.id}
                file={file}
                driveColor={getDriveColor(driveIndex >= 0 ? driveIndex : 0)}
                onDelete={handleDeleteFile}
                onRename={handleRenameFile}
                onPreview={setPreviewFile}
              />
            );
          })}

          {/* Empty state */}
          {!searchResults && subfolders.length === 0 && files.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
              <p style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-sm)' }}>📂</p>
              <p>This folder is empty</p>
              <p style={{ fontSize: 'var(--font-size-sm)' }}>Drag & drop files here or click Upload</p>
            </div>
          )}

          {searchResults && displayFiles.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
              No files found for "{searchQuery}"
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showModal && <UploadModal folderId={folderId} onClose={() => setShowModal(false)} />}
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </DropZone>
  );
}

// Need to import api for folder rename
import { api } from '../lib/api';
