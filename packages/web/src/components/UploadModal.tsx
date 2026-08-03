import {
  X,
  Upload,
  Check,
  CircleAlert,
  LoaderCircle,
  FolderUp,
  FileUp,
  Folder,
} from 'lucide-react';
import { useUploadStore } from '../stores/useUploadStore';
import { useDrives } from '../hooks/useDrives';
import { useToastStore } from '../stores/useToastStore';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/Button';

interface UploadModalProps {
  open: boolean;
  folderId?: string;
  driveId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadModal({ open, folderId, driveId, onClose, onSuccess }: UploadModalProps) {
  const { queue, isUploading, removeFile, startUpload, clearQueue } = useUploadStore();
  const { data: drivesData } = useDrives();
  const drives = drivesData?.drives ?? [];
  const { addToast } = useToastStore();
  const [selectedDriveId, setSelectedDriveId] = useState<string>(driveId || '');
  const [folderMode, setFolderMode] = useState(false);

  useEffect(() => {
    setSelectedDriveId(driveId || '');
  }, [driveId]);

  const handleUpload = async () => {
    let resolvedDriveId = selectedDriveId || undefined;

    // Only auto-resolve if there are folder-structured files in the queue.
    // Flat file uploads (no webkitRelativePath) use server-side Auto as before.
    // NOTE: This mirrors UploadRouter.selectDriveForUpload (upload-router.ts:31-32).
    // Folder upload can't use server-side per-file Auto — the whole tree must
    // live on one drive — so we resolve once client-side.
    const hasFolderFiles = useUploadStore.getState().queue.some((item) => {
      const relPath = (item.file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return relPath && relPath.includes('/');
    });

    if (!resolvedDriveId && hasFolderFiles) {
      if (drives.length === 0) {
        addToast('error', 'No connected drives. Connect a Google Drive account first.');
        return;
      }
      const totalSize = useUploadStore
        .getState()
        .queue.reduce((sum, item) => sum + item.file.size, 0);
      // Same logic as server: sort by freeSpace desc, pick [0].
      const sorted = [...drives].sort((a, b) => b.freeSpace - a.freeSpace);
      const bestDrive = sorted[0];

      if (bestDrive.freeSpace < totalSize) {
        addToast(
          'error',
          `Folder is ${formatFileSize(totalSize)} but largest drive has only ${formatFileSize(bestDrive.freeSpace)} free. Select a drive manually or split the folder.`,
        );
        return;
      }
      resolvedDriveId = bestDrive.id;
    }

    try {
      await startUpload(resolvedDriveId, folderId);
      const { queue: finalQueue } = useUploadStore.getState();
      const failedCount = finalQueue.filter((q) => q.status === 'error').length;
      const succeededCount = finalQueue.filter((q) => q.status === 'done').length;

      if (succeededCount === 0 && failedCount > 0) {
        addToast('error', `Upload failed — ${failedCount} file(s) could not be uploaded`);
      } else if (failedCount > 0) {
        addToast('success', `${succeededCount} file(s) uploaded, ${failedCount} failed`);
      } else {
        addToast('success', 'Upload completed');
      }
      onSuccess();
    } catch {
      addToast('error', 'Upload failed');
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      clearQueue();
      onClose();
    }
  };

  const allDone =
    queue.length > 0 && queue.every((item) => item.status === 'done' || item.status === 'error');

  // Group queue items by directory prefix from webkitRelativePath.
  // Flat files (no webkitRelativePath) get dir = '' → no header → same as before.
  const groupedQueue = useMemo(() => {
    if (queue.length === 0) return [];
    const groups: { dir: string; items: typeof queue }[] = [];
    const groupMap = new Map<string, typeof queue>();

    for (const item of queue) {
      const relPath =
        (item.file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const dir = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      let group = groupMap.get(dir);
      if (!group) {
        group = [];
        groupMap.set(dir, group);
        groups.push({ dir, items: group });
      }
      group.push(item);
    }
    return groups;
  }, [queue]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done':
        return <Check size={16} className="text-green-500" />;
      case 'error':
        return <CircleAlert size={16} className="text-red-500" />;
      case 'uploading':
      case 'confirming':
        return <LoaderCircle size={16} className="text-primary animate-spin" />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-md p-0 gap-0 flex flex-col overflow-hidden max-h-[85vh]"
        onInteractOutside={(e) => {
          if (isUploading) e.preventDefault();
        }}
      >
        <DialogHeader icon={<Upload size={20} className="text-primary" />}>
          <DialogTitle>Upload Files</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {/* File list or File Picker */}
          {queue.length === 0 ? (
            <div className="py-6 flex flex-col items-center justify-center">
              <input
                type="file"
                multiple
                {...(folderMode ? { webkitdirectory: '' } : {})}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    useUploadStore.getState().addFiles(Array.from(e.target.files));
                  }
                }}
                className="hidden"
                id="modal-file-upload"
              />
              <label
                htmlFor="modal-file-upload"
                className="cursor-pointer flex flex-col items-center gap-2 text-slate-500 hover:text-primary transition-colors"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                  {folderMode ? <FolderUp size={20} /> : <Upload size={20} />}
                </div>
                <span className="text-sm font-medium">
                  {folderMode ? 'Click to select a folder' : 'Click to select files'}
                </span>
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 text-xs text-slate-500"
                onClick={() => setFolderMode((f) => !f)}
              >
                {folderMode ? (
                  <>
                    <FileUp size={14} className="mr-1" /> Switch to files
                  </>
                ) : (
                  <>
                    <FolderUp size={14} className="mr-1" /> Upload a folder
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="max-h-[160px] overflow-y-auto mb-2">
              {groupedQueue.map(({ dir, items }) => (
                <div key={dir || '_root'}>
                  {dir && (
                    <div className="flex items-center gap-1.5 py-1.5 px-1 text-xs font-semibold text-slate-500">
                      <Folder size={12} />
                      <span className="truncate">{dir}/</span>
                    </div>
                  )}
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 py-2 border-b border-slate-100 last:border-0 ${dir ? 'pl-4' : ''}`}
                    >
                      <span className="flex-1 text-sm text-slate-700 truncate">
                        {item.file.name}
                      </span>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {formatFileSize(item.file.size)}
                      </span>
                      {item.status === 'uploading' && (
                        <span className="text-xs text-primary min-w-[36px] text-right font-medium">
                          {item.progress}%
                        </span>
                      )}
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        {statusIcon(item.status)}
                      </div>
                      {item.status === 'pending' && !isUploading && (
                        <Button
                          variant="ghost"
                          className="p-1 text-slate-500 hover:text-slate-600 hover:bg-slate-100 rounded-md"
                          onClick={() => removeFile(item.id)}
                          aria-label="Remove file"
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Drive selector */}
          {!isUploading && !allDone && (
            <div className="mb-2">
              <div className="flex flex-col gap-1.5">
                <label
                  className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer border transition-colors ${!selectedDriveId ? 'bg-primary/10 border-primary/20' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <input
                    type="radio"
                    name="drive"
                    value=""
                    checked={!selectedDriveId}
                    onChange={() => setSelectedDriveId('')}
                    className="w-4 h-4 text-primary border-slate-400 focus-visible:ring-primary"
                  />
                  <span className="text-sm text-slate-800">Auto (most free space)</span>
                </label>
                {drives.map((drive, i) => (
                  <label
                    key={drive.id}
                    className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer border transition-colors ${selectedDriveId === drive.id ? 'bg-primary/10 border-primary/20' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <input
                      type="radio"
                      name="drive"
                      value={drive.id}
                      checked={selectedDriveId === drive.id}
                      onChange={() => setSelectedDriveId(drive.id)}
                      className="w-4 h-4 text-primary border-slate-400 focus-visible:ring-primary"
                    />
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getDriveColor(i) }}
                    />
                    <span className="text-sm text-slate-800 flex-1 truncate">{drive.email}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {formatFileSize(drive.freeSpace)} free
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {allDone ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose} disabled={isUploading}>
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={isUploading || queue.length === 0}
                loading={isUploading}
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
