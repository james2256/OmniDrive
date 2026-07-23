import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Pen, LoaderCircle } from 'lucide-react';

interface RenameDialogProps {
  open: boolean;
  initialName: string;
  title: string;
  onConfirm: (newName: string) => void;
  onClose: () => void;
  loading?: boolean;
}

export function RenameDialog({ open, initialName, title, onConfirm, onClose, loading = false }: RenameDialogProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [open, initialName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && name !== initialName) {
      onConfirm(name.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-sm p-4 rounded-xl">
        <DialogTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
          <Pen size={16} className="text-blue-500" />
          {title}
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
            placeholder="Enter new name"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-card border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || name === initialName}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading && <LoaderCircle size={14} className="animate-spin" />}
              Rename
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
