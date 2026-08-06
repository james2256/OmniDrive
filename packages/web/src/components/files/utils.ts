import type { DriveFolder, WorkspaceFolder } from '../../types';
import type { FolderItem } from './types';

/** Returns true for Google-native docs (Docs/Sheets/Slides) that cannot be downloaded directly. */
export function isGoogleNative(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}

/**
 * Returns the identifier used for folder sharing, selection, and React keys.
 * Drive folders use `googleFolderId`; workspace folders use `id`.
 */
export function getFolderIdentifier(folder: {
  googleFolderId?: string;
  id?: string;
}): string | undefined {
  return 'googleFolderId' in folder ? folder.googleFolderId : folder.id;
}

/**
 * Type guard: narrows a {@link FolderItem} to a {@link DriveFolder}.
 *
 * Uses the structural discriminator `'googleFolderId' in f` — the established
 * pattern across useItemInteractions, ItemContextMenu, getFolderIdentifier,
 * and useSelectionStore. DriveFolder has `googleFolderId`; WorkspaceFolder
 * does not.
 */
export function isDriveFolder(f: FolderItem): f is DriveFolder {
  return 'googleFolderId' in f;
}

/**
 * Type guard: narrows a {@link FolderItem} to a {@link WorkspaceFolder}.
 *
 * The complement of {@link isDriveFolder}. WorkspaceFolder lacks
 * `googleFolderId`, which is present on every DriveFolder.
 */
export function isWorkspaceFolder(f: FolderItem): f is WorkspaceFolder {
  return !('googleFolderId' in f);
}
