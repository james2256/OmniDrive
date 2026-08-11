import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { sortFiles, sortFolders } from '../../lib/sort-items';
import { DriveBadge } from '../DriveBadge';
import { EmptyState } from '../EmptyState';
import { FileListView } from './FileListView';
import { FileGridView } from './FileGridView';
import { FolderOpen } from 'lucide-react';
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

  // Drive column always shows by default — users want to see which drive each
  // item belongs to, even when all items in the view are from the same drive.
  // Pages can still opt out via `showDriveColumn={false}`.
  const showDriveColumn = showDriveColumnProp ?? true;

  const renderDriveBadge = (
    driveAccountId?: string,
    fallbackEmail?: string,
    ownerEmail?: string | null,
  ) => {
    if (!driveAccountId) return null;
    const { drive, index } = getDriveInfo(driveAccountId);
    // Prefer owner email (shows who actually owns the file), fall back to
    // drive account email (for owned files or when Google omitted owner email).
    // colorIndex stays tied to the connected drive — multi-drive color ID preserved.
    const email = ownerEmail ?? drive?.email ?? fallbackEmail;
    if (!email) return null;
    return <DriveBadge email={email} colorIndex={index} />;
  };

  if (files.length === 0 && subfolders.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="This folder is empty"
        description="Drag & drop files here or click Upload"
      />
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
