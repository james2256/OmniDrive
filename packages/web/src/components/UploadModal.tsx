import { X, Upload, Check, CircleAlert, Loader } from 'lucide-react';
import { useUploadStore } from '../stores/useUploadStore';
import { useDrives } from '../hooks/useDrives';
import { useToastStore } from '../stores/useToastStore';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useState } from 'react';
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
      case 'confirming': return <Loader size={16} className="text-blue-500 animate-spin" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-md p-0 gap-0 rounded-2xl overflow-hidden flex flex-col max-h-full"
        onInteractOutside={(e) => { if (isUploading) e.preventDefault(); }}
      >
        <div className="flex items-center p-5 border-b border-slate-100 shrink-0">
          <DialogTitle className="text-lg font-semibold text-slate-800">Upload Files</DialogTitle>
        </div>

        {/* File list or File Picker */}
        <div className="max-h-[200px] overflow-y-auto px-6 py-2 border-b border-slate-100">
          {queue.length === 0 ? (
            <div className="py-8 flex flex-col items-center justify-center">
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
                className="cursor-pointer flex flex-col items-center gap-3 text-slate-400 hover:text-blue-500 transition-colors"
              >
                <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-500">
                  <Upload size={24} />
                </div>
                <span className="text-sm font-medium">Click to select files</span>
              </label>
            </div>
          ) : (
            queue.map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">
                <span className="flex-1 text-sm text-slate-700 truncate">{item.file.name}</span>
                <span className="text-xs text-slate-400 whitespace-nowrap">{formatFileSize(item.file.size)}</span>
                {item.status === 'uploading' && (
                  <span className="text-xs text-blue-600 min-w-[40px] text-right font-medium">{item.progress}%</span>
                )}
                <div className="w-4 h-4 flex items-center justify-center shrink-0">
                  {statusIcon(item.status)}
                </div>
                {item.status === 'pending' && !isUploading && (
                  <button
                    className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                    onClick={() => removeFile(item.id)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Drive selector */}
        {!isUploading && !allDone && (
          <div className="p-6 pb-2">
            <label className="block text-sm font-medium text-slate-700 mb-3">
              Target Drive
            </label>
            <div className="flex flex-col gap-2">
              <label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${!selectedDriveId ? 'bg-blue-50 border-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input
                  type="radio"
                  name="drive"
                  value=""
                  checked={!selectedDriveId}
                  onChange={() => setSelectedDriveId('')}
                  className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-800">Auto (most free space)</span>
              </label>
              {drives.map((drive, i) => (
                <label key={drive.id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${selectedDriveId === drive.id ? 'bg-blue-50 border-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="drive"
                    value={drive.id}
                    checked={selectedDriveId === drive.id}
                    onChange={() => setSelectedDriveId(drive.id)}
                    className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
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
        <div className="p-5 flex justify-end gap-3 shrink-0">
          {allDone ? (
            <button
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              onClick={handleClose}
            >
              Done
            </button>
          ) : (
            <>
              <button
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                onClick={handleClose}
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUpload}
                disabled={isUploading || queue.length === 0}
              >
                {isUploading ? (
                  <><Loader size={16} className="animate-spin" /> Uploading...</>
                ) : (
                  <><Upload size={16} /> Upload</>
                )}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
