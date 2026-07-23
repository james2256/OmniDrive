import { useState } from 'react';
import { HardDrive, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { useDrives } from '../hooks/useDrives';
import { useMoveFileToDrive } from '../hooks/useFileMutations';
import type { FileEntry, DriveAccount } from '../types';
import { formatFileSize } from '../lib/utils';
import { useToastStore } from '../stores/useToastStore';

interface MoveDriveModalProps {
  files: FileEntry[];
  onClose: () => void;
  onSuccess: () => void;
}

export function MoveDriveModal({ files, onClose, onSuccess }: MoveDriveModalProps) {
  const { data: drivesData } = useDrives();
  const drives = drivesData?.drives ?? [];
  const addToast = useToastStore((s) => s.addToast);
  const moveFileToDriveMut = useMoveFileToDrive();
  const [isMoving, setIsMoving] = useState(false);
  const [movingToDriveId, setMovingToDriveId] = useState<string | null>(null);

  const availableDrives = files.length === 1
    ? drives.filter(d => d.id !== files[0].driveAccountId)
    : drives;

  const handleMove = async (drive: DriveAccount) => {
    if (files.length === 0) return;
    setIsMoving(true);
    setMovingToDriveId(drive.id);

    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      if (file.driveAccountId === drive.id) continue;
      try {
        await moveFileToDriveMut.mutateAsync({ fileId: file.id, targetDriveId: drive.id });
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (failCount === 0 && successCount > 0) {
      addToast('success', `Moved ${successCount} item(s) to ${drive.email}`);
    } else if (failCount > 0) {
      addToast('error', `Moved ${successCount} item(s), ${failCount} failed`);
    } else if (successCount === 0 && failCount === 0) {
      addToast('info', 'Items are already in the selected drive');
    }

    setIsMoving(false);
    setMovingToDriveId(null);
    if (successCount > 0) {
      onSuccess();
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={files.length > 0} onOpenChange={(open) => !open && !isMoving && onClose()}>
      <DialogContent className="max-w-md p-4 rounded-xl">
        <DialogTitle className="text-sm font-semibold text-slate-800 mb-1">Move to Another Drive</DialogTitle>
        <DialogDescription className="text-xs text-slate-500 mb-3">
          Select a destination drive to move {files.length} item(s).
        </DialogDescription>
        <div className="grid gap-2 max-h-[50vh] overflow-y-auto">
          {availableDrives.length === 0 ? (
            <p className="text-sm text-center text-slate-500 py-4">
              No other drives available. Please connect another Google Drive account.
            </p>
          ) : (
            availableDrives.map(drive => (
              <button
                key={drive.id}
                onClick={() => handleMove(drive)}
                disabled={isMoving}
                className={`flex items-center p-2.5 border border-slate-200 rounded-lg transition-colors text-left ${
                  isMoving && movingToDriveId !== drive.id
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-slate-50'
                } ${isMoving && movingToDriveId === drive.id ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50' : ''}`}
              >
                <div className="flex-shrink-0 mr-2.5">
                  {isMoving && movingToDriveId === drive.id ? (
                    <LoaderCircle className="w-4 h-4 text-blue-500 animate-spin" />
                  ) : (
                    <HardDrive className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {drive.email}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatFileSize(drive.freeSpace)} free
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
