import { X, Upload, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { useUploadStore } from '../stores/useUploadStore';
import { useDrives } from '../hooks/useDrives';
import { useToastStore } from '../stores/useToastStore';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

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

  // Sync selected drive when the `driveId` prop changes (e.g. navigating to
  // a different drive's folder and re-opening the upload modal).
  useEffect(() => {
    setSelectedDriveId(driveId || '');
  }, [driveId]);

  const handleUpload = async () => {
    try {
      await startUpload(selectedDriveId || undefined, folderId);
      addToast('success', 'Upload completed');
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

  const allDone = queue.length > 0 && queue.every((item) => item.status === 'done' || item.status === 'error');

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done': return <Check size={16} className="text-green-500" />;
      case 'error': return <CircleAlert size={16} className="text-red-500" />;
      case 'uploading':
      case 'confirming': return <LoaderCircle size={16} className="text-blue-500 animate-spin" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-md p-4 rounded-xl max-h-[85vh] overflow-y-auto"
        onInteractOutside={(e) => { if (isUploading) e.preventDefault(); }}
      >
        <DialogTitle className="text-sm font-semibold text-slate-800 mb-3">Upload Files</DialogTitle>

        {/* File list or File Picker */}
        {queue.length === 0 ? (
          <div className="py-6 flex flex-col items-center justify-center">
            <input
              type="file"
              multiple
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
              className="cursor-pointer flex flex-col items-center gap-2 text-slate-500 hover:text-blue-500 transition-colors"
            >
              <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-500">
                <Upload size={20} />
              </div>
              <span className="text-sm font-medium">Click to select files</span>
            </label>
          </div>
        ) : (
          <div className="max-h-[160px] overflow-y-auto mb-2">
            {queue.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                <span className="flex-1 text-sm text-slate-700 truncate">{item.file.name}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">{formatFileSize(item.file.size)}</span>
                {item.status === 'uploading' && (
                  <span className="text-xs text-blue-600 min-w-[36px] text-right font-medium">{item.progress}%</span>
                )}
                <div className="w-4 h-4 flex items-center justify-center shrink-0">
                  {statusIcon(item.status)}
                </div>
                {item.status === 'pending' && !isUploading && (
                  <button
                    className="p-1 text-slate-500 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                    onClick={() => removeFile(item.id)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Drive selector */}
        {!isUploading && !allDone && (
          <div className="mb-2">
            <div className="flex flex-col gap-1.5">
              <label className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer border transition-colors ${!selectedDriveId ? 'bg-blue-50 border-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input
                  type="radio"
                  name="drive"
                  value=""
                  checked={!selectedDriveId}
                  onChange={() => setSelectedDriveId('')}
                  className="w-4 h-4 text-blue-600 border-slate-400 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-800">Auto (most free space)</span>
              </label>
              {drives.map((drive, i) => (
                <label key={drive.id} className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer border transition-colors ${selectedDriveId === drive.id ? 'bg-blue-50 border-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="drive"
                    value={drive.id}
                    checked={selectedDriveId === drive.id}
                    onChange={() => setSelectedDriveId(drive.id)}
                    className="w-4 h-4 text-blue-600 border-slate-400 focus:ring-blue-500"
                  />
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getDriveColor(i) }} />
                  <span className="text-sm text-slate-800 flex-1 truncate">{drive.email}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{formatFileSize(drive.freeSpace)} free</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-2">
          {allDone ? (
            <button
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              onClick={handleClose}
            >
              Done
            </button>
          ) : (
            <>
              <button
                className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                onClick={handleClose}
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUpload}
                disabled={isUploading || queue.length === 0}
              >
                {isUploading ? (
                  <><LoaderCircle size={14} className="animate-spin" /> Uploading...</>
                ) : (
                  <><Upload size={14} /> Upload</>
                )}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
