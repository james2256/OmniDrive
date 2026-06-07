import React from 'react';
import type { FileEntry, DriveFolder } from '../../types';
import { getFileIcon, formatFileSize, formatRelativeTime, getDriveColor } from '../../lib/utils';
import { Folder, Download, Trash2, Pencil, ExternalLink, Share2 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '../ui/context-menu';
import { useUIStore } from '../../stores/useUIStore';

function isGoogleNative(mimeType: string | null): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}

export interface FileGridProps {
  files: FileEntry[];
  subfolders: DriveFolder[];
  getDriveInfo: (driveAccountId?: string) => { drive: any, index: number };
  onNavigateFolder?: (folderId: string, driveId: string) => void;
  onPreviewFile?: (file: FileEntry) => void;
  onShare?: (id: string, type: 'file' | 'folder') => void;
  onRenameFile?: (id: string, name: string) => void;
  onDeleteFile?: (id: string) => void;
  isTargetShared?: (id: string, type: 'file' | 'folder') => boolean;
  errorDrives?: Set<string>;
  onMoveDrive?: (file: FileEntry) => void;
  /** Override viewMode (optional). If not provided, reads from UIStore. */
  viewMode?: 'grid' | 'list';
}

export const FileGrid: React.FC<FileGridProps> = ({
  files,
  subfolders,
  getDriveInfo,
  onNavigateFolder,
  onPreviewFile,
  onShare,
  onRenameFile,
  onDeleteFile,
  isTargetShared,
  errorDrives,
  onMoveDrive,
  viewMode: viewModeProp,
}) => {
  const storeViewMode = useUIStore((s) => s.viewMode);
  const viewMode = viewModeProp ?? storeViewMode;

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
          const { drive } = getDriveInfo(folder.driveAccountId);
          const hasError = drive ? errorDrives?.has(drive.id) : false;
          const shared = folder.id ? isTargetShared?.(folder.id, 'folder') : false;

          return (
            <ContextMenu key={folder.googleFolderId}>
              <ContextMenuTrigger>
                <div
                  onClick={() => {
                    if (folder.driveAccountId) {
                      onNavigateFolder?.(folder.googleFolderId, folder.driveAccountId);
                    }
                  }}
                  className={`grid grid-cols-[auto_1fr_120px_140px_44px] gap-0 items-center px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-50 group ${hasError ? 'bg-red-50' : ''}`}
                >
                  <div className="w-10 flex justify-center">
                    <Folder size={20} className="text-blue-500" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-800 font-medium truncate">{folder.name}</span>
                    {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                  </div>
                  <div className="text-right text-xs text-gray-400">—</div>
                  <div className="text-right text-xs text-gray-400">—</div>
                  <div />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {folder.id && onShare && (
                  <ContextMenuItem onClick={() => onShare(folder.id!, 'folder')}>
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
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
                  onClick={() => {
                    if (native && file.webViewLink) {
                      window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
                    } else {
                      onPreviewFile?.(file);
                    }
                  }}
                  className="grid grid-cols-[auto_1fr_120px_140px_44px] gap-0 items-center px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-50"
                >
                  <div className="w-10 flex justify-center">
                    <span className="text-xl">{getFileIcon(file.mimeType)}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-800 truncate" title={file.name}>{file.name}</span>
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
              <ContextMenuContent>
                {native && file.webViewLink && (
                  <ContextMenuItem onClick={() => window.open(file.webViewLink!, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Open in Google
                  </ContextMenuItem>
                )}
                {!native && file.webContentLink && (
                  <ContextMenuItem onClick={() => window.open(file.webContentLink!, '_blank', 'noopener,noreferrer')}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </ContextMenuItem>
                )}
                {onShare && (
                  <ContextMenuItem onClick={() => onShare(file.id, 'file')}>
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </ContextMenuItem>
                )}
                {onRenameFile && (
                  <ContextMenuItem onClick={() => {
                    const newName = prompt('Rename file:', file.name);
                    if (newName && newName !== file.name) onRenameFile(file.id, newName);
                  }}>
                    <Pencil className="mr-2 h-4 w-4" /> Rename
                  </ContextMenuItem>
                )}
                {onMoveDrive && (
                  <ContextMenuItem onClick={() => onMoveDrive(file)}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Move to another drive
                  </ContextMenuItem>
                )}
                {onDeleteFile && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-red-600" onClick={() => onDeleteFile(file.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
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
        const { drive } = getDriveInfo(folder.driveAccountId);
        const hasError = drive ? errorDrives?.has(drive.id) : false;
        const shared = folder.id ? isTargetShared?.(folder.id, 'folder') : false;

        return (
          <ContextMenu key={folder.googleFolderId}>
            <ContextMenuTrigger>
              <div
                onClick={() => {
                  if (folder.driveAccountId) {
                    onNavigateFolder?.(folder.googleFolderId, folder.driveAccountId);
                  }
                }}
                className={`p-3 border rounded-xl cursor-pointer hover:bg-blue-50 hover:border-blue-200 flex items-center gap-2.5 transition-all ${hasError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}
              >
                <Folder size={20} className="text-blue-500 flex-shrink-0" />
                <div className="flex-1 truncate text-sm font-medium text-gray-800">
                  {folder.name}
                </div>
                {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {folder.id && onShare && (
                <ContextMenuItem onClick={() => onShare(folder.id!, 'folder')}>
                  <Share2 className="mr-2 h-4 w-4" /> Share
                </ContextMenuItem>
              )}
            </ContextMenuContent>
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
                onClick={() => {
                  if (native && file.webViewLink) {
                    window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
                  } else {
                    onPreviewFile?.(file);
                  }
                }}
                className="p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 hover:border-gray-300 bg-white flex flex-col justify-between h-36 transition-all group"
              >
                <div className="flex justify-between items-start">
                  <div className="text-3xl">{getFileIcon(file.mimeType)}</div>
                  {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
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
            <ContextMenuContent>
              {native && file.webViewLink && (
                <ContextMenuItem onClick={() => window.open(file.webViewLink!, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open in Google
                </ContextMenuItem>
              )}
              {!native && file.webContentLink && (
                <ContextMenuItem onClick={() => window.open(file.webContentLink!, '_blank', 'noopener,noreferrer')}>
                  <Download className="mr-2 h-4 w-4" /> Download
                </ContextMenuItem>
              )}
              {onShare && (
                <ContextMenuItem onClick={() => onShare(file.id, 'file')}>
                  <Share2 className="mr-2 h-4 w-4" /> Share
                </ContextMenuItem>
              )}
              {onRenameFile && (
                <ContextMenuItem onClick={() => {
                  const newName = prompt('Rename file:', file.name);
                  if (newName && newName !== file.name) onRenameFile(file.id, newName);
                }}>
                  <Pencil className="mr-2 h-4 w-4" /> Rename
                </ContextMenuItem>
              )}
              {onMoveDrive && (
                <ContextMenuItem onClick={() => onMoveDrive(file)}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Move to another drive
                </ContextMenuItem>
              )}
              {onDeleteFile && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="text-red-600" onClick={() => onDeleteFile(file.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
};
