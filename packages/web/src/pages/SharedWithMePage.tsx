import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useDriveStore } from '../stores/driveStore';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import type { FileEntry, DriveFolder, BreadcrumbItem } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';

export function SharedWithMePage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const driveIdParam = searchParams.get('driveId');

  const { drives, fetchDrives } = useDriveStore();
  const { addToast } = useToastStore();

  const [subfolders, setSubfolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: 'root', name: 'Shared with me' }]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const fetchContents = useCallback(async () => {
    setIsLoading(true);
    setSubfolders([]);
    setFiles([]);
    setBreadcrumb([{ id: 'root', name: 'Shared with me' }]);

    try {
      if (!folderId) {
        // Root: shared-with-me list (from DB)
        const data = await api.getSharedWithMe();
        setSubfolders(data.folders ?? []);
        setFiles(data.files ?? []);
      } else if (driveIdParam) {
        // Subfolder: live Google API call
        const data = await api.getSharedFolderContents(driveIdParam, folderId);
        setSubfolders(data.subfolders ?? []);
        setFiles(data.files ?? []);
        if (data.breadcrumb && data.breadcrumb.length > 0) {
          setBreadcrumb([{ id: 'root', name: 'Shared with me' }, ...data.breadcrumb]);
        } else {
          setBreadcrumb([{ id: 'root', name: 'Shared with me' }, { id: folderId, name: 'Folder' }]);
        }
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

  const getDriveInfo = useCallback((driveAccountId?: string) => {
    if (!driveAccountId) return { drive: drives[0] || null, index: 0 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  }, [drives]);

  return (
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
            onNavigateFolder={(id, driveId) => {
              window.location.href = `/shared-with-me/${id}?driveId=${driveId}`;
            }}
            onPreviewFile={setPreviewFile}
            isTargetShared={() => false}
            viewMode="list"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500">
          <p className="text-lg">No shared items found.</p>
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
