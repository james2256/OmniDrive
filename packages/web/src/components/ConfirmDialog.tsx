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
      <DialogContent className="max-w-sm p-0 gap-0 rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b border-slate-200 shrink-0">
          <TriangleAlert size={20} className={variant === 'danger' ? 'text-red-500' : variant === 'warning' ? 'text-amber-500' : 'text-blue-500'} />
          <DialogTitle className="text-lg font-semibold text-slate-800">{title}</DialogTitle>
        </div>
        <div className="p-4">
          <DialogDescription className="text-sm text-slate-600 leading-relaxed">
            {message}
          </DialogDescription>
          <div className="flex justify-end gap-3 mt-4">
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
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors ${confirmColor}`}
            >
              {loading && <LoaderCircle size={14} className="animate-spin" />}
              {confirmText}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
