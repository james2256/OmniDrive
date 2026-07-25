import type { GoogleDriveService } from '../services/google-drive';

/**
 * IDOR check for shared-folder downloads: verify a file is inside the shared
 * folder by walking its parent chain up to the root. Prevents a visitor from
 * guessing Google file IDs and downloading files outside the shared folder.
 *
 * Walks up via `getFileParents()` (1 API call per ancestor) until it either
 * reaches the shared folder root (return true) or runs out of parents (return
 * false). Cycle-safe via a `visited` set.
 */
export async function isFileInSharedFolder(
  driveService: GoogleDriveService,
  driveId: string,
  fileId: string,
  rootFolderId: string,
): Promise<boolean> {
  let currentId = fileId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    if (currentId === rootFolderId) return true;

    const parents = await driveService.getFileParents(driveId, currentId);
    if (parents.length === 0) return false;
    currentId = parents[0];
  }
  return false;
}
