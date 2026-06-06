import { X, Upload, Check, AlertCircle, Loader } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import { useDriveStore } from '../stores/driveStore';
import { useToastStore } from '../stores/toastStore';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useState } from 'react';

interface UploadModalProps {
  folderId?: string;
  driveId?: string; // Optional: prepopulate if in a specific drive
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadModal({ folderId, driveId, onClose, onSuccess }: UploadModalProps) {
  const { queue, isUploading, removeFile, startUpload, clearQueue } = useUploadStore();
  const { drives } = useDriveStore();
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

  const allDone = queue.every((item) => item.status === 'done' || item.status === 'error');

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done': return <Check size={16} color="var(--accent-success)" />;
      case 'error': return <AlertCircle size={16} color="var(--accent-danger)" />;
      case 'uploading':
      case 'confirming': return <Loader size={16} className="spinning" />;
      default: return null;
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Upload Files</h2>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}><X size={18} /></button>
        </div>

        {/* File list */}
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 'var(--space-lg)' }}>
          {queue.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }} className="truncate">{item.file.name}</span>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatFileSize(item.file.size)}</span>
              {item.status === 'uploading' && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-primary)', minWidth: 40, textAlign: 'right' }}>{item.progress}%</span>
              )}
              {statusIcon(item.status)}
              {item.status === 'pending' && !isUploading && (
                <button className="btn btn-ghost btn-sm" onClick={() => removeFile(item.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Drive selector */}
        {!isUploading && !allDone && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Target Drive
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: !selectedDriveId ? 'var(--accent-primary-subtle)' : 'transparent' }}>
                <input type="radio" name="drive" value="" checked={!selectedDriveId} onChange={() => setSelectedDriveId('')} />
                <span style={{ fontSize: 'var(--font-size-sm)' }}>Auto (most free space)</span>
              </label>
              {drives.map((drive, i) => (
                <label key={drive.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: selectedDriveId === drive.id ? 'var(--accent-primary-subtle)' : 'transparent' }}>
                  <input type="radio" name="drive" value={drive.id} checked={selectedDriveId === drive.id} onChange={() => setSelectedDriveId(drive.id)} />
                  <div className="drive-dot" style={{ backgroundColor: getDriveColor(i) }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', flex: 1 }}>{drive.email}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{formatFileSize(drive.freeSpace)} free</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          {allDone ? (
            <button className="btn btn-primary" onClick={handleClose}>Done</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleClose} disabled={isUploading}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={isUploading || queue.length === 0}>
                {isUploading ? <><Loader size={16} className="spinning" /> Uploading...</> : <><Upload size={16} /> Upload</>}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        .spinning { animation: spin 1s linear infinite; }
        input[type="radio"] { accent-color: var(--accent-primary); }
      `}</style>
    </div>
  );
}
