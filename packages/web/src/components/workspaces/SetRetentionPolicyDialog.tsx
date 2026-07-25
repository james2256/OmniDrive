import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { useState } from 'react';
import { Spinner } from '../ui/Spinner';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (action: 'prevent_deletion' | 'auto_delete', days: number) => Promise<void>;
}

/**
 * Radix Dialog replacement for the hand-rolled retention modal.
 * Fixes Bug 9 (no focus trap / Escape / scroll lock) and Bug 10
 * (document.getElementById → controlled inputs via useState).
 */
export function SetRetentionPolicyDialog({ open, onClose, onSubmit }: Props) {
  const [action, setAction] = useState<'prevent_deletion' | 'auto_delete'>('auto_delete');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(action, days);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md p-5 rounded-xl">
        <DialogTitle className="text-base font-semibold text-slate-800">Set Retention Policy</DialogTitle>
        <DialogDescription className="text-sm text-slate-600 mt-1">
          Control how long files are kept in this folder.
        </DialogDescription>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Action</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as 'prevent_deletion' | 'auto_delete')}
              className="mt-1 w-full border border-slate-400 rounded-lg px-3 py-1.5 bg-card focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="auto_delete">Auto-Delete (Retention limit)</option>
              <option value="prevent_deletion">Prevent Deletion (Legal Hold)</option>
            </select>
          </label>
          {action === 'auto_delete' && (
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Days</span>
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
                className="mt-1 w-full border border-slate-400 rounded-lg px-3 py-1.5 bg-card focus:ring-2 focus:ring-primary text-sm"
              />
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm bg-card border border-slate-400 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <Spinner size={14} />} Save Policy
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
