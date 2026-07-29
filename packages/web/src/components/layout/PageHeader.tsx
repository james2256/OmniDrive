import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PageHeaderProps {
  /** Required — the page title. Matches the sidebar nav label exactly. */
  title: string;
  /** Optional — one-line context shown below the title in muted gray. */
  description?: string;
  /** Optional — Lucide icon rendered to the left of the title (mirrors sidebar). */
  icon?: LucideIcon;
  /** Optional — right-aligned action(s). Stacks above title on mobile. */
  actions?: ReactNode;
  /** Optional — breadcrumb rendered ABOVE the title (for nested pages). */
  breadcrumb?: ReactNode;
  /** Optional — whether to render a bottom border (default: true). */
  bordered?: boolean;
}

/**
 * Shared page header — visible title that matches the sidebar nav label,
 * optional context/description, optional right-aligned actions, optional
 * breadcrumb above the title. Renders a bottom border by default.
 *
 * Responsive behavior:
 *  - Mobile (< 640px): title + description stack ABOVE actions (flex-col).
 *  - Desktop (>= 640px): title group on the left, actions on the right
 *    (flex-row + justify-between).
 *
 * Typography matches the existing 6-page convention (verified):
 *   text-xl sm:text-2xl font-semibold text-slate-800
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  breadcrumb,
  bordered = true,
}: PageHeaderProps) {
  return (
    <header
      className={[
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        bordered ? 'border-b border-slate-200 pb-4 mb-2' : '',
      ].join(' ')}
    >
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        {breadcrumb && (
          <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0 order-first sm:order-none">
            {breadcrumb}
          </div>
        )}
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon size={20} className="text-slate-400 flex-shrink-0" aria-hidden />}
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-800 truncate">{title}</h1>
        </div>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 order-2 sm:order-2">{actions}</div>
      )}
    </header>
  );
}
