import type { DriveProvider } from '../types/drive-provider';

/**
 * IDOR check for shared-folder downloads: verify a file is inside the shared
 * folder by walking its parent chain up to the root. Prevents a visitor from
 * guessing Google file IDs and downloading files outside the shared folder.
 *
 * Walks up via `getFileParents()` (1 API call per ancestor) until it either
 * reaches the shared folder root (return true) or runs out of parents (return
 * false). Cycle-safe via a `visited` set.
 *
 * @param initialParents - Optional. If provided, skips the first
 *   `getFileParents(fileId)` call — used by the shared-download path which
 *   already fetched parents via `getFileWithParents`. When omitted (or
 *   undefined), the first call falls back to `getFileParents` to preserve
 *   backward compatibility with existing callers.
 */
export async function isFileInSharedFolder(
  driveService: DriveProvider,
  driveId: string,
  fileId: string,
  rootFolderId: string,
  initialParents?: string[],
): Promise<boolean> {
  if (fileId === rootFolderId) return true;

  // Use provided parents (from getFileWithParents) or fetch them. Hoisting
  // this first call out of the loop lets the shared-download path reuse the
  // parents returned by getFileWithParents — eliminating a redundant API call.
  const firstParents = initialParents ?? (await driveService.getFileParents(driveId, fileId));
  if (firstParents.length === 0) return false;

  let currentId = firstParents[0];
  const visited = new Set<string>([fileId]);

  while (currentId && !visited.has(currentId)) {
    if (currentId === rootFolderId) return true;
    visited.add(currentId);
    const parents = await driveService.getFileParents(driveId, currentId);
    if (parents.length === 0) return false;
    currentId = parents[0];
  }
  return false;
}
