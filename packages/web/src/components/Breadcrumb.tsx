import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from '../types';

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="Folder navigation">
      {items.map((item, i) => (
        <span key={item.id ?? 'root'} className="breadcrumb-item">
          {i > 0 && <ChevronRight size={14} className="breadcrumb-separator" />}
          {i < items.length - 1 ? (
            <Link to={item.id ? `/files/${item.id}` : '/files'} className="breadcrumb-link">
              {item.name}
            </Link>
          ) : (
            <span className="breadcrumb-current">{item.name}</span>
          )}
        </span>
      ))}

      <style>{`
        .breadcrumb {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 2px;
          font-size: var(--font-size-sm);
        }
        .breadcrumb-item { display: flex; align-items: center; gap: 2px; }
        .breadcrumb-separator { color: var(--text-tertiary); }
        .breadcrumb-link { color: var(--text-secondary); }
        .breadcrumb-link:hover { color: var(--text-primary); }
        .breadcrumb-current { color: var(--text-primary); font-weight: 500; }
      `}</style>
    </nav>
  );
}
