import { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useToastStore } from '../stores/useToastStore';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle } from './ui/dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
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
      setSelectedDriveId(driveId ?? (drives && drives.length === 1 ? drives[0].id : ''));
    }
  }, [open, driveId, drives]);

  const entityLabel = title.replace(/^New\s+/, '');

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
        await api.createDriveFolder(effectiveDriveId, trimmed, parentId ?? undefined);
      } else {
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
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<FolderPlus size={20} className="text-primary" />}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogBody>
            {error && (
              <div className="text-red-500 mb-3 text-sm bg-red-50 p-2 rounded-lg border border-red-100">
                {error}
              </div>
            )}
            {showDrivePicker && (
              <div className="flex flex-col gap-1 mb-2.5">
                <label className="text-xs font-medium text-slate-600">Target Drive</label>
                <select
                  value={selectedDriveId}
                  onChange={(e) => setSelectedDriveId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-shadow"
                >
                  <option value="">Select a drive…</option>
                  {(drives ?? []).map((drive, i) => (
                    <option key={drive.id} value={drive.id}>
                      {drive.email} ({i + 1})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">{entityLabel} name</label>
              <Input
                type="text"
                autoFocus
                placeholder={`Enter ${entityLabel.toLowerCase()} name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" loading={loading} disabled={loading || (showDrivePicker && !selectedDriveId)}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
