import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';

/** Shared error placeholder — mirrors EmptyState's structure. No page had one before. */
export function ErrorState({
  icon: Icon = AlertCircle,
  title = 'Something went wrong',
  description = "We couldn't load this content. Please try again.",
  onRetry,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center" role="alert">
      <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-4">
        <Icon size={28} className="text-red-500" aria-hidden />
      </div>
      <h3 className="text-lg font-medium text-slate-800">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 max-w-sm">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:opacity-90"
        >
          Retry
        </button>
      )}
    </div>
  );
}
