import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useDriveStore } from '../stores/driveStore';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { MoveModal } from '../components/MoveModal';
import { ShareModal } from '../components/ShareModal';
import { api } from '../lib/api';
import type { FileEntry, DriveFolder, BreadcrumbItem, WorkspaceFolder } from '../types';
import type { SelectedItem } from '../stores/useSelectionStore';
import { useSelectionStore } from '../stores/useSelectionStore';
import { FilePreviewModal } from '../components/FilePreviewModal';

export function SharedWithMePage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId');
  const navigate = useNavigate();

  const { drives, fetchDrives } = useDriveStore();
  const { addToast } = useToastStore();
  const { selectedItems, clearSelection } = useSelectionStore();

  const [subfolders, setSubfolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: 'root', name: 'Shared with me' }]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveTarget, setMoveTarget] = useState<SelectedItem[]>([]);

  const fetchContents = useCallback(async () => {
    setIsLoading(true);
    setSubfolders([]);
    setFiles([]);
    setBreadcrumb([{ id: 'root', name: 'Shared with me' }]);

    try {
      if (!folderId) {
        const data = await api.getSharedWithMe();
        setSubfolders(data.folders ?? []);
        setFiles(data.files ?? []);
      } else if (driveIdParam) {
        const data = await api.getSharedFolderContents(driveIdParam, folderId);
        setSubfolders(data.subfolders ?? []);
        setFiles(data.files ?? []);
        setBreadcrumb([{ id: 'root', name: 'Shared with me' }, { id: folderId, name: 'Folder' }]);
      } else {
        addToast('error', 'Missing drive information for folder');
      }
    } catch {
      addToast('error', 'Failed to load shared items');
    } finally {
      setIsLoading(false);
    }
  }, [folderId, driveIdParam, addToast]);

  useEffect(() => {
    fetchDrives();
    fetchContents();
  }, [fetchDrives, fetchContents]);

  const refresh = () => fetchContents();

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

  const handleDeleteFolder = async (driveId: string, folderId: string) => {
    if (confirm('Delete this folder and ALL its contents from Google Drive?')) {
      try {
        await api.deleteDriveFolder(driveId, folderId);
        addToast('success', 'Folder deleted');
        refresh();
      } catch {
        addToast('error', 'Failed to delete folder');
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

  const handleRenameFolder = async (driveId: string, folderId: string, name: string) => {
    try {
      await api.renameDriveFolder(driveId, folderId, name);
      addToast('success', 'Folder renamed');
      refresh();
    } catch {
      addToast('error', 'Failed to rename folder');
    }
  };

  const handleToggleStar = async (id: string, type: 'file' | 'folder', currentStarStatus: boolean, driveId?: string) => {
    try {
      if (type === 'file') {
        if (currentStarStatus) {
          await api.unstarFile(id);
        } else {
          await api.starFile(id);
        }
      } else if (driveId) {
        if (currentStarStatus) {
          await api.unstarDriveFolder(driveId, id);
        } else {
          await api.starDriveFolder(driveId, id);
        }
      }
      addToast('success', 'Star status updated');
      refresh();
    } catch {
      addToast('error', 'Failed to update star status');
    }
  };

  const handleViewInfo = (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => {
    console.warn('View info:', item, type);
  };

  const getDriveInfo = useCallback((driveAccountId?: string) => {
    if (!driveAccountId) return { drive: drives[0] || null, index: 0 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  }, [drives]);

  return (
    <div className="flex flex-col h-full w-full">
      <BulkActionBar
        onActionComplete={() => refresh()}
        onMoveRequested={() => setMoveTarget(selectedItems)}
        onMoveDriveRequested={() => {
          const fileItems = selectedItems.filter(i => i.type === 'file').map(i => i.item as FileEntry);
          console.warn('Move drive:', fileItems);
        }}
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-stone-600">
          {breadcrumb.map((item, i) => (
            <span key={item.id ?? `fallback-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={14} className="text-stone-400" />}
              {i < breadcrumb.length - 1 ? (
                <Link to="/shared-with-me" className="hover:text-stone-900 hover:underline">
                  {item.name}
                </Link>
              ) : (
                <span className="font-medium text-stone-800">{item.name}</span>
              )}
            </span>
          ))}
        </nav>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : subfolders.length > 0 || files.length > 0 ? (
          <div className="bg-card rounded-xl border border-stone-200 overflow-hidden">
            <FileGrid
              files={files}
              subfolders={subfolders}
              getDriveInfo={getDriveInfo}
              isTargetShared={() => false}
              viewMode="list"
              actions={{
                onNavigateFolder: (id, driveId) => navigate(`/shared-with-me/${id}?driveId=${driveId}`),
                onPreviewFile: setPreviewFile,
                onShare: (id, type) => setShareTarget({ id, type }),
                onRenameFile: handleRenameFile,
                onRenameFolder: handleRenameFolder,
                onDeleteFile: handleDeleteFile,
                onDeleteFolder: handleDeleteFolder,
                onViewInfo: handleViewInfo,
                onToggleStar: handleToggleStar,
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-stone-500">
            <p className="text-lg">No shared items found.</p>
          </div>
        )}
      </div>

      {/* Modals */}
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
      <ShareModal
        open={!!shareTarget}
        targetType={shareTarget?.type ?? 'file'}
        targetId={shareTarget?.id ?? ''}
        onClose={() => setShareTarget(null)}
      />
      <MoveModal
        open={moveTarget.length > 0}
        items={moveTarget}
        driveId={driveIdParam || drives[0]?.id || ''}
        onClose={() => setMoveTarget([])}
        onSuccess={() => {
          clearSelection();
          refresh();
        }}
      />
    </div>
  );
}
