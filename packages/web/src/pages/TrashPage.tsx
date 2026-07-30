import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { FilesToolbar } from '../components/layout/FilesToolbar';
import { FileGrid } from '../components/files/FileGrid';
import { BulkActionBar } from '../components/layout/BulkActionBar';
import { filesApi } from '../lib/api/files';
import { useDrives, useGetDriveInfo } from '../hooks/useDrives';
import { useSharedLinks, useIsTargetSharedCallback } from '../hooks/useSharedLinks';
import { qk } from '../lib/queryKeys';
import { useUIStore } from '../stores/useUIStore';
import type { FileEntry } from '../types';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useRestoreFile, usePermanentDeleteFile } from '../hooks/useFileMutations';
import { useRestoreDriveFolder, usePermanentDeleteDriveFolder } from '../hooks/useFolderMutations';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Trash2 } from 'lucide-react';

export function TrashPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const { data: sharedLinks = [] } = useSharedLinks();
  const isTargetShared = useIsTargetSharedCallback(sharedLinks);
  const { viewMode, setViewMode, isInfoPanelOpen, toggleInfoPanel } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [confirmFileDelete, setConfirmFileDelete] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<{
    driveId: string;
    folderId: string;
  } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.trash,
    queryFn: () => filesApi.getTrashFiles(),
  });

  const fileResults = data?.files ?? [];
  const folderResults = data?.folders ?? [];

  const filteredFiles = fileResults.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredFolders = folderResults.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const restoreFileMut = useRestoreFile();
  const permanentDeleteFileMut = usePermanentDeleteFile();
  const restoreDriveFolderMut = useRestoreDriveFolder();
  const permanentDeleteDriveFolderMut = usePermanentDeleteDriveFolder();

  const handleRestore = (fileId: string) => restoreFileMut.mutate(fileId);
  const handlePermanentDelete = (fileId: string) => setConfirmFileDelete(fileId);
  const handleRestoreFolder = (driveId: string, folderId: string) =>
    restoreDriveFolderMut.mutate({ driveId, folderId });
  const handlePermanentDeleteFolder = (driveId: string, folderId: string) =>
    setConfirmFolderDelete({ driveId, folderId });

  const getDriveInfo = useGetDriveInfo(drives);

  const hasItems = filteredFiles.length > 0 || filteredFolders.length > 0;

  return (
    <div className="p-2 sm:p-6 space-y-2">
      <PageHeader
        title="Trash"
        icon={Trash2}
        description="Deleted files and folders — permanently removed after 30 days"
      />

      <FilesToolbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        viewMode={viewMode}
        setViewMode={setViewMode}
        isInfoPanelOpen={isInfoPanelOpen}
        toggleInfoPanel={toggleInfoPanel}
        bulkActionBar={<BulkActionBar isTrashView={true} onActionComplete={() => {}} />}
      />

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : hasItems ? (
        <div className="bg-card rounded-xl border border-slate-200 overflow-hidden">
          <FileGrid
            files={filteredFiles}
            subfolders={filteredFolders}
            getDriveInfo={getDriveInfo}
            isTargetShared={isTargetShared}
            viewMode={viewMode}
            isTrashView={true}
            actions={{
              onPreviewFile: setPreviewFile,
              onRestore: handleRestore,
              onPermanentDelete: handlePermanentDelete,
              onRestoreFolder: handleRestoreFolder,
              onPermanentDeleteFolder: handlePermanentDeleteFolder,
            }}
          />
        </div>
      ) : (
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          description="Deleted files and folders will appear here."
        />
      )}
      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
      <ConfirmDialog
        open={confirmFileDelete !== null}
        title="Permanently Delete File"
        message="Permanently delete this file? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={permanentDeleteFileMut.isPending}
        onConfirm={async () => {
          if (!confirmFileDelete) return;
          await permanentDeleteFileMut.mutateAsync(confirmFileDelete);
          setConfirmFileDelete(null);
        }}
        onClose={() => setConfirmFileDelete(null)}
      />
      <ConfirmDialog
        open={confirmFolderDelete !== null}
        title="Permanently Delete Folder"
        message="Permanently delete this folder and ALL its contents? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={permanentDeleteDriveFolderMut.isPending}
        onConfirm={async () => {
          if (!confirmFolderDelete) return;
          await permanentDeleteDriveFolderMut.mutateAsync(confirmFolderDelete);
          setConfirmFolderDelete(null);
        }}
        onClose={() => setConfirmFolderDelete(null)}
      />
    </div>
  );
}
