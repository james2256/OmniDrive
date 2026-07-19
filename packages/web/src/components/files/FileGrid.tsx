import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { sortFiles, sortFolders } from '../../lib/sort-items';
import { DriveBadge } from '../DriveBadge';
import { FileListView } from './FileListView';
import { FileGridView } from './FileGridView';
import type { FileGridProps } from './types';

/**
 * Orchestrator for the file/folder listing.
 *
 * Responsibilities:
 *   - Resolve view mode (prop override or store default)
 *   - Memoise sorted folders/files and unique-drive count
 *   - Render the empty state
 *   - Delegate to {@link FileListView} or {@link FileGridView}
 *
 * All interaction logic (click, double-click, hover-prefetch) lives in
 * {@link useItemInteractions}, and all context-menu rendering lives in
 * {@link ItemContextMenu}. This keeps the orchestrator under ~90 lines.
 */
export function FileGrid(props: FileGridProps) {
  const {
    files,
    subfolders,
    getDriveInfo,
    isTargetShared,
    errorDrives,
    viewMode: viewModeProp,
    showDriveColumn: showDriveColumnProp,
    isTrashView,
    actions,
  } = props;

  const storeViewMode = useUIStore((s) => s.viewMode);
  const sortField = useUIStore((s) => s.sortField);
  const sortDirection = useUIStore((s) => s.sortDirection);
  const viewMode = viewModeProp ?? storeViewMode;

  const sortedSubfolders = React.useMemo(
    () => sortFolders(subfolders, sortField, sortDirection),
    [subfolders, sortField, sortDirection],
  );
  const sortedFiles = React.useMemo(
    () => sortFiles(files, sortField, sortDirection),
    [files, sortField, sortDirection],
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

  if (files.length === 0 && subfolders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-400">
        <p className="text-6xl mb-4">📂</p>
        <p className="text-lg font-medium text-stone-500">This folder is empty</p>
        <p className="text-sm mt-1">Drag &amp; drop files here or click Upload</p>
      </div>
    );
  }

  const sharedViewProps = {
    sortedSubfolders,
    sortedFiles,
    getDriveInfo,
    isTargetShared,
    errorDrives,
    isTrashView,
    actions,
    renderDriveBadge,
  };

  if (viewMode === 'list') {
    return <FileListView {...sharedViewProps} showDriveColumn={showDriveColumn} />;
  }
  return <FileGridView {...sharedViewProps} />;
}

// Re-export the props type so consumers using `ComponentProps<typeof FileGrid>`
// (e.g. WorkspaceFilesTab) continue to resolve the same interface.
export type { FileGridProps } from './types';
