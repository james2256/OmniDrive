import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { TriangleAlert, LoaderCircle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onClose,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const confirmColor =
    variant === 'danger' ? 'bg-red-600 hover:bg-red-700' :
    variant === 'warning' ? 'bg-amber-600 hover:bg-amber-700' :
    'bg-blue-600 hover:bg-blue-700';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-sm p-4 rounded-xl">
        <div className="flex items-start gap-3">
          <TriangleAlert size={18} className={`flex-shrink-0 mt-0.5 ${variant === 'danger' ? 'text-red-500' : variant === 'warning' ? 'text-amber-500' : 'text-blue-500'}`} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold text-slate-800">{title}</DialogTitle>
            <DialogDescription className="text-sm text-slate-600 mt-1 leading-relaxed">
              {message}
            </DialogDescription>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-card border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors ${confirmColor}`}
          >
            {loading && <LoaderCircle size={14} className="animate-spin" />}
            {confirmText}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
