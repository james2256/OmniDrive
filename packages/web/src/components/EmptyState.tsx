import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Shared empty placeholder — Lucide icon + title + optional description/action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center" role="status">
      <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
        <Icon size={28} className="text-primary" aria-hidden />
      </div>
      <h3 className="text-lg font-medium text-stone-800">{title}</h3>
      {description && <p className="mt-1 text-sm text-stone-500 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Content skeleton rows — prefer over spinners for list/grid pages. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-stone-200/60 animate-pulse rounded-md" />
      ))}
    </div>
  );
}
