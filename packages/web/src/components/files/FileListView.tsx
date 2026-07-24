import { Folder, Star, Share2, ArrowUp, ArrowDown } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useSelectionStore, type SelectedItem } from '../../stores/useSelectionStore';
import { formatFileSize, formatRelativeTime } from '../../lib/utils';
import { type SortField } from '../../lib/sort-items';
import { FileIcon } from './FileIcon';
import { ItemContextMenu } from './ItemContextMenu';
import { MetadataBadges } from './MetadataBadges';
import { useItemInteractions } from './useItemInteractions';
import { isGoogleNative, getFolderIdentifier } from './utils';
import type { FileViewSharedProps } from './types';

interface FileListViewProps extends FileViewSharedProps {
  showDriveColumn: boolean;
}

export function FileListView(props: FileListViewProps) {
  const {
    sortedSubfolders,
    sortedFiles,
    getDriveInfo,
    isTargetShared,
    errorDrives,
    isTrashView,
    actions,
    renderDriveBadge,
    showDriveColumn,
  } = props;

  const sortField = useUIStore((s) => s.sortField);
  const sortDirection = useUIStore((s) => s.sortDirection);
  const toggleSort = useUIStore((s) => s.toggleSort);

  const selectedItems = useSelectionStore((s) => s.selectedItems);
  const selectAll = useSelectionStore((s) => s.selectAll);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const hasSelection = selectedItems.length > 0;
  const selectedKeys = new Set(
    selectedItems.map((i) => {
      if (i.type === 'file') return i.item.id;
      return getFolderIdentifier(i.item as { googleFolderId?: string; id?: string });
    }),
  );

  const interactions = useItemInteractions({ sortedSubfolders, sortedFiles, actions, isTrashView });

  const renderSortHeader = (label: string, field: SortField, align: 'left' | 'right' = 'left') => {
    const active = sortField === field;
    const Icon = sortDirection === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className={`inline-flex items-center gap-1 hover:text-slate-700 transition-colors ${
          align === 'right' ? 'ml-auto' : ''
        } ${active ? 'text-slate-800' : ''}`}
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {active && <Icon size={12} className="flex-shrink-0" />}
      </button>
    );
  };

  // Single grid layout — all columns visible on all screens.
  // Mobile: minimal checkbox column, more room for name. Desktop: full widths.
  const listGridClass = showDriveColumn
    ? 'grid-cols-[34px_1fr_80px_70px_80px_10px] sm:grid-cols-[auto_1fr_140px_120px_140px_44px]'
    : 'grid-cols-[34px_1fr_70px_80px_10px] sm:grid-cols-[auto_1fr_120px_140px_44px]';

  const allItems: SelectedItem[] = [
    ...sortedSubfolders.map((f) => ({ type: 'folder' as const, item: f })),
    ...sortedFiles.map((f) => ({ type: 'file' as const, item: f })),
  ];

  return (
    <div className="w-full overflow-x-auto">
      {/* Table header */}
      <div className={`grid ${listGridClass} gap-0 bg-surface border-b-2 border-slate-200 px-2 sm:px-4 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide sticky top-0 z-10 group min-w-[500px]`}>
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            className={`w-4 h-4 cursor-pointer ${hasSelection ? 'opacity-100' : 'opacity-30 group-hover:opacity-100 transition-opacity'}`}
            checked={selectedItems.length > 0 && selectedItems.length === sortedSubfolders.length + sortedFiles.length}
            onChange={(e) => {
              if (e.target.checked) {
                selectAll(allItems);
              } else {
                clearSelection();
              }
            }}
            title="Select All"
          />
        </div>
        <span>{renderSortHeader('Name', 'name')}</span>
        {showDriveColumn && <span>Drive</span>}
        <span className="text-right">{renderSortHeader('Size', 'size', 'right')}</span>
        <span className="text-right">{renderSortHeader('Modified', 'modified', 'right')}</span>
        <span />
      </div>

      {/* Folders */}
      {sortedSubfolders.map((folder) => {
        const folderId = getFolderIdentifier(folder);
        const driveAccountId = 'driveAccountId' in folder ? folder.driveAccountId : undefined;
        const { drive } = getDriveInfo(driveAccountId);
        const hasError = drive ? errorDrives?.has(drive.id) : false;
        const shared = folderId ? isTargetShared?.(folderId, 'folder') ?? false : false;
        const isStarred = 'isStarred' in folder ? folder.isStarred : false;
        const isSelected = folderId ? selectedKeys.has(folderId) : false;

        return (
          <ItemContextMenu key={folderId} type="folder" item={folder} actions={actions} isTrashView={isTrashView} isStarred={isStarred}>
            <div
              onClick={(e) => interactions.handleClick(e, { type: 'folder', item: folder })}
              onDoubleClick={() => interactions.handleFolderDoubleClick(folder)}
              onMouseEnter={() => interactions.handleFolderHover(folder)}
              onMouseLeave={interactions.handleHoverEnd}
              className={`grid ${listGridClass} gap-0 items-center px-2 sm:px-4 py-2.5 cursor-pointer transition-colors border-b border-slate-200 group min-w-[500px] ${
                isSelected
                  ? 'bg-blue-100 hover:bg-blue-200'
                  : hasError
                  ? 'bg-red-50 hover:bg-red-100'
                  : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  className={`w-4 h-4 cursor-pointer flex-shrink-0 ${hasSelection ? 'opacity-100' : 'opacity-30 group-hover:opacity-100 transition-opacity'}`}
                  checked={isSelected}
                  readOnly
                  onClick={(e) => {
                    e.stopPropagation();
                    interactions.handleClick(e, { type: 'folder', item: folder });
                  }}
                />
              </div>
              <div className="flex items-center gap-2 min-w-0 pl-1">
                <Folder size={18} className="text-blue-500 flex-shrink-0" fill="currentColor" />
                <span className="text-sm text-slate-800 font-medium truncate">{folder.name}</span>
                {isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                <MetadataBadges metadata={'metadata' in folder ? folder.metadata : undefined} />
              </div>
              {showDriveColumn && (
                <div className="flex items-center min-w-0">
                  {renderDriveBadge(driveAccountId)}
                </div>
              )}
              <div className="text-right text-xs text-slate-500">—</div>
              <div className="text-right text-xs text-slate-500">—</div>
              <div />
            </div>
          </ItemContextMenu>
        );
      })}

      {/* Files */}
      {sortedFiles.map((file) => {
        const native = isGoogleNative(file.mimeType);
        const shared = file.id ? isTargetShared?.(file.id, 'file') : false;
        const isSelected = selectedKeys.has(file.id);

        return (
          <ItemContextMenu key={file.id} type="file" item={file} actions={actions} isTrashView={isTrashView} isStarred={file.isStarred}>
            <div
              onClick={(e) => interactions.handleClick(e, { type: 'file', item: file })}
              onDoubleClick={() => interactions.handleFileDoubleClick(file)}
              onMouseEnter={() => interactions.handleFileHover(file)}
              onMouseLeave={interactions.handleHoverEnd}
              className={`grid ${listGridClass} gap-0 items-center px-2 sm:px-4 py-2.5 cursor-pointer transition-colors border-b border-slate-200 group min-w-[500px] ${
                isSelected ? 'bg-blue-100 hover:bg-blue-200' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  className={`w-4 h-4 cursor-pointer flex-shrink-0 ${hasSelection ? 'opacity-100' : 'opacity-30 group-hover:opacity-100 transition-opacity'}`}
                  checked={isSelected}
                  readOnly
                  onClick={(e) => {
                    e.stopPropagation();
                    interactions.handleClick(e, { type: 'file', item: file });
                  }}
                />
              </div>
              <div className="flex items-center gap-2 min-w-0 pl-1">
                <span className="text-lg sm:text-xl flex-shrink-0"><FileIcon mimeType={file.mimeType} /></span>
                <span className="text-sm text-slate-800 truncate" title={file.name}>{file.name}</span>
                {file.isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                <MetadataBadges metadata={file.metadata} />
              </div>
              {showDriveColumn && (
                <div className="flex items-center min-w-0">
                  {renderDriveBadge(file.driveAccountId)}
                </div>
              )}
              <div className="text-right text-xs text-slate-500">
                {!native ? formatFileSize(file.size) : '—'}
              </div>
              <div className="text-right text-xs text-slate-500">
                {formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}
              </div>
              <div />
            </div>
          </ItemContextMenu>
        );
      })}
    </div>
  );
}
