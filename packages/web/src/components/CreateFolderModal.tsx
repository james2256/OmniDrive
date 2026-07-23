import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToastStore } from '../stores/useToastStore';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import type { DriveAccount } from '../types';

interface CreateFolderModalProps {
  open: boolean;
  /** null = root-level (workspace or top-level folder), string = child of that parent */
  parentId: string | null;
  /** Dialog title, e.g. "New Folder" or "New Workspace" */
  title: string;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * If provided, creates a Google Drive folder in this drive instead of a
   * workspace folder. When omitted, falls back to workspace folder creation
   * (POST /api/folders).
   */
  driveId?: string;
  /**
   * Available drives — shown as a picker when `driveId` is not set and there
   * is more than one drive. If only one drive exists, it is auto-selected.
   */
  drives?: DriveAccount[];
}

export function CreateFolderModal({ open, parentId, title, onClose, onSuccess, driveId, drives }: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [selectedDriveId, setSelectedDriveId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const addToast = useToastStore((s) => s.addToast);

  // Reset state each time the modal opens so stale input/errors don't persist.
  useEffect(() => {
    if (open) {
      setName('');
      setError('');
      // If a driveId prop is provided, always use it. Otherwise, auto-select
      // when there's exactly one drive (common case — single Google account).
      setSelectedDriveId(driveId ?? (drives && drives.length === 1 ? drives[0].id : ''));
    }
  }, [open, driveId, drives]);

  const entityLabel = title.replace(/^New\s+/, '');

  // Show the drive picker only when we're in Drive mode but no specific drive
  // is pre-selected and there's more than one drive to choose from.
  const showDrivePicker = !driveId && (drives?.length ?? 0) > 1;
  const effectiveDriveId = driveId || selectedDriveId || (drives && drives.length === 1 ? drives[0].id : '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(`${entityLabel} name is required`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (effectiveDriveId) {
        // Google Drive folder creation
        await api.createDriveFolder(effectiveDriveId, trimmed, parentId ?? undefined);
      } else {
        // Workspace folder / workspace creation (existing behavior)
        await api.createFolder(trimmed, parentId ?? undefined);
      }
      addToast('success', `${entityLabel} created successfully`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : `Failed to create ${entityLabel.toLowerCase()}`));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md p-4 rounded-xl">
        <DialogTitle className="text-sm font-semibold text-slate-800 mb-3">{title}</DialogTitle>
        {error && (
          <div className="text-red-500 mb-3 text-sm bg-red-50 p-2 rounded-lg border border-red-100">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          {showDrivePicker && (
            <select
              value={selectedDriveId}
              onChange={(e) => setSelectedDriveId(e.target.value)}
              className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
            >
              <option value="">Select a drive…</option>
              {(drives ?? []).map((drive, i) => (
                <option key={drive.id} value={drive.id}>
                  {drive.email} ({i + 1})
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            autoFocus
            placeholder={`Enter ${entityLabel.toLowerCase()} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
          />
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center justify-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || (showDrivePicker && !selectedDriveId)}
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Create'
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
