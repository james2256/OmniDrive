import React from 'react';
import type { FileEntry, DriveFolder, VirtualFolder } from '../../types';
import { getFileIcon, formatFileSize, formatRelativeTime, getDriveColor } from '../../lib/utils';
import { Folder, Download, Trash2, Pencil, ExternalLink, Share2, RefreshCw, Eye, Star, Info } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '../ui/context-menu';
import { useUIStore } from '../../stores/useUIStore';
import { useSelectionStore } from '../../stores/useSelectionStore';
function isGoogleNative(mimeType: string | null): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}

const ItemContextMenuContent: React.FC<{
  type: 'file' | 'folder';
  id?: string;
  name?: string;
  native?: boolean;
  file?: FileEntry;
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
  onAddToVirtualFolder?: (item: FileEntry) => void;
  onViewInfo?: (item: FileEntry | DriveFolder | VirtualFolder, type: 'file' | 'folder') => void;
}> = ({
  type,
  id,
  name,
  native,
  file,
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
  onAddToVirtualFolder,
  onViewInfo,
}) => (
  <ContextMenuContent className="w-48 bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden py-1">
    {onViewInfo && id && (
      <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onViewInfo(file ?? { id, name } as any, type)}>
        <Info size={16} className="mr-3 text-gray-500" />
        View Info
      </ContextMenuItem>
    )}
    {isTrashView ? (
      <>
        {onRestore && id && (
          <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onRestore(id)}>
            <RefreshCw size={16} className="mr-3 text-gray-500" />
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
          <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onPreviewFile(file)}>
            <Eye size={16} className="mr-3 text-gray-500" />
            Preview
          </ContextMenuItem>
        )}
        {type === 'file' && file && native && file.webViewLink && (
          <ContextMenuItem onClick={() => window.open(file.webViewLink!, '_blank', 'noopener,noreferrer')}>
            <ExternalLink className="mr-2 h-4 w-4" /> Open in Google
          </ContextMenuItem>
        )}
        {type === 'file' && file && !native && file.webContentLink && (
          <ContextMenuItem onClick={() => window.open(file.webContentLink!, '_blank', 'noopener,noreferrer')}>
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
        {type === 'file' && file && onAddToVirtualFolder && (
          <ContextMenuItem onClick={() => onAddToVirtualFolder(file)}>
            <Folder className="mr-2 h-4 w-4" /> Add to Virtual Folder
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

export interface FileGridProps {
  files: FileEntry[];
  subfolders: (DriveFolder | VirtualFolder)[];
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
  isTrashView?: boolean;
  onRestore?: (fileId: string) => void;
  onPermanentDelete?: (fileId: string) => void;
  onAddToVirtualFolder?: (item: FileEntry) => void;
  onViewInfo?: (item: FileEntry | DriveFolder | VirtualFolder, type: 'file' | 'folder') => void;
}

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
  isTrashView,
  onRestore,
  onPermanentDelete,
  onAddToVirtualFolder,
  onViewInfo,
}) => {
  const storeViewMode = useUIStore((s) => s.viewMode);
  const viewMode = viewModeProp ?? storeViewMode;
  const { selectedItem, setSelection } = useSelectionStore();

  if (files.length === 0 && subfolders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-6xl mb-4">📂</p>
        <p className="text-lg font-medium text-gray-500">This folder is empty</p>
        <p className="text-sm mt-1">Drag &amp; drop files here or click Upload</p>
      </div>
    );
  }

  /* ─────────────────── LIST VIEW ─────────────────── */
  if (viewMode === 'list') {
    return (
      <div className="w-full">
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_120px_140px_44px] gap-0 border-b border-gray-100 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <span className="w-10" />
          <span>Name</span>
          <span className="text-right">Size</span>
          <span className="text-right">Modified</span>
          <span />
        </div>

        {/* Folders */}
        {subfolders.map((folder) => {
          const isVirtual = !('googleFolderId' in folder);
          const key = isVirtual ? folder.id : (folder as DriveFolder).googleFolderId;
          const driveAccountId = isVirtual ? undefined : (folder as DriveFolder).driveAccountId;
          const { drive } = getDriveInfo(driveAccountId);
          const hasError = drive ? errorDrives?.has(drive.id) : false;
          const shared = folder.id ? isTargetShared?.(folder.id, 'folder') : false;
          const isStarred = 'isStarred' in folder ? folder.isStarred : false;

          return (
            <ContextMenu key={key}>
              <ContextMenuTrigger>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelection({ type: 'folder', item: folder });
                  }}
                  onDoubleClick={() => {
                    if (isTrashView) return;
                    if (isVirtual) {
                      onNavigateFolder?.(folder.id, 'virtual');
                    } else if (driveAccountId) {
                      onNavigateFolder?.((folder as DriveFolder).googleFolderId, driveAccountId);
                    }
                  }}
                  className={`grid grid-cols-[auto_1fr_120px_140px_44px] gap-0 items-center px-4 py-2.5 cursor-pointer transition-colors border-b border-gray-50 group ${
                    selectedItem?.type === 'folder' && (isVirtual ? selectedItem.item.id === folder.id : (selectedItem.item as DriveFolder).googleFolderId === key)
                      ? 'bg-blue-100 hover:bg-blue-200'
                      : hasError
                      ? 'bg-red-50 hover:bg-red-100'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="w-10 flex justify-center">
                    <Folder size={20} className="text-blue-500" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-800 font-medium truncate">{folder.name}</span>
                    {isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                  </div>
                  <div className="text-right text-xs text-gray-400">—</div>
                  <div className="text-right text-xs text-gray-400">—</div>
                  <div />
                </div>
              </ContextMenuTrigger>
              <ItemContextMenuContent
                type="folder"
                id={folder.id}
                name={folder.name}
                file={folder as any}
                isTrashView={isTrashView}

                isStarred={isStarred}
                onToggleStar={onToggleStar}
                onShare={onShare}
                onRestore={onRestore}
                onPermanentDelete={onPermanentDelete}
                onAddToVirtualFolder={onAddToVirtualFolder}
                onViewInfo={onViewInfo}
              />
            </ContextMenu>
          );
        })}

        {/* Files */}
        {files.map((file) => {
          const { index } = getDriveInfo(file.driveAccountId);
          const driveColor = getDriveColor(index);
          const native = isGoogleNative(file.mimeType);
          const shared = file.id ? isTargetShared?.(file.id, 'file') : false;

          return (
            <ContextMenu key={file.id}>
              <ContextMenuTrigger>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelection({ type: 'file', item: file });
                  }}
                  onDoubleClick={() => {
                    if (isTrashView) {
                      return;
                    }
                    if (native && file.webViewLink) {
                      window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
                    } else {
                      onPreviewFile?.(file);
                    }
                  }}
                  className={`grid grid-cols-[auto_1fr_120px_140px_44px] gap-0 items-center px-4 py-2.5 cursor-pointer transition-colors border-b border-gray-50 ${
                    selectedItem?.type === 'file' && selectedItem.item.id === file.id
                      ? 'bg-blue-100 hover:bg-blue-200'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="w-10 flex justify-center">
                    <span className="text-xl">{getFileIcon(file.mimeType)}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-800 truncate" title={file.name}>{file.name}</span>
                    {file.isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: driveColor }} />
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    {!native ? formatFileSize(file.size) : '—'}
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    {formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}
                  </div>
                  <div />
                </div>
              </ContextMenuTrigger>
              <ItemContextMenuContent
                type="file"
                id={file.id}
                name={file.name}
                file={file}
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
                onAddToVirtualFolder={onAddToVirtualFolder}
                onViewInfo={onViewInfo}
              />
            </ContextMenu>
          );
        })}
      </div>
    );
  }

  /* ─────────────────── GRID VIEW ─────────────────── */
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
      {/* Render Folders */}
      {subfolders.map((folder) => {
          const isVirtual = !('googleFolderId' in folder);
          const key = isVirtual ? folder.id : (folder as DriveFolder).googleFolderId;
          const driveAccountId = isVirtual ? undefined : (folder as DriveFolder).driveAccountId;
          const { drive } = getDriveInfo(driveAccountId);
          const hasError = drive ? errorDrives?.has(drive.id) : false;
          const shared = folder.id ? isTargetShared?.(folder.id, 'folder') : false;
          const isStarred = 'isStarred' in folder ? folder.isStarred : false;

        return (
          <ContextMenu key={key}>
            <ContextMenuTrigger>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelection({ type: 'folder', item: folder });
                }}
                onDoubleClick={() => {
                  if (isTrashView) return;
                    if (isVirtual) {
                      onNavigateFolder?.(folder.id, 'virtual');
                    } else if (driveAccountId) {
                      onNavigateFolder?.((folder as DriveFolder).googleFolderId, driveAccountId);
                    }
                }}
                className={`p-3 border rounded-xl cursor-pointer flex items-center gap-2.5 transition-all ${
                    selectedItem?.type === 'folder' && (isVirtual ? selectedItem.item.id === folder.id : (selectedItem.item as DriveFolder).googleFolderId === key)
                    ? 'bg-blue-100 border-blue-300'
                    : hasError
                    ? 'border-red-300 bg-red-50 hover:border-red-400'
                    : 'border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-200'
                }`}
              >
                <Folder size={20} className="text-blue-500 flex-shrink-0" />
                <div className="flex-1 truncate text-sm font-medium text-gray-800">
                  {folder.name}
                </div>
                <div className="flex gap-1 items-center">
                  {isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                  {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                </div>
              </div>
            </ContextMenuTrigger>
            <ItemContextMenuContent
              type="folder"
              id={folder.id}
              name={folder.name}
              file={folder as any}
              isTrashView={isTrashView}

              isStarred={isStarred}
              onToggleStar={onToggleStar}
              onShare={onShare}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onAddToVirtualFolder={onAddToVirtualFolder}
              onViewInfo={onViewInfo}
            />
          </ContextMenu>
        );
      })}

      {/* Render Files */}
      {files.map((file) => {
        const { index } = getDriveInfo(file.driveAccountId);
        const driveColor = getDriveColor(index);
        const native = isGoogleNative(file.mimeType);
        const shared = file.id ? isTargetShared?.(file.id, 'file') : false;

        return (
          <ContextMenu key={file.id}>
            <ContextMenuTrigger>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelection({ type: 'file', item: file });
                }}
                onDoubleClick={() => {
                  if (isTrashView) {
                    return;
                  }
                  if (native && file.webViewLink) {
                    window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
                  } else {
                    onPreviewFile?.(file);
                  }
                }}
                className={`p-3 border rounded-xl cursor-pointer flex flex-col justify-between h-36 transition-all group ${
                  selectedItem?.type === 'file' && selectedItem.item.id === file.id
                    ? 'bg-blue-100 border-blue-300'
                    : 'bg-white border-gray-200 hover:bg-blue-50 hover:border-blue-200'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="text-3xl">{getFileIcon(file.mimeType)}</div>
                  <div className="flex gap-1 items-center">
                    {file.isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-xs text-gray-800 truncate mb-1 leading-snug" title={file.name}>
                    {file.name}
                  </div>
                  <div className="flex items-center text-xs text-gray-400 gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: driveColor }} />
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
              file={file}
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
