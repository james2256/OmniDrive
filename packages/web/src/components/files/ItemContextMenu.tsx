import React from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '../ui/context-menu';
import { Folder, Download, Trash2, Pencil, ExternalLink, Share2, RefreshCw, Eye, Star, Info } from 'lucide-react';
import type { FileEntry, DriveFolder, WorkspaceFolder } from '../../types';
import type { ItemActions, ItemKind } from './types';

interface ItemContextMenuProps {
  type: ItemKind;
  item: FileEntry | DriveFolder | WorkspaceFolder;
  actions: ItemActions;
  isTrashView?: boolean;
  isStarred?: boolean;
  /** The trigger element (row or card). Owned by the view for layout. */
  children: React.ReactNode;
}

/**
 * Wraps a trigger element with a Radix ContextMenu and renders the appropriate
 * menu items based on item type, trash-view mode, and which callbacks are present.
 *
 * The entire `actions` bag is forwarded to the menu content — there is no
 * per-prop forwarding at call sites. This structurally prevents the prior
 * grid-view bugs where "Add to Workspace" / "View Info" / "Set Retention
 * Policy" silently disappeared because a prop was omitted at one of four
 * `<ItemContextMenuContent>` call sites.
 */
export function ItemContextMenu({ type, item, actions, isTrashView, isStarred, children }: ItemContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ItemContextMenuContent type={type} item={item} actions={actions} isTrashView={isTrashView} isStarred={isStarred} />
    </ContextMenu>
  );
}

interface ItemContextMenuContentProps {
  type: ItemKind;
  item: FileEntry | DriveFolder | WorkspaceFolder;
  actions: ItemActions;
  isTrashView?: boolean;
  isStarred?: boolean;
}

const MENU_ITEM_CLASS = 'px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-100 outline-none flex items-center';
const MENU_ITEM_DANGER_CLASS = 'px-3 py-2 text-sm text-red-600 cursor-pointer hover:bg-red-50 outline-none flex items-center';

/**
 * Renders context menu items. Decides which items to show based on:
 *   - type ('file' | 'folder')
 *   - isTrashView (restore + delete-forever, vs normal actions)
 *   - action existence (only render items with a callback)
 *   - item fields (native, webViewLink, webContentLink, driveAccountId)
 *
 * Actions are destructured into local consts at the top so TypeScript can
 * narrow them in closure callbacks — no non-null assertions needed.
 */
const ItemContextMenuContent: React.FC<ItemContextMenuContentProps> = ({ type, item, actions, isTrashView, isStarred }) => {
  const file = type === 'file' ? (item as FileEntry) : undefined;
  const driveFolder = type === 'folder' && 'googleFolderId' in item ? (item as DriveFolder) : undefined;

  const fileId = file?.id;
  const webViewLink = file?.webViewLink;
  const driveAccountId = driveFolder?.driveAccountId;
  // For files: the DB UUID. For DriveFolders: googleFolderId. For WorkspaceFolders: workspace id.
  const itemId = driveFolder ? driveFolder.googleFolderId : item.id ?? '';
  const showItemActions = !!(itemId || driveFolder);
  const name = 'name' in item ? item.name : undefined;

  const {
    onViewInfo,
    onRestore,
    onPermanentDelete,
    onRestoreFolder,
    onPermanentDeleteFolder,
    onPreviewFile,
    onShare,
    onToggleStar,
    onAddToWorkspace,
    onSetRetentionPolicy,
    onRenameFileRequest,
    onRenameFolderRequest,
    onMoveDrive,
    onDeleteFile,
    onDeleteFolder,
  } = actions;

  return (
    <ContextMenuContent className="w-48 bg-card border border-slate-200 shadow-xl rounded-xl overflow-hidden py-1">
      {/* View Info — available for both files and folders */}
      {onViewInfo && (
        <ContextMenuItem className={MENU_ITEM_CLASS} onClick={() => onViewInfo(item, type)}>
          <Info size={16} className="mr-3 text-slate-500" />
          View Info
        </ContextMenuItem>
      )}

      {isTrashView ? (
        <>
          {/* Trash view: Restore + Delete Forever only */}
          {type === 'file' && onRestore && fileId && (
            <ContextMenuItem className={MENU_ITEM_CLASS} onClick={() => onRestore(fileId)}>
              <RefreshCw size={16} className="mr-3 text-slate-500" />
              Restore
            </ContextMenuItem>
          )}
          {type === 'folder' && onRestoreFolder && driveAccountId && driveFolder && (
            <ContextMenuItem
              className={MENU_ITEM_CLASS}
              onClick={() => onRestoreFolder(driveAccountId, driveFolder.googleFolderId)}
            >
              <RefreshCw size={16} className="mr-3 text-slate-500" />
              Restore
            </ContextMenuItem>
          )}
          {type === 'file' && onPermanentDelete && fileId && (
            <ContextMenuItem className={MENU_ITEM_DANGER_CLASS} onClick={() => onPermanentDelete(fileId)}>
              <Trash2 size={16} className="mr-3 text-red-500" />
              Delete Forever
            </ContextMenuItem>
          )}
          {type === 'folder' && onPermanentDeleteFolder && driveAccountId && driveFolder && (
            <ContextMenuItem
              className={MENU_ITEM_DANGER_CLASS}
              onClick={() => onPermanentDeleteFolder(driveAccountId, driveFolder.googleFolderId)}
            >
              <Trash2 size={16} className="mr-3 text-red-500" />
              Delete Forever
            </ContextMenuItem>
          )}
        </>
      ) : (
        <>
          {/* Normal view: full action set */}
          {type === 'file' && file && onPreviewFile && (
            <ContextMenuItem className={MENU_ITEM_CLASS} onClick={() => onPreviewFile(file)}>
              <Eye size={16} className="mr-3 text-slate-500" />
              Preview
            </ContextMenuItem>
          )}
          {type === 'file' && file && webViewLink && (
            <ContextMenuItem onClick={() => window.open(webViewLink, '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open in Google
            </ContextMenuItem>
          )}
          {driveFolder && (
            <ContextMenuItem
              onClick={() => window.open(`https://drive.google.com/drive/folders/${driveFolder.googleFolderId}`, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> Open in Google
            </ContextMenuItem>
          )}
          {type === 'file' && file && (
            <ContextMenuItem onClick={() => { window.location.href = `${import.meta.env.VITE_API_URL || ''}/api/files/${file.id}/download`; }}>
              <Download className="mr-2 h-4 w-4" /> Download
            </ContextMenuItem>
          )}
          {onToggleStar && showItemActions && (
            <ContextMenuItem onClick={() => onToggleStar(itemId, type, !!isStarred, driveAccountId)}>
              <Star className="mr-2 h-4 w-4" /> {isStarred ? 'Remove from Starred' : 'Add to Starred'}
            </ContextMenuItem>
          )}
          {onShare && showItemActions && (
            <ContextMenuItem onClick={() => onShare(itemId, type)}>
              <Share2 className="mr-2 h-4 w-4" /> Share
            </ContextMenuItem>
          )}
          {type === 'file' && file && onAddToWorkspace && (
            <ContextMenuItem onClick={() => onAddToWorkspace(file)}>
              <Folder className="mr-2 h-4 w-4" /> Add to Workspace
            </ContextMenuItem>
          )}
          {onSetRetentionPolicy && showItemActions && (
            <ContextMenuItem onClick={() => onSetRetentionPolicy(itemId, type)}>
              <Folder className="mr-2 h-4 w-4" /> Set Retention Policy
            </ContextMenuItem>
          )}
          {type === 'file' && onRenameFileRequest && fileId && name && (
            <ContextMenuItem
              onClick={() => onRenameFileRequest(fileId, name)}
            >
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </ContextMenuItem>
          )}
          {type === 'folder' && onRenameFolderRequest && driveAccountId && driveFolder && name && (
            <ContextMenuItem
              onClick={() => onRenameFolderRequest(driveAccountId, driveFolder.googleFolderId, name)}
            >
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </ContextMenuItem>
          )}
          {type === 'file' && file && onMoveDrive && (
            <ContextMenuItem onClick={() => onMoveDrive(file)}>
              <ExternalLink className="mr-2 h-4 w-4" /> Move to another drive
            </ContextMenuItem>
          )}
          {type === 'file' && onDeleteFile && fileId && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem className="text-red-600" onClick={() => onDeleteFile(fileId)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </ContextMenuItem>
            </>
          )}
          {type === 'folder' && onDeleteFolder && driveAccountId && driveFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-red-600"
                onClick={() => onDeleteFolder(driveAccountId, driveFolder.googleFolderId)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </ContextMenuItem>
            </>
          )}
        </>
      )}
    </ContextMenuContent>
  );
};
