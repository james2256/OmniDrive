import type { GDriveFile, GDriveFolder } from '../types/google';
import type { DriveProvider } from '../types/drive-provider';

/**
 * Default caps for the download-tree walk.
 *
 * Workers Free plan allows 50 subrequests (fetch to Google API) per invocation.
 * 40 leaves headroom for token refresh, the root lookup, and the per-folder D1
 * upsert/read-back that the authenticated route does. 500 files keeps the
 * response payload and client-side ZIP assembly within memory/time budgets.
 */
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_API_CALLS = 40;

/** A single file entry in the download tree (keyed by Google file ID). */
export interface DownloadTreeFile {
  googleFileId: string;
  name: string;
  /** Relative path from the walk root, including folder prefixes (e.g. "sub/file.txt"). */
  path: string;
  size: number;
  mimeType: string | null;
}

/**
 * Sanitize a file or folder name for safe inclusion in a zip path.
 * Strips path separators (/ and \), NUL bytes, and leading dots that
 * could enable Zip Slip path traversal on extraction.
 *
 * Google Drive permits any characters in display names, but zip entry
 * names with / or .. can cause client-side extraction to write outside
 * the target directory.
 */
function sanitizePathSegment(name: string): string {
  return name.replace(/[/\\\0]+/g, '_').replace(/\.{2,}/g, (m) => '_'.repeat(m.length));
}

export interface BuildDownloadTreeOptions {
  driveService: DriveProvider;
  driveId: string;
  /** Google folder ID to start the recursive walk from. */
  rootFolderId: string;
  /** Max files to include in the returned tree. Default 500. */
  maxFiles?: number;
  /** Max `listFolderContents` (Google API) calls. Default 40. */
  maxApiCalls?: number;
  /**
   * Called after `listFolderContents` returns for each visited folder, BEFORE
   * the helper iterates that folder's files. The authenticated route
   * (drives.ts) uses this to persist the live Google view to D1 via
   * `batchUpsertFolderContents` so subsequent D1 lookups return the rows. The
   * public shared-link route (shared.ts) does not use this.
   */
  onFolderListed?: (
    folderId: string,
    files: GDriveFile[],
    folders: GDriveFolder[],
  ) => Promise<void> | void;
  /**
   * Per-file filter. Return false to exclude the file from the tree AND from
   * the `maxFiles` count. Default: include all. The authenticated route uses
   * this to exclude files not owned by the user, mirroring
   * `batchUpsertFolderContents`'s ownership filter so `maxFiles` counts only
   * owned files (matching the pre-refactor behavior where the D1 read-back
   * already excluded non-owned rows).
   */
  filterFile?: (file: GDriveFile) => boolean;
}

export interface BuildDownloadTreeResult {
  files: DownloadTreeFile[];
  /** True if `maxFiles` or `maxApiCalls` was hit before the walk completed. */
  truncated: boolean;
}

/**
 * Recursively walk a Google Drive folder tree and collect a flat list of files
 * with their relative paths — the payload used by the client-side ZIP
 * assembler (`FolderDownloadModal`).
 *
 * Shared by:
 * - `GET /api/drives/:driveId/folders/:googleFolderId/download-tree` (authed)
 * - `GET /api/shared/:id/download-tree` (public shared-link)
 *
 * The walk caps at `maxFiles` files and `maxApiCalls` Google API calls to stay
 * within the Workers Free tier subrequest budget; `truncated` is set when
 * either cap is hit so the client can warn the user.
 *
 * This helper does NOT do auth, response formatting, download-limit
 * enforcement, or D1 persistence — callers handle those. D1 persistence (for
 * the authed route) is opt-in via `onFolderListed`.
 */
export async function buildDownloadTree(
  opts: BuildDownloadTreeOptions,
): Promise<BuildDownloadTreeResult> {
  const {
    driveService,
    driveId,
    rootFolderId,
    maxFiles = DEFAULT_MAX_FILES,
    maxApiCalls = DEFAULT_MAX_API_CALLS,
    onFolderListed,
    filterFile,
  } = opts;

  const files: DownloadTreeFile[] = [];
  let apiCallCount = 0;
  let truncated = false;

  async function walk(folderId: string, pathPrefix: string): Promise<void> {
    if (files.length >= maxFiles || apiCallCount >= maxApiCalls) {
      truncated = true;
      return;
    }
    apiCallCount++;

    const { files: gFiles, folders: gFolders } = await driveService.listFolderContents(
      driveId,
      folderId,
    );

    if (onFolderListed) {
      await onFolderListed(folderId, gFiles, gFolders);
    }

    for (const file of gFiles) {
      // Filter first so excluded files don't count toward maxFiles — matches
      // the pre-refactor authed route, which iterated D1 rows (already
      // filtered to owned files by batchUpsertFolderContents).
      if (filterFile && !filterFile(file)) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const safeName = sanitizePathSegment(file.name);
      files.push({
        googleFileId: file.id,
        name: safeName,
        path: pathPrefix + safeName,
        size: parseInt(file.size ?? '0', 10),
        mimeType: file.mimeType ?? null,
      });
    }

    for (const folder of gFolders) {
      if (files.length >= maxFiles || apiCallCount >= maxApiCalls) {
        truncated = true;
        break;
      }
      await walk(folder.id, `${pathPrefix}${sanitizePathSegment(folder.name)}/`);
    }
  }

  await walk(rootFolderId, '');

  return { files, truncated };
}
