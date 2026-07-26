import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FolderLock } from 'lucide-react';
import { useState } from 'react';

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
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<FolderLock size={20} className="text-primary" />}>
          <DialogTitle className="text-sm font-semibold text-slate-800">Set Retention Policy</DialogTitle>
          <DialogDescription className="text-sm text-slate-500 mt-1">
            Control how long files are kept in this folder.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Action</span>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as 'prevent_deletion' | 'auto_delete')}
                className="mt-1 w-full px-3 py-1.5 bg-card border border-slate-400 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow"
              >
                <option value="auto_delete">Auto-Delete (Retention limit)</option>
                <option value="prevent_deletion">Prevent Deletion (Legal Hold)</option>
              </select>
            </label>
            {action === 'auto_delete' && (
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Days</span>
                <Input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
                  className="mt-1"
                />
              </label>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} loading={loading}>Save Policy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
