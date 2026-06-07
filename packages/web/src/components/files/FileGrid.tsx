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
}) => {
  if (files.length === 0 && subfolders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <p className="text-6xl mb-4">📂</p>
        <p className="text-lg">This folder is empty</p>
        <p className="text-sm">Drag & drop files here or click Upload</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
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
                className={`p-4 border rounded-xl cursor-pointer hover:bg-gray-50 flex items-center gap-3 transition-colors ${hasError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}
              >
                <Folder size={24} className="text-blue-500 flex-shrink-0" />
                <div className="flex-1 truncate font-medium text-sm text-gray-800">
                  {folder.name}
                </div>
                {shared && <Share2 size={14} className="text-blue-500 flex-shrink-0" />}
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
                className="p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 bg-white flex flex-col justify-between h-40 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="text-4xl">{getFileIcon(file.mimeType)}</div>
                  {shared && <Share2 size={14} className="text-blue-500 flex-shrink-0" />}
                </div>
                <div>
                  <div className="font-medium text-sm text-gray-800 truncate mb-1" title={file.name}>
                    {file.name}
                  </div>
                  <div className="flex items-center text-xs text-gray-500 gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: driveColor }} />
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
