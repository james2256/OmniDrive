import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore } from '../stores/toastStore';
import type { ToastType } from '../types';

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-green-500" aria-hidden />,
  error: <AlertCircle size={18} className="text-red-500" aria-hidden />,
  warning: <AlertTriangle size={18} className="text-amber-500" aria-hidden />,
  info: <Info size={18} className="text-primary" aria-hidden />,
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 bg-card border border-stone-100 rounded-xl shadow-lg pointer-events-auto min-w-[300px] ${
            toast.removing
              ? 'animate-out fade-out-0 slide-out-to-bottom-5 duration-300'
              : 'animate-in slide-in-from-bottom-5 fade-in duration-300'
          }`}
        >
          {icons[toast.type]}
          <span className="flex-1 text-sm font-medium text-stone-700">{toast.message}</span>
          <button
            type="button"
            className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
            onClick={() => removeToast(toast.id)}
            aria-label="Close notification"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
