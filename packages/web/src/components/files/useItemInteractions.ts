import React from 'react';
import { api } from '../../lib/api';
import { useSelectionStore, type SelectedItem, isSameItem } from '../../stores/useSelectionStore';
import type { FileEntry } from '../../types';
import type { FolderItem, ItemActions } from './types';

export interface ItemInteractions {
  handleClick: (e: React.MouseEvent, item: SelectedItem) => void;
  handleFolderDoubleClick: (folder: FolderItem) => void;
  handleFileDoubleClick: (file: FileEntry) => void;
  handleFolderHover: (folder: FolderItem) => void;
  handleFileHover: (file: FileEntry) => void;
  handleHoverEnd: () => void;
}

/**
 * Centralises item click / double-click / hover-prefetch behaviour.
 *
 * Previously this logic was copy-pasted across four render blocks
 * (list-folder, list-file, grid-folder, grid-file). The hook guarantees
 * identical behaviour for every block and removes ~40 lines of duplication.
 */
export function useItemInteractions(opts: {
  sortedSubfolders: FolderItem[];
  sortedFiles: FileEntry[];
  actions: ItemActions;
  isTrashView?: boolean;
}): ItemInteractions {
  const { sortedSubfolders, sortedFiles, actions, isTrashView } = opts;
  const [lastSelected, setLastSelected] = React.useState<SelectedItem | null>(null);
  const toggleSelection = useSelectionStore((s) => s.toggleSelection);
  const selectMultiple = useSelectionStore((s) => s.selectMultiple);
  const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const allItems = React.useMemo<SelectedItem[]>(
    () => [
      ...sortedSubfolders.map((f) => ({ type: 'folder' as const, item: f })),
      ...sortedFiles.map((f) => ({ type: 'file' as const, item: f })),
    ],
    [sortedSubfolders, sortedFiles],
  );

  const handleClick = React.useCallback(
    (e: React.MouseEvent, item: SelectedItem) => {
      e.stopPropagation();
      if (e.shiftKey && lastSelected) {
        // Prevent text selection during shift-click range select.
        document.getSelection()?.removeAllRanges();
        const startIndex = allItems.findIndex((i) => isSameItem(i, lastSelected));
        const endIndex = allItems.findIndex((i) => isSameItem(i, item));
        if (startIndex !== -1 && endIndex !== -1) {
          const start = Math.min(startIndex, endIndex);
          const end = Math.max(startIndex, endIndex);
          selectMultiple(allItems.slice(start, end + 1));
        }
      } else {
        toggleSelection(item);
        setLastSelected(item);
      }
    },
    [lastSelected, allItems, toggleSelection, selectMultiple],
  );

  const handleFolderDoubleClick = React.useCallback(
    (folder: FolderItem) => {
      if (isTrashView) return;
      if (!('googleFolderId' in folder)) {
        // Workspace virtual folder — navigate by workspace id.
        actions.onNavigateFolder?.(folder.id, 'virtual');
      } else if (folder.driveAccountId) {
        // Google Drive folder — navigate by googleFolderId + drive id.
        actions.onNavigateFolder?.(folder.googleFolderId, folder.driveAccountId);
      }
    },
    [isTrashView, actions],
  );

  const handleFileDoubleClick = React.useCallback(
    (file: FileEntry) => {
      if (isTrashView) return;
      actions.onPreviewFile?.(file);
    },
    [isTrashView, actions],
  );

  const handleFolderHover = React.useCallback((folder: FolderItem) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      if (!('googleFolderId' in folder)) {
        api.getFolderContents(folder.id).catch(() => {});
      } else if (folder.driveAccountId) {
        api.getDriveFolderContents(folder.driveAccountId, folder.googleFolderId).catch(() => {});
      }
    }, 300);
  }, []);

  const handleFileHover = React.useCallback((file: FileEntry) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      api.getFile(file.id).catch(() => {});
    }, 300);
  }, []);

  const handleHoverEnd = React.useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  }, []);

  return {
    handleClick,
    handleFolderDoubleClick,
    handleFileDoubleClick,
    handleFolderHover,
    handleFileHover,
    handleHoverEnd,
  };
}
