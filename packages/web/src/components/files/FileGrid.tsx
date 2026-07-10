import React from 'react';
import type { FileEntry, DriveFolder, WorkspaceFolder } from '../../types';
import { formatFileSize, formatRelativeTime } from '../../lib/utils';
import { DriveBadge } from '../DriveBadge';
import { FileIcon } from './FileIcon';
import { Folder, Download, Trash2, Pencil, ExternalLink, Share2, RefreshCw, Eye, Star, Info, ArrowUp, ArrowDown } from 'lucide-react';
import { sortFiles, sortFolders, type SortField } from '../../lib/sort-items';
import { api } from '../../lib/api';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '../ui/context-menu';
import { useUIStore } from '../../stores/useUIStore';
import { useSelectionStore, type SelectedItem, isSameItem } from '../../stores/useSelectionStore';

function isGoogleNative(mimeType: string | null): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}

const ItemContextMenuContent: React.FC<{
  type: 'file' | 'folder';
  id?: string;
  name?: string;
  native?: boolean;
  item?: FileEntry | DriveFolder | WorkspaceFolder;
  isTrashView?: boolean;

  isStarred?: boolean;
  onToggleStar?: (id: string, type: 'file' | 'folder', currentStarStatus: boolean) => void;
  onPreviewFile?: (file: FileEntry) => void;
  onShare?: (id: string, type: 'file' | 'folder') => void;
  onRenameFile?: (id: string, name: string) => void;
  onMoveDrive?: (file: FileEntry) => void;
  onDeleteFile?: (id: string) => void;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
  onAddToWorkspace?: (item: FileEntry) => void;
  onViewInfo?: (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => void;
  onSetRetentionPolicy?: (id: string, type: 'file' | 'folder') => void;
}> = ({
  type,
  id,
  name,
  native,
  item,
  isTrashView,

  isStarred,
  onToggleStar,
  onPreviewFile,
  onShare,
  onRenameFile,
  onMoveDrive,
  onDeleteFile,
  onRestore,
  onPermanentDelete,
  onAddToWorkspace,
  onViewInfo,
  onSetRetentionPolicy,
}) => {
  const file = type === 'file' ? (item as FileEntry) : undefined;

  return (
    <ContextMenuContent className="w-48 bg-card border border-stone-200 shadow-xl rounded-xl overflow-hidden py-1">
      {onViewInfo && item && (
        <ContextMenuItem className="px-3 py-2 text-sm text-stone-700 cursor-pointer hover:bg-stone-100 outline-none flex items-center" onClick={() => onViewInfo(item, type)}>
          <Info size={16} className="mr-3 text-stone-500" />
          View Info
        </ContextMenuItem>
      )}
    {isTrashView ? (
      <>
        {onRestore && id && (
          <ContextMenuItem className="px-3 py-2 text-sm text-stone-700 cursor-pointer hover:bg-stone-100 outline-none flex items-center" onClick={() => onRestore(id)}>
            <RefreshCw size={16} className="mr-3 text-stone-500" />
            Restore
          </ContextMenuItem>
        )}
        {onPermanentDelete && id && (
          <ContextMenuItem className="px-3 py-2 text-sm text-red-600 cursor-pointer hover:bg-red-50 outline-none flex items-center" onClick={() => onPermanentDelete(id)}>
            <Trash2 size={16} className="mr-3 text-red-500" />
            Delete Forever
          </ContextMenuItem>
        )}
      </>
    ) : (
      <>
        {type === 'file' && file && onPreviewFile && (
          <ContextMenuItem className="px-3 py-2 text-sm text-stone-700 cursor-pointer hover:bg-stone-100 outline-none flex items-center" onClick={() => onPreviewFile(file)}>
            <Eye size={16} className="mr-3 text-stone-500" />
            Preview
          </ContextMenuItem>
        )}
        {type === 'file' && file && native && file.webViewLink && (
          <ContextMenuItem onClick={() => window.open(file.webViewLink!, '_blank', 'noopener,noreferrer')}>
            <ExternalLink className="mr-2 h-4 w-4" /> Open in Google
          </ContextMenuItem>
        )}
        {type === 'file' && file && !native && file.webContentLink && (
          <ContextMenuItem onClick={() => window.location.href = `${import.meta.env.VITE_API_URL || ''}/api/files/${file.id}/download`}>
            <Download className="mr-2 h-4 w-4" /> Download
          </ContextMenuItem>
        )}
        {onToggleStar && id && (
          <ContextMenuItem onClick={() => onToggleStar(id, type, !!isStarred)}>
            <Star className="mr-2 h-4 w-4" /> {isStarred ? 'Remove from Starred' : 'Add to Starred'}
          </ContextMenuItem>
        )}
        {onShare && id && (
          <ContextMenuItem onClick={() => onShare(id, type)}>
            <Share2 className="mr-2 h-4 w-4" /> Share
          </ContextMenuItem>
        )}
        {type === 'file' && file && onAddToWorkspace && (
          <ContextMenuItem onClick={() => onAddToWorkspace(file)}>
            <Folder className="mr-2 h-4 w-4" /> Add to Workspace
          </ContextMenuItem>
        )}
        {onSetRetentionPolicy && id && (
          <ContextMenuItem onClick={() => onSetRetentionPolicy(id, type)}>
            <Folder className="mr-2 h-4 w-4" /> Set Retention Policy
          </ContextMenuItem>
        )}
        {type === 'file' && onRenameFile && id && name && (
          <ContextMenuItem onClick={() => {
            const newName = prompt('Rename file:', name);
            if (newName && newName !== name) onRenameFile(id, newName);
          }}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </ContextMenuItem>
        )}
        {type === 'file' && onMoveDrive && file && (
          <ContextMenuItem onClick={() => onMoveDrive(file)}>
            <ExternalLink className="mr-2 h-4 w-4" /> Move to another drive
          </ContextMenuItem>
        )}
        {type === 'file' && onDeleteFile && id && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-red-600" onClick={() => onDeleteFile(id)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </ContextMenuItem>
          </>
        )}
      </>
    )}
    </ContextMenuContent>
  );
};

export interface FileGridProps {
  files: FileEntry[];
  subfolders: (DriveFolder | WorkspaceFolder)[];
  getDriveInfo: (driveAccountId?: string) => { drive: any, index: number };
  onNavigateFolder?: (folderId: string, driveId: string) => void;
  onToggleStar?: (id: string, type: 'file' | 'folder', currentStarStatus: boolean) => void;
  onPreviewFile?: (file: FileEntry) => void;
  onShare?: (id: string, type: 'file' | 'folder') => void;
  onRenameFile?: (id: string, name: string) => void;
  onDeleteFile?: (id: string) => void;
  isTargetShared?: (id: string, type: 'file' | 'folder') => boolean;
  errorDrives?: Set<string>;
  onMoveDrive?: (file: FileEntry) => void;
  /** Override viewMode (optional). If not provided, reads from UIStore. */
  viewMode?: 'grid' | 'list';
  /** Show dedicated Drive column in list view (auto when multiple drives in listing). */
  showDriveColumn?: boolean;
  isTrashView?: boolean;
  onRestore?: (fileId: string) => void;
  onPermanentDelete?: (fileId: string) => void;
  onAddToWorkspace?: (item: FileEntry) => void;
  onViewInfo?: (item: FileEntry | DriveFolder | WorkspaceFolder, type: 'file' | 'folder') => void;
  onSetRetentionPolicy?: (id: string, type: 'file' | 'folder') => void;
}

const renderMetadataBadges = (metadata?: string | Record<string, string>) => {
  if (!metadata) return null;
  try {
    const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const entries = Object.entries(parsed);
    if (entries.length === 0) return null;
    return (
      <div className="flex gap-1 ml-2 items-center">
        {entries.slice(0, 2).map(([k, v]) => (
          <span key={k} className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]" title={`${k}: ${v}`}>
            {v as string}
          </span>
        ))}
        {entries.length > 2 && <span className="text-stone-400 text-[10px]">+{entries.length - 2}</span>}
      </div>
    );
  } catch {
    return null;
  }
};

export const FileGrid: React.FC<FileGridProps> = ({
  files,
  subfolders,
  getDriveInfo,
  onNavigateFolder,
  onToggleStar,
  onPreviewFile,
  onShare,
  onRenameFile,
  onDeleteFile,
  isTargetShared,
  errorDrives,
  onMoveDrive,
  viewMode: viewModeProp,
  showDriveColumn: showDriveColumnProp,
  isTrashView,
  onRestore,
  onPermanentDelete,
  onAddToWorkspace,
  onViewInfo,
  onSetRetentionPolicy,
}) => {
  const storeViewMode = useUIStore((s) => s.viewMode);
  const sortField = useUIStore((s) => s.sortField);
  const sortDirection = useUIStore((s) => s.sortDirection);
  const toggleSort = useUIStore((s) => s.toggleSort);
  const viewMode = viewModeProp ?? storeViewMode;
  const sortedSubfolders = React.useMemo(
    () => sortFolders(subfolders, sortField, sortDirection),
    [subfolders, sortField, sortDirection]
  );
  const sortedFiles = React.useMemo(
    () => sortFiles(files, sortField, sortDirection),
    [files, sortField, sortDirection]
  );

  const uniqueDriveCount = React.useMemo(() => {
    const ids = new Set<string>();
    for (const file of files) {
      if (file.driveAccountId) ids.add(file.driveAccountId);
    }
    for (const folder of subfolders) {
      if ('driveAccountId' in folder && folder.driveAccountId) ids.add(folder.driveAccountId);
    }
    return ids.size;
  }, [files, subfolders]);

  const showDriveColumn = showDriveColumnProp ?? uniqueDriveCount > 1;

  const renderDriveBadge = (driveAccountId?: string) => {
    if (!driveAccountId) return null;
    const { drive, index } = getDriveInfo(driveAccountId);
    if (!drive?.email) return null;
    return <DriveBadge email={drive.email} colorIndex={index} />;
  };

  const renderSortHeader = (label: string, field: SortField, align: 'left' | 'right' = 'left') => {
    const active = sortField === field;
    const Icon = sortDirection === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className={`inline-flex items-center gap-1 hover:text-stone-700 transition-colors ${
          align === 'right' ? 'ml-auto' : ''
        } ${active ? 'text-stone-800' : ''}`}
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {active && <Icon size={12} className="flex-shrink-0" />}
      </button>
    );
  };
  const [lastSelected, setLastSelected] = React.useState<SelectedItem | null>(null);
  const { selectedItems, toggleSelection, selectMultiple, selectAll, clearSelection } = useSelectionStore();
  const hasSelection = selectedItems.length > 0;
  const selectedKeys = new Set(selectedItems.map(i => i.item.id || ('googleFolderId' in i.item ? i.item.googleFolderId : undefined)));
  const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleItemClick = (e: React.MouseEvent, item: SelectedItem) => {
    e.stopPropagation();
    if (e.shiftKey && lastSelected) {
      // Prevent text selection
      document.getSelection()?.removeAllRanges();
      
      const allItems: SelectedItem[] = [
        ...sortedSubfolders.map(f => ({ type: 'folder' as const, item: f })),
        ...sortedFiles.map(f => ({ type: 'file' as const, item: f }))
      ];
      const startIndex = allItems.findIndex(i => isSameItem(i, lastSelected));
      const endIndex = allItems.findIndex(i => isSameItem(i, item));
      
      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        selectMultiple(allItems.slice(start, end + 1));
      }
    } else {
      toggleSelection(item);
      setLastSelected(item);
    }
  };

  if (files.length === 0 && subfolders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-400">
        <p className="text-6xl mb-4">📂</p>
        <p className="text-lg font-medium text-stone-500">This folder is empty</p>
        <p className="text-sm mt-1">Drag &amp; drop files here or click Upload</p>
      </div>
    );
  }

  /* ─────────────────── LIST VIEW ─────────────────── */
  if (viewMode === 'list') {
    const listGridClass = showDriveColumn
      ? 'grid-cols-[auto_1fr_44px] sm:grid-cols-[auto_1fr_140px_120px_140px_44px]'
      : 'grid-cols-[auto_1fr_44px] sm:grid-cols-[auto_1fr_120px_140px_44px]';

    return (
      <div className="w-full">
        {/* Table header */}
        <div className={`grid ${listGridClass} gap-0 border-b border-stone-100 px-4 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide group`}>
          <div className="w-[72px] flex items-center pl-3">
            <input
              type="checkbox"
              className={`w-4 h-4 cursor-pointer ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
              checked={selectedItems.length > 0 && selectedItems.length === files.length + subfolders.length}
              onChange={(e) => {
                if (e.target.checked) {
                  const allItems: SelectedItem[] = [
                    ...sortedSubfolders.map(f => ({ type: 'folder' as const, item: f })),
                    ...sortedFiles.map(f => ({ type: 'file' as const, item: f }))
                  ];
                  selectAll(allItems);
                } else {
                  clearSelection();
                }
              }}
              title="Select All"
            />
          </div>
          <span>{renderSortHeader('Name', 'name')}</span>
          {showDriveColumn && <span className="hidden sm:block">Drive</span>}
          <span className="text-right hidden sm:block">{renderSortHeader('Size', 'size', 'right')}</span>
          <span className="text-right hidden sm:block">{renderSortHeader('Modified', 'modified', 'right')}</span>
          <span />
        </div>

        {/* Folders */}
        {sortedSubfolders.map((folder) => {
          const isVirtual = !('googleFolderId' in folder);
          const key = 'googleFolderId' in folder ? folder.googleFolderId : folder.id;
          const driveAccountId = 'driveAccountId' in folder ? folder.driveAccountId : undefined;
          const { drive } = getDriveInfo(driveAccountId);
          const hasError = drive ? errorDrives?.has(drive.id) : false;
          const shared = folder.id ? isTargetShared?.(folder.id, 'folder') : false;
          const isStarred = 'isStarred' in folder ? folder.isStarred : false;
          const isSelected = selectedKeys.has(folder.id || ('googleFolderId' in folder ? folder.googleFolderId : undefined));

          return (
            <ContextMenu key={key}>
              <ContextMenuTrigger>
                <div
                  onClick={(e) => handleItemClick(e, { type: 'folder', item: folder })}
                  onDoubleClick={() => {
                    if (isTrashView) return;
                    if (isVirtual) {
                      onNavigateFolder?.(folder.id, 'virtual');
                    } else if (driveAccountId && 'googleFolderId' in folder) {
                      onNavigateFolder?.(folder.googleFolderId, driveAccountId);
                    }
                  }}
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = setTimeout(() => {
                      if (isVirtual) {
                        api.getFolderContents(folder.id).catch(() => {});
                      } else if (driveAccountId && 'googleFolderId' in folder) {
                        api.getDriveFolderContents(driveAccountId, folder.googleFolderId).catch(() => {});
                      }
                    }, 300);
                  }}
                  onMouseLeave={() => {
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  }}
                  className={`grid ${listGridClass} gap-0 items-center px-4 py-2.5 cursor-pointer transition-colors border-b border-stone-50 group ${
                    isSelected
                      ? 'bg-blue-100 hover:bg-blue-200'
                      : hasError
                      ? 'bg-red-50 hover:bg-red-100'
                      : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="w-[72px] flex items-center gap-2 pl-3">
                    <input 
                      type="checkbox" 
                      className={`w-4 h-4 cursor-pointer flex-shrink-0 ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                      checked={isSelected}
                      readOnly
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(e, { type: 'folder', item: folder });
                      }}
                    />
                    <Folder size={20} className="text-blue-500 flex-shrink-0" fill="currentColor" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm text-stone-800 font-medium truncate">{folder.name}</span>
                    {isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                    {renderMetadataBadges('metadata' in folder ? folder.metadata : undefined)}
                    {!showDriveColumn && renderDriveBadge(driveAccountId)}
                  </div>
                  {showDriveColumn && (
                    <div className="hidden sm:flex items-center min-w-0">
                      {renderDriveBadge(driveAccountId)}
                    </div>
                  )}
                  <div className="text-right text-xs text-stone-400 hidden sm:block">—</div>
                  <div className="text-right text-xs text-stone-400 hidden sm:block">—</div>
                  <div />
                </div>
              </ContextMenuTrigger>
              <ItemContextMenuContent
                type="folder"
                id={folder.id}
                name={folder.name}
                item={folder}
                isTrashView={isTrashView}

                isStarred={isStarred}
                onToggleStar={onToggleStar}
                onShare={onShare}
                onRestore={onRestore}
                onPermanentDelete={onPermanentDelete}
                onAddToWorkspace={onAddToWorkspace}
                onViewInfo={onViewInfo}
                onSetRetentionPolicy={onSetRetentionPolicy}
              />
            </ContextMenu>
          );
        })}

        {/* Files */}
        {sortedFiles.map((file) => {
          const native = isGoogleNative(file.mimeType);
          const shared = file.id ? isTargetShared?.(file.id, 'file') : false;
          const isSelected = selectedKeys.has(file.id);

          return (
            <ContextMenu key={file.id}>
              <ContextMenuTrigger>
                <div
                  onClick={(e) => handleItemClick(e, { type: 'file', item: file })}
                  onDoubleClick={() => {
                    if (isTrashView) {
                      return;
                    }
                    onPreviewFile?.(file);
                  }}
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = setTimeout(() => {
                      api.getFile(file.id).catch(() => {});
                    }, 300);
                  }}
                  onMouseLeave={() => {
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  }}
                  className={`grid ${listGridClass} gap-0 items-center px-4 py-2.5 cursor-pointer transition-colors border-b border-stone-50 group ${
                    isSelected
                      ? 'bg-blue-100 hover:bg-blue-200'
                      : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="w-[72px] flex items-center gap-2 pl-3">
                    <input 
                      type="checkbox" 
                      className={`w-4 h-4 cursor-pointer flex-shrink-0 ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                      checked={isSelected}
                      readOnly
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(e, { type: 'file', item: file });
                      }}
                    />
                    <span className="text-xl flex-shrink-0"><FileIcon mimeType={file.mimeType} /></span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm text-stone-800 truncate" title={file.name}>{file.name}</span>
                    {file.isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                    {renderMetadataBadges(file.metadata)}
                    {!showDriveColumn && renderDriveBadge(file.driveAccountId)}
                  </div>
                  {showDriveColumn && (
                    <div className="hidden sm:flex items-center min-w-0">
                      {renderDriveBadge(file.driveAccountId)}
                    </div>
                  )}
                  <div className="text-right text-xs text-stone-500 hidden sm:block">
                    {!native ? formatFileSize(file.size) : '—'}
                  </div>
                  <div className="text-right text-xs text-stone-500 hidden sm:block">
                    {formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}
                  </div>
                  <div />
                </div>
              </ContextMenuTrigger>
              <ItemContextMenuContent
                type="file"
                id={file.id}
                name={file.name}
                item={file}
                native={native}
                isTrashView={isTrashView}
                isStarred={file.isStarred}
                onToggleStar={onToggleStar}
                onPreviewFile={onPreviewFile}
                onShare={onShare}
                onRenameFile={onRenameFile}
                onMoveDrive={onMoveDrive}
                onDeleteFile={onDeleteFile}
                onRestore={onRestore}
                onPermanentDelete={onPermanentDelete}
                onAddToWorkspace={onAddToWorkspace}
                onViewInfo={onViewInfo}
                onSetRetentionPolicy={onSetRetentionPolicy}
              />
            </ContextMenu>
          );
        })}
      </div>
    );
  }

  /* ─────────────────── GRID VIEW ─────────────────── */
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4">
      {/* Render Folders */}
      {sortedSubfolders.map((folder) => {
          const isVirtual = !('googleFolderId' in folder);
          const key = 'googleFolderId' in folder ? folder.googleFolderId : folder.id;
          const driveAccountId = 'driveAccountId' in folder ? folder.driveAccountId : undefined;
          const { drive } = getDriveInfo(driveAccountId);
          const hasError = drive ? errorDrives?.has(drive.id) : false;
          const shared = folder.id ? isTargetShared?.(folder.id, 'folder') : false;
          const isStarred = 'isStarred' in folder ? folder.isStarred : false;
          const isSelected = selectedKeys.has(folder.id || ('googleFolderId' in folder ? folder.googleFolderId : undefined));

        return (
          <ContextMenu key={key}>
            <ContextMenuTrigger>
              <div
                onClick={(e) => handleItemClick(e, { type: 'folder', item: folder })}
                onDoubleClick={() => {
                  if (isTrashView) return;
                    if (isVirtual) {
                      onNavigateFolder?.(folder.id, 'virtual');
                    } else if (driveAccountId && 'googleFolderId' in folder) {
                      onNavigateFolder?.(folder.googleFolderId, driveAccountId);
                    }
                }}
                onMouseEnter={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = setTimeout(() => {
                    if (isVirtual) {
                      api.getFolderContents(folder.id).catch(() => {});
                    } else if (driveAccountId && 'googleFolderId' in folder) {
                      api.getDriveFolderContents(driveAccountId, folder.googleFolderId).catch(() => {});
                    }
                  }, 300);
                }}
                onMouseLeave={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                }}
                className={`p-3 border rounded-xl cursor-pointer flex flex-col gap-2 transition-all group relative ${
                    isSelected
                    ? 'bg-blue-100 border-blue-300'
                    : hasError
                    ? 'border-red-300 bg-red-50 hover:border-red-400'
                    : 'border-stone-300 bg-card hover:bg-blue-50 hover:border-blue-200'
                }`}
              >
                <input
                  type="checkbox"
                  className={`absolute top-2 left-2 z-10 w-4 h-4 cursor-pointer ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                  checked={isSelected}
                  readOnly
                  onClick={(e) => {
                    e.stopPropagation();
                    handleItemClick(e, { type: 'folder', item: folder });
                  }}
                />
                <div className="flex items-center gap-3 min-w-0">
                  <Folder size={20} className="text-blue-500 flex-shrink-0 ml-5" fill="currentColor" />
                  <div className="flex-1 truncate text-sm font-medium text-stone-800">
                    {folder.name}
                  </div>
                  <div className="flex gap-1 items-center">
                    {isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                  </div>
                </div>
                {renderDriveBadge(driveAccountId)}
              </div>
            </ContextMenuTrigger>
            <ItemContextMenuContent
              type="folder"
              id={folder.id}
              name={folder.name}
              item={folder}
              isTrashView={isTrashView}

              isStarred={isStarred}
              onToggleStar={onToggleStar}
              onShare={onShare}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onAddToWorkspace={onAddToWorkspace}
              onViewInfo={onViewInfo}
            />
          </ContextMenu>
        );
      })}

      {/* Render Files */}
      {sortedFiles.map((file) => {
        const native = isGoogleNative(file.mimeType);
        const shared = file.id ? isTargetShared?.(file.id, 'file') : false;
        const isSelected = selectedKeys.has(file.id);

        return (
          <ContextMenu key={file.id}>
            <ContextMenuTrigger>
              <div
                onClick={(e) => handleItemClick(e, { type: 'file', item: file })}
                onDoubleClick={() => {
                  if (isTrashView) {
                    return;
                  }
                  onPreviewFile?.(file);
                }}
                onMouseEnter={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = setTimeout(() => {
                    api.getFile(file.id).catch(() => {});
                  }, 300);
                }}
                onMouseLeave={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                }}
                className={`p-3 border rounded-xl cursor-pointer flex flex-col justify-between h-40 transition-all group relative ${
                  isSelected
                    ? 'bg-blue-100 border-blue-300'
                    : 'bg-card border-stone-300 hover:bg-blue-50 hover:border-blue-200'
                }`}
              >
                <input 
                  type="checkbox" 
                  className={`absolute top-2 left-2 z-10 w-4 h-4 cursor-pointer ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                  checked={isSelected}
                  readOnly
                  onClick={(e) => {
                    e.stopPropagation();
                    handleItemClick(e, { type: 'file', item: file });
                  }}
                />
                <div className="flex justify-between items-start">
                  <div className="text-3xl ml-5"><FileIcon mimeType={file.mimeType} /></div>
                  <div className="flex gap-1 items-center">
                    {file.isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-xs text-stone-800 truncate mb-1 leading-snug" title={file.name}>
                    {file.name}
                  </div>
                  <div className="mb-1.5">{renderDriveBadge(file.driveAccountId)}</div>
                  <div className="flex items-center text-xs text-stone-400 gap-1.5">
                    {!native && <span className="truncate">{formatFileSize(file.size)}</span>}
                    {!native && <span>·</span>}
                    <span className="truncate">{formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}</span>
                  </div>
                </div>
              </div>
            </ContextMenuTrigger>
            <ItemContextMenuContent
              type="file"
              id={file.id}
              name={file.name}
              item={file}
              native={native}
              isTrashView={isTrashView}
              isStarred={file.isStarred}
              onToggleStar={onToggleStar}
              onPreviewFile={onPreviewFile}
              onShare={onShare}
              onRenameFile={onRenameFile}
              onMoveDrive={onMoveDrive}
              onDeleteFile={onDeleteFile}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
            />
          </ContextMenu>
        );
      })}
    </div>
  );
};
