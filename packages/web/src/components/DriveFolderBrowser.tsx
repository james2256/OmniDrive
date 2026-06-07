import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { FileGrid } from './files/FileGrid';
import { getDriveColor } from '../lib/utils';
import { useToastStore } from '../stores/toastStore';
import { useDriveStore } from '../stores/driveStore';
import type { DriveFolder, FileEntry } from '../types';

interface BreadcrumbEntry {
  googleFolderId: string;
  name: string;
}

interface DriveFolderBrowserProps {
  driveId: string;
  driveEmail: string;
  driveIndex: number;
}

export function DriveFolderBrowser({ driveId, driveEmail, driveIndex }: DriveFolderBrowserProps) {
  const { drives } = useDriveStore();
  const { addToast } = useToastStore();

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([
    { googleFolderId: 'root', name: 'My Drive' },
  ]);
  const [subfolders, setSubfolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorFolders, setErrorFolders] = useState<Set<string>>(new Set());

  const currentFolderId = breadcrumb[breadcrumb.length - 1].googleFolderId;

  const loadFolder = useCallback(async (googleFolderId: string) => {
    setIsLoading(true);
    try {
      const data = await api.getDriveFolderContents(driveId, googleFolderId);
      setSubfolders(data.subfolders);
      setFiles(data.files as FileEntry[]);
    } catch {
      addToast('error', 'Gagal memuat folder');
    } finally {
      setIsLoading(false);
    }
  }, [driveId, addToast]);

  useEffect(() => {
    loadFolder(currentFolderId);
  }, [currentFolderId, loadFolder]);

  const handleOpenFolder = async (folder: DriveFolder) => {
    if (errorFolders.has(folder.googleFolderId)) return;

    if (!folder.isSynced) {
      // Lazy sync
      setIsLoading(true);
      try {
        const data = await api.syncDriveFolder(driveId, folder.googleFolderId);
        setBreadcrumb(prev => [...prev, { googleFolderId: folder.googleFolderId, name: folder.name }]);
        setSubfolders(data.subfolders);
        setFiles(data.files as FileEntry[]);
      } catch {
        addToast('error', `Gagal memuat folder "${folder.name}", coba lagi`);
        setErrorFolders(prev => new Set(prev).add(folder.googleFolderId));
      } finally {
        setIsLoading(false);
      }
    } else {
      setBreadcrumb(prev => [...prev, { googleFolderId: folder.googleFolderId, name: folder.name }]);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === breadcrumb.length - 1) return; // Already at this level
    setBreadcrumb(prev => prev.slice(0, index + 1));
  };

  const driveColor = getDriveColor(driveIndex);

  return (
    <div className="drive-folder-browser">
      {/* Header */}
      <div className="dfb-header">
        <div className="dfb-drive-tag" style={{ borderColor: driveColor, color: driveColor }}>
          {driveEmail}
        </div>
        {/* Breadcrumb */}
        <nav className="dfb-breadcrumb" aria-label="Folder navigation">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.googleFolderId} className="dfb-breadcrumb-item">
              {i > 0 && <ChevronRight size={14} className="dfb-breadcrumb-sep" />}
              <button
                className={`dfb-breadcrumb-btn${i === breadcrumb.length - 1 ? ' active' : ''}`}
                onClick={() => handleBreadcrumbClick(i)}
                disabled={i === breadcrumb.length - 1}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      </div>

      {isLoading && (
        <div className="dfb-loading">
          <Loader2 size={18} className="dfb-spinner" />
          <span>Memuat...</span>
        </div>
      )}

      {!isLoading && (
        <>
          {/* Subfolders and Files via FileGrid */}
          {(subfolders.length > 0 || files.length > 0) ? (
            <div className="bg-white rounded-lg border shadow-sm mt-4">
              <FileGrid
                files={files}
                subfolders={subfolders}
                getDriveInfo={(_driveAccountId) => {
                  return { drive: drives[driveIndex], index: driveIndex };
                }}
                onNavigateFolder={(folderId, _targetDriveId) => {
                  const folder = subfolders.find(f => f.googleFolderId === folderId);
                  if (folder) handleOpenFolder(folder);
                }}
                errorDrives={errorFolders}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500 bg-white rounded-lg border mt-4">
              <span className="text-6xl mb-4">📂</span>
              <p>This folder is empty</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
