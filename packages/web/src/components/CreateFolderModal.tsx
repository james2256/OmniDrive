import { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useToastStore } from '../stores/toastStore';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

interface CreateFolderModalProps {
  open: boolean;
  /** null = root-level (workspace or top-level folder), string = child of that parent */
  parentId: string | null;
  /** Dialog title, e.g. "New Folder" or "New Workspace" */
  title: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateFolderModal({ open, parentId, title, onClose, onSuccess }: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const addToast = useToastStore((s) => s.addToast);

  // Reset state each time the modal opens so stale input/errors don't persist
  useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);

  // Derive "Folder" or "Workspace" from the title for labels & toast messages
  const entityLabel = title.replace(/^New\s+/, '');

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
      await api.createFolder(trimmed, parentId ?? undefined);
      addToast('success', `${entityLabel} created successfully`);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || `Failed to create ${entityLabel.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center p-5 border-b border-stone-100 shrink-0">
          <DialogTitle className="text-lg font-semibold text-stone-800 flex items-center gap-2">
            <FolderPlus size={20} className="text-blue-500" />
            {title}
          </DialogTitle>
        </div>

        <div className="p-6">
          {error && (
            <div className="text-red-500 mb-4 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-stone-700">
                {entityLabel} name
              </label>
              <input
                type="text"
                autoFocus
                placeholder={`Enter ${entityLabel.toLowerCase()} name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-3 py-2 bg-card border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>

            <div className="flex justify-end gap-3 mt-2 pt-4 border-t border-stone-100">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center justify-center min-w-[100px] px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
