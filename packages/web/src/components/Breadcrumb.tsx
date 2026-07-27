import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from '../types';

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  driveId?: string;
}

export function Breadcrumb({ items, driveId }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Folder navigation"
      className="flex items-center gap-0.5 text-sm overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ol className="flex items-center gap-0.5 min-w-0">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const linkTo = item.id === 'root' ? '/files' : `/files/${item.id}`;
          const href = driveId && item.id !== 'root' ? `${linkTo}?driveId=${driveId}` : linkTo;

          return (
            <li key={item.id ?? `fallback-${i}`} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && (
                <ChevronRight size={14} className="text-slate-500 shrink-0" aria-hidden="true" />
              )}
              {isLast ? (
                <span className="text-sm font-medium text-slate-900 px-1 py-0.5" aria-current="page">
                  {item.name}
                </span>
              ) : (
                <Link
                  to={href}
                  className="text-sm text-slate-500 hover:text-slate-900 hover:underline underline-offset-2 px-1 py-0.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {item.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
