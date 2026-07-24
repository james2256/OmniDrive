import { NotFoundError } from '../lib/errors';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { DriveAccount } from '../types/index';
import { mapDriveRow } from '../types/index';
import { GoogleDriveService, type GDriveFile, type GDriveFolder, type GDriveOwner } from './google-drive';
import { resolveSyncRootFolderId } from '../lib/drive-folder';
import type { Env } from '../types/env';
import { FileRepository } from '../repositories/file.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { batchInChunks } from '../lib/d1-batch';
import { logErrorNoCtx } from '../lib/logger';

let isShuttingDown = false;

export function getIsShuttingDown() {
  return isShuttingDown;
}

export function setShuttingDown(): void {
  isShuttingDown = true;
}

const MIME_TYPE_FOLDER = 'application/vnd.google-apps.folder';
const MIME_TYPE_SHORTCUT = 'application/vnd.google-apps.shortcut';

// Workers Free plan: 50 external subrequests (fetch to Google API) per invocation.
// D1 calls: 50/invocation on Free, 1,000 on Paid. On Free, D1 can be a co-bottleneck.
// (waiting on Google API + D1), so CPU time (10ms) is not the constraint either.
// Per sync page: 1 external call (Google API fetch). One-time: getRootFolderId (1).
// Completion: getStartPageToken (1) + getQuota (1). Budget 45 leaves margin for
// token refresh (+1) and the one-time calls. Capacity: (45 - 1) / 1 = 44 pages = 4,400 items.
const EXTERNAL_SUBREQUEST_BUDGET = 45;

const SHARED_PARENT_MARKER = '__shared__';

function resolveParentId(parents: string[] | undefined | null, rootFolderId: string, isFolder: boolean): string | null {
  if (!parents || parents.length === 0) {
    return SHARED_PARENT_MARKER;
  }
  const defaultParent = isFolder ? null : 'root';
  const parentId = parents[0];
  return parentId === rootFolderId ? defaultParent : parentId;
}

/** Returns true if the current user is in the file/folder's owners array. */
function isOwnedByMe(owners: GDriveOwner[] | undefined): boolean {
  return owners?.some((o) => o.me === true) ?? false;
}

export const activeSyncs = new Set<string>();

/** Batch-upsert lazy-loaded folder contents (used by drives route).
 * Uses batchInChunks directly since statements are mixed file+folder. */
export async function batchUpsertFolderContents(
  db: D1Database,
  drive: DriveAccount,
  folders: GDriveFolder[],
  files: GDriveFile[],
  googleParentId: string,
): Promise<void> {
  const fileRepo = new FileRepository(db);
  const folderRepo = new FolderRepository(db);
  const stmts: D1PreparedStatement[] = [
    ...folders.map((f) => folderRepo.buildDriveFolderUpsertStmt(drive, f, googleParentId, isOwnedByMe(f.owners))),
    ...files.map((f) => fileRepo.buildUpsertStmt(drive, f, googleParentId, isOwnedByMe(f.owners))),
  ];
  await batchInChunks(db, stmts);
}

/**
 * Sync Google Drive account for a workspace folder background job.
 * workspaceFolderId is the workspace_folders.id (status tracking only); sync runs on driveId.
 */
export async function syncDriveFolder(
  env: Env,
  driveId: string,
  _workspaceFolderId: string,
  userId: string,
): Promise<void> {
  if (activeSyncs.has(driveId)) return;

  activeSyncs.add(driveId);
  try {
    const row = await env.DB.prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
      .bind(driveId, userId)
      .first();
    if (!row) throw new NotFoundError('Drive not found');

    const drive = mapDriveRow(row as Record<string, unknown>);
    const driveService = new GoogleDriveService(
      env.DB,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.TOKEN_ENCRYPTION_KEY,
    );
    await syncDriveAccount(drive, env.DB, driveService);
  } finally {
    activeSyncs.delete(driveId);
  }
}

export async function syncDriveAccount(
  drive: DriveAccount,
  db: D1Database,
  driveService: GoogleDriveService
): Promise<void> {
  await db
    .prepare("INSERT INTO sync_state (drive_account_id, status) VALUES (?, 'syncing') ON CONFLICT(drive_account_id) DO UPDATE SET status = 'syncing', error_message = NULL")
    .bind(drive.id)
    .run();

  try {
    const syncState = await db
      .prepare('SELECT * FROM sync_state WHERE drive_account_id = ?')
      .bind(drive.id)
      .first<{ change_token: string | null; next_page_token: string | null }>();

    let changeToken = syncState?.change_token;
    const nextPageToken = syncState?.next_page_token;

    if (!changeToken) {
      const completed = await performInitialSync(drive, db, driveService, nextPageToken ?? undefined);
      if (!completed) {
        // Paused (subrequest budget hit) or shutting down — next_page_token was already
        // saved per-page by performInitialSync, so the next cron cycle resumes from there.
        // Mark 'idle' (not 'error') so the UI doesn't show a false failure.
        await db
          .prepare("UPDATE sync_state SET status = 'idle' WHERE drive_account_id = ?")
          .bind(drive.id)
          .run();
        return;
      }
      changeToken = await driveService.getStartPageToken(drive.id);
    } else {
      changeToken = await performIncrementalSync(drive, db, changeToken, driveService);
    }

    await db
      .prepare(
        "INSERT INTO sync_state (drive_account_id, status, last_synced_at, change_token, next_page_token) VALUES (?, 'idle', CURRENT_TIMESTAMP, ?, NULL) ON CONFLICT(drive_account_id) DO UPDATE SET status = 'idle', last_synced_at = CURRENT_TIMESTAMP, change_token = excluded.change_token, next_page_token = NULL"
      )
      .bind(drive.id, changeToken)
      .run();

    try {
      await driveService.getQuota(drive.id);
    } catch {
      // Non-fatal
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logErrorNoCtx('Sync failed for drive', undefined, { driveId: drive.id, driveEmail: drive.email, message });

    await db
      .prepare("INSERT INTO sync_state (drive_account_id, status, error_message) VALUES (?, 'error', ?) ON CONFLICT(drive_account_id) DO UPDATE SET status = 'error', error_message = excluded.error_message")
      .bind(drive.id, message)
      .run();
  }
}

async function performInitialSync(
  drive: DriveAccount,
  db: D1Database,
  driveService: GoogleDriveService,
  startPageToken?: string
): Promise<boolean> {
  const rootFolderId = await resolveSyncRootFolderId(drive, () => driveService.getRootFolderId(drive.id));
  const iterator = driveService.iterateAllFilesAndFolders(drive.id, startPageToken);
  // One external call so far: getRootFolderId. D1 calls (sync_state, loadTokens) don't
  // count toward the 50 external limit — they have their own 1,000 limit.
  let externalCount = 1;

  for await (const chunk of iterator) {
    if (getIsShuttingDown()) {
      return false;
    }

    const fileRepo = new FileRepository(db);
    const folderRepo = new FolderRepository(db);
    const stmts: D1PreparedStatement[] = [];
    for (const folder of chunk.folders) {
      const parentId = resolveParentId(folder.parents, rootFolderId, true);
      stmts.push(folderRepo.buildDriveFolderUpsertStmt(drive, folder, parentId, isOwnedByMe(folder.owners)));
    }
    for (const file of chunk.files) {
      const parentId = resolveParentId(file.parents, rootFolderId, false);
      stmts.push(fileRepo.buildUpsertStmt(drive, file, parentId, isOwnedByMe(file.owners)));
    }
    await batchInChunks(db, stmts);

    // Save checkpoint every page — bulletproof crash resilience. D1 has 1,000 subrequest
    // limit, so the extra save per page (44 max) is well within budget.
    if (chunk.nextPageToken) {
      await db
        .prepare('UPDATE sync_state SET next_page_token = ? WHERE drive_account_id = ?')
        .bind(chunk.nextPageToken, drive.id)
        .run();
    }

    // 1 external call per page: Google API fetch for the next page.
    externalCount += 1;

    // Pause before hitting the 50 external subrequest wall. next_page_token is already
    // saved above, so the next cron cycle resumes cleanly. Only pause if there's more
    // work to do (nextPageToken present); otherwise let the loop complete naturally.
    if (externalCount >= EXTERNAL_SUBREQUEST_BUDGET && chunk.nextPageToken) {
      return false;
    }
  }
  return true;
}

async function performIncrementalSync(
  drive: DriveAccount,
  db: D1Database,
  pageToken: string,
  driveService: GoogleDriveService
): Promise<string> {
  const rootFolderId = await resolveSyncRootFolderId(drive, () => driveService.getRootFolderId(drive.id));

  let currentToken = pageToken;
  let hasMore = true;

  while (hasMore) {
    if (getIsShuttingDown()) return currentToken;
    const response = await driveService.listChanges(drive.id, currentToken);

    const stmts: D1PreparedStatement[] = [];
    const fileRepo = new FileRepository(db);
    const folderRepo = new FolderRepository(db);
    for (const change of response.changes) {
      if (getIsShuttingDown()) return currentToken;
      const isFolder = change.file?.mimeType === MIME_TYPE_FOLDER;

      if (change.removed) {
        // Permanently deleted from Google Drive — remove from D1
        if (isFolder) {
          stmts.push(
            db.prepare('DELETE FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
              .bind(drive.id, change.fileId),
          );
        } else {
          stmts.push(
            db.prepare('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?')
              .bind(drive.id, change.fileId),
          );
        }
        continue;
      }

      if (change.file?.trashed) {
        // Moved to Google Drive trash — mark as trashed (recoverable via /trash → restore)
        if (isFolder) {
          stmts.push(
            db.prepare('UPDATE drive_folders SET is_trashed = 1 WHERE drive_account_id = ? AND google_folder_id = ?')
              .bind(drive.id, change.fileId),
          );
        } else {
          stmts.push(
            db.prepare('UPDATE files SET is_trashed = 1 WHERE drive_account_id = ? AND google_file_id = ?')
              .bind(drive.id, change.fileId),
          );
        }
        continue;
      }

      const file = change.file;
      if (!file) continue;
      if (file.mimeType === MIME_TYPE_SHORTCUT) continue;

      if (isFolder) {
        const parentId = resolveParentId(file.parents, rootFolderId, true);
        stmts.push(folderRepo.buildDriveFolderUpsertStmt(drive, { id: file.id, name: file.name, parents: file.parents, owners: file.owners }, parentId, isOwnedByMe(file.owners)));
      } else {
        const parentId = resolveParentId(file.parents, rootFolderId, false);
        stmts.push(fileRepo.buildUpsertStmt(drive, file as unknown as GDriveFile, parentId, isOwnedByMe(file.owners)));
      }
    }
    await batchInChunks(db, stmts);

    if (response.newStartPageToken) {
      return response.newStartPageToken;
    }

    if (response.nextPageToken) {
      currentToken = response.nextPageToken;
    } else {
      hasMore = false;
    }
  }

  return currentToken;
}

export async function runScheduledSync(env: {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
}): Promise<void> {
  if (getIsShuttingDown()) return;

  const driveService = new GoogleDriveService(env.DB, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY);

  const rows = await env.DB.prepare(
    "SELECT * FROM drive_accounts WHERE type IN ('oauth', 'service_account')"
  ).all();
  const driveAccounts = (rows.results ?? []).map(mapDriveRow);

  await Promise.allSettled(
    driveAccounts.map(async (drive) => {
      if (activeSyncs.has(drive.id)) {
        return;
      }

      activeSyncs.add(drive.id);
      try {
        await syncDriveAccount(drive, env.DB, driveService);
      } catch (err) {
        logErrorNoCtx('Sync error for drive', err, { driveId: drive.id, driveEmail: drive.email });
      } finally {
        activeSyncs.delete(drive.id);
      }
    })
  );
}