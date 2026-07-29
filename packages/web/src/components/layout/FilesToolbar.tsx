import React from 'react';
import { List, LayoutGrid, Info, X } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * Shared toolbar for the Files and External pages: search/filter input,
 * list/grid view toggle, and the info-panel toggle. Renders the
 * {@link BulkActionBar} slot above the toolbar row (passed as `bulkActionBar`)
 * and an optional `actions` slot (e.g. New Folder / Upload buttons) inline
 * with the controls. The breadcrumb is rendered in `breadcrumb` on the
 * opposite side of the row.
 *
 * Page-specific concerns (the desktop/mobile New Folder + Upload buttons on
 * FilesPage) are passed via `actions` so this component stays generic.
 */
export interface FilesToolbarProps {
  /** Current filter/search value. */
  searchQuery: string;
  /** Update the filter/search value. */
  setSearchQuery: (value: string) => void;
  /** Active view mode — 'list' or 'grid'. */
  viewMode: 'list' | 'grid';
  /** Switch the active view mode. */
  setViewMode: (mode: 'list' | 'grid') => void;
  /** Whether the info panel is currently open. */
  isInfoPanelOpen: boolean;
  /** Toggle the info panel open/closed. */
  toggleInfoPanel: () => void;
  /** Optional slot rendered above the toolbar — typically `<BulkActionBar />`. */
  bulkActionBar?: React.ReactNode;
  /**
   * Optional slot rendered inline with the controls on desktop (hidden on
   * mobile). FilesPage uses it for New Folder + Upload buttons; ExternalPage
   * omits it.
   */
  actions?: React.ReactNode;
  /**
   * Optional slot rendered below the controls on mobile (hidden on desktop).
   * FilesPage uses it for a full-width New Folder + Upload row.
   */
  mobileActions?: React.ReactNode;
  /** Breadcrumb element rendered on the opposite side of the row. */
  breadcrumb?: React.ReactNode;
}

export function FilesToolbar({
  searchQuery,
  setSearchQuery,
  viewMode,
  setViewMode,
  isInfoPanelOpen,
  toggleInfoPanel,
  bulkActionBar,
  actions,
  mobileActions,
  breadcrumb,
}: FilesToolbarProps) {
  return (
    <>
      {bulkActionBar}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {/* Mobile Row 1: filter + view toggle + info | Desktop: right side */}
        <div className="flex gap-2 items-center order-1 sm:order-2 sm:ml-auto w-full sm:w-auto">
          <div className="relative flex-1 sm:w-48 sm:flex-initial flex-shrink-0 sm:flex-shrink">
            <input
              type="text"
              placeholder="Filter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-3 pr-8 py-2 text-sm border border-slate-400 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 hover:bg-transparent p-1"
                onClick={() => setSearchQuery('')}
                aria-label="Clear filter"
              >
                <X size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center border border-slate-400 rounded-md overflow-hidden bg-card flex-shrink-0">
            <Button
              variant="ghost"
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
              title="List layout"
              aria-label="List layout"
            >
              <List size={18} />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
              title="Grid layout"
              aria-label="Grid layout"
            >
              <LayoutGrid size={18} />
            </Button>
          </div>

          <Button
            variant="ghost"
            onClick={toggleInfoPanel}
            className={`p-2 rounded-full flex-shrink-0 ${isInfoPanelOpen ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100'}`}
            title="View details"
            aria-label="View details"
          >
            <Info size={20} />
          </Button>

          {/* Desktop: action buttons (New Folder / Upload) inline with filter row */}
          {actions && <div className="hidden sm:flex gap-2">{actions}</div>}
        </div>

        {/* Mobile Row 2: action buttons */}
        {mobileActions && <div className="flex gap-2 sm:hidden order-2">{mobileActions}</div>}

        {/* Breadcrumb — below on mobile, left side on desktop */}
        {breadcrumb && (
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden order-3 sm:order-1">
            {breadcrumb}
          </div>
        )}
      </div>
    </>
  );
}
