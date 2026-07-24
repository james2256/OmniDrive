import { Folder, Star, Share2 } from 'lucide-react';
import { useSelectionStore } from '../../stores/useSelectionStore';
import { formatFileSize, formatRelativeTime } from '../../lib/utils';
import { FileIcon } from './FileIcon';
import { ItemContextMenu } from './ItemContextMenu';
import { useItemInteractions } from './useItemInteractions';
import { isGoogleNative, getFolderIdentifier } from './utils';
import type { FileViewSharedProps } from './types';

export function FileGridView(props: FileViewSharedProps) {
  const {
    sortedSubfolders,
    sortedFiles,
    getDriveInfo,
    isTargetShared,
    errorDrives,
    isTrashView,
    actions,
    renderDriveBadge,
  } = props;

  // Selection state — read directly from the store.
  const selectedItems = useSelectionStore((s) => s.selectedItems);
  const hasSelection = selectedItems.length > 0;
  const selectedKeys = new Set(
    selectedItems.map((i) => {
      if (i.type === 'file') return i.item.id;
      return getFolderIdentifier(i.item as { googleFolderId?: string; id?: string });
    }),
  );

  const interactions = useItemInteractions({ sortedSubfolders, sortedFiles, actions, isTrashView });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4">
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
              className={`p-3 border rounded-xl cursor-pointer flex flex-col gap-2 transition-all group relative ${
                isSelected
                  ? 'bg-blue-100 border-blue-300'
                  : hasError
                  ? 'border-red-300 bg-red-50 hover:border-red-400'
                  : 'border-slate-200 bg-card shadow-sm hover:bg-blue-50 hover:border-blue-200'
              }`}
            >
              <input
                type="checkbox"
                className={`absolute top-2 left-2 z-10 w-4 h-4 cursor-pointer ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                checked={isSelected}
                readOnly
                onClick={(e) => {
                  e.stopPropagation();
                  interactions.handleClick(e, { type: 'folder', item: folder });
                }}
              />
              <div className="flex items-center gap-3 min-w-0">
                <Folder size={20} className="text-blue-500 flex-shrink-0 ml-5" fill="currentColor" />
                <div className="flex-1 truncate text-sm font-medium text-slate-800">
                  {folder.name}
                </div>
                <div className="flex gap-1 items-center">
                  {isStarred && <Star className="fill-yellow-400 text-yellow-400 flex-shrink-0" size={14} />}
                  {shared && <Share2 size={12} className="text-blue-400 flex-shrink-0" />}
                </div>
              </div>
              {renderDriveBadge(driveAccountId)}
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
              className={`p-3 border rounded-xl cursor-pointer flex flex-col justify-between h-40 transition-all group relative ${
                isSelected
                  ? 'bg-blue-100 border-blue-300'
                  : 'bg-card border-slate-200 shadow-sm hover:bg-blue-50 hover:border-blue-200'
              }`}
            >
              <input
                type="checkbox"
                className={`absolute top-2 left-2 z-10 w-4 h-4 cursor-pointer ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                checked={isSelected}
                readOnly
                onClick={(e) => {
                  e.stopPropagation();
                  interactions.handleClick(e, { type: 'file', item: file });
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
                <div className="font-medium text-xs text-slate-800 truncate mb-1 leading-snug" title={file.name}>
                  {file.name}
                </div>
                <div className="mb-1.5">{renderDriveBadge(file.driveAccountId)}</div>
                <div className="flex items-center text-xs text-slate-500 gap-1.5">
                  {!native && <span className="truncate">{formatFileSize(file.size)}</span>}
                  {!native && <span>·</span>}
                  <span className="truncate">{formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}</span>
                </div>
              </div>
            </div>
          </ItemContextMenu>
        );
      })}
    </div>
  );
}
