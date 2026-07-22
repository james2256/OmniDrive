import type React from 'react';
import type { FileEntry, DriveFolder, WorkspaceFolder, DriveAccount } from '../../types';

/** A folder item — either a Google Drive folder or a workspace virtual folder. */
export type FolderItem = DriveFolder | WorkspaceFolder;

/** Discriminator for item kind, used by context menu and interaction handlers. */
export type ItemKind = 'file' | 'folder';

/**
 * All action callbacks an item can trigger, grouped into a single object.
 *
 * Grouping (rather than 16 flat props) ensures every render path forwards the
 * same bag to the context menu, making it structurally impossible to "forget"
 * a callback at one call site — the root cause of the prior grid-view
 * missing-action bugs.
 */
export interface ItemActions {
  onNavigateFolder?: (folderId: string, driveId: string) => void;
  onToggleStar?: (id: string, type: ItemKind, currentStarStatus: boolean, driveId?: string) => void;
  onPreviewFile?: (file: FileEntry) => void;
  onShare?: (id: string, type: ItemKind) => void;
  onRenameFile?: (id: string, name: string) => void;
  onRenameFolder?: (driveId: string, folderId: string, name: string) => void;
  /**
   * Request to rename a file — opens the RenameDialog (parent-managed) with
   * the file's current name. Replaces the previous inline `prompt()` flow.
   */
  onRenameFileRequest?: (fileId: string, currentName: string) => void;
  /**
   * Request to rename a Google Drive folder — opens the RenameDialog
   * (parent-managed) with the folder's current name.
   */
  onRenameFolderRequest?: (driveId: string, folderId: string, currentName: string) => void;
  onDeleteFile?: (id: string) => void;
  onDeleteFolder?: (driveId: string, folderId: string) => void;
  onMoveDrive?: (file: FileEntry) => void;
  onRestore?: (fileId: string) => void;
  onPermanentDelete?: (fileId: string) => void;
  onRestoreFolder?: (driveId: string, folderId: string) => void;
  onPermanentDeleteFolder?: (driveId: string, folderId: string) => void;
  onAddToWorkspace?: (item: FileEntry) => void;
  onViewInfo?: (item: FileEntry | DriveFolder | WorkspaceFolder, type: ItemKind) => void;
  onSetRetentionPolicy?: (id: string, type: ItemKind) => void;
}

/** Props for the FileGrid orchestrator. */
export interface FileGridProps {
  files: FileEntry[];
  subfolders: FolderItem[];
  getDriveInfo: (driveAccountId?: string) => { drive: DriveAccount | null; index: number };
  isTargetShared?: (id: string, type: ItemKind) => boolean;
  errorDrives?: Set<string>;
  /** Override viewMode. If omitted, reads from useUIStore. */
  viewMode?: 'grid' | 'list';
  /** Show Drive column in list view (auto when >1 drive present). */
  showDriveColumn?: boolean;
  isTrashView?: boolean;
  /** All item action callbacks. */
  actions: ItemActions;
}

/** Shared props passed to both list and grid views. */
export interface FileViewSharedProps {
  sortedSubfolders: FolderItem[];
  sortedFiles: FileEntry[];
  getDriveInfo: (driveAccountId?: string) => { drive: DriveAccount | null; index: number };
  isTargetShared?: (id: string, type: ItemKind) => boolean;
  errorDrives?: Set<string>;
  isTrashView?: boolean;
  actions: ItemActions;
  renderDriveBadge: (driveAccountId?: string) => React.ReactNode;
}
