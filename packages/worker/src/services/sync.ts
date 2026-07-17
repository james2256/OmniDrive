let isShuttingDown = false;

export function getIsShuttingDown() {
  return isShuttingDown;
}

export function setShuttingDown(): void {
  isShuttingDown = true;
}

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { DriveAccount } from '../types/index';
import { mapDriveRow } from '../types/index';
import { GoogleDriveService, type GDriveFile, type GDriveFolder, type GDriveOwner } from './google-drive';
import { generateId } from '../lib/id';
import { resolveSyncRootFolderId } from '../lib/drive-folder';
import type { Env } from '../types/env';

const MIME_TYPE_FOLDER = 'application/vnd.google-apps.folder';
const MIME_TYPE_SHORTCUT = 'application/vnd.google-apps.shortcut';

// ponytail: per Cloudflare D1 docs — batch() cuts round-trips; chunk to stay under statement limits
const D1_BATCH_SIZE = 100;

// Workers Free plan caps each invocation at 50 subrequests (fetch + D1 calls).
// Per sync page burns 3 subrequests: 1 Google API fetch + 1 D1 batch write + 1 D1
// next_page_token save. One-time overhead is 4 (sync_state read+write, getRootFolderId,
// first loadTokens). Final write is 1 (pause) or 3 (completion: getStartPageToken +
// idle write + getQuota). Budget 43 pauses after 13 pages (44 subreq, margin 6) and
// leaves room for a mid-sync token refresh (+2) without crashing. See sync plan docs.
const SUBREQUEST_BUDGET = 43;

const UPSERT_FOLDER_SQL = `INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, is_synced, owned_by_me)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(drive_account_id, google_folder_id) DO UPDATE SET
         name = excluded.name,
         google_parent_id = excluded.google_parent_id,
         owned_by_me = excluded.owned_by_me`;

const UPSERT_FILE_SQL = `INSERT INTO files
         (id, user_id, drive_account_id, google_file_id, google_parent_id, name, mime_type, size,
          thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at, synced_at, owned_by_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(drive_account_id, google_file_id) DO UPDATE SET
         name = excluded.name,
         mime_type = excluded.mime_type,
         size = excluded.size,
         thumbnail_url = excluded.thumbnail_url,
         web_view_link = excluded.web_view_link,
         web_content_link = excluded.web_content_link,
         google_modified_at = excluded.google_modified_at,
         google_parent_id = excluded.google_parent_id,
         synced_at = excluded.synced_at,
         owned_by_me = excluded.owned_by_me`;

function resolveParentId(parents: string[] | undefined | null, rootFolderId: string, isFolder: boolean): string | null {
  const defaultParent = isFolder ? null : 'root';
  const parentId = parents?.[0] ?? defaultParent;
  return parentId === rootFolderId ? defaultParent : parentId;
}

/** Returns true if the current user is in the file/folder's owners array. */
function isOwnedByMe(owners: GDriveOwner[] | undefined): boolean {
  return owners?.some((o) => o.me === true) ?? false;
}

export const activeSyncs = new Set<string>();

export async function runD1Batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += D1_BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + D1_BATCH_SIZE));
  }
}

function buildUpsertFolderStmt(
  db: D1Database,
  drive: DriveAccount,
  folder: GDriveFolder,
  googleParentId: string | null,
  ownedByMe: boolean,
): D1PreparedStatement {
  return db.prepare(UPSERT_FOLDER_SQL).bind(generateId(), drive.id, folder.id, googleParentId, folder.name, ownedByMe ? 1 : 0);
}

function buildUpsertFileStmt(
  db: D1Database,
  drive: DriveAccount,
  file: GDriveFile,
  googleParentId: string | null,
  ownedByMe: boolean,
): D1PreparedStatement {
  return db.prepare(UPSERT_FILE_SQL).bind(
    generateId(),
    drive.userId,
    drive.id,
    file.id,
    googleParentId,
    file.name,
    file.mimeType,
    parseInt(file.size ?? '0', 10),
    file.thumbnailLink ?? null,
    file.webViewLink ?? null,
    file.webContentLink ?? null,
    file.createdTime,
    file.modifiedTime,
    ownedByMe ? 1 : 0,
  );
}

/** Batch-upsert lazy-loaded folder contents (used by drives route). */
export async function batchUpsertFolderContents(
  db: D1Database,
  drive: DriveAccount,
  folders: GDriveFolder[],
  files: GDriveFile[],
  googleParentId: string,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    ...folders.map((f) => buildUpsertFolderStmt(db, drive, f, googleParentId, isOwnedByMe(f.owners))),
    ...files.map((f) => buildUpsertFileStmt(db, drive, f, googleParentId, isOwnedByMe(f.owners))),
  ];
  await runD1Batch(db, stmts);
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
    if (!row) throw new Error('Drive not found');

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
    console.error(`Sync failed for ${drive.email}:`, message);

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
  // One-time overhead: sync_state read+write (2) + getRootFolderId fetch (1) + first
  // loadTokens D1 read (1, cache miss on first call). Subsequent pages skip loadTokens
  // thanks to the in-memory token cache in GoogleDriveService.
  let subrequestCount = 4;
  // Save the checkpoint every 5 pages (or before pausing) to cut D1 writes ~60%.
  // A crash loses at most 5 pages of progress (500 items to re-sync on next cron).
  let pagesProcessed = 0;

  for await (const chunk of iterator) {
    if (getIsShuttingDown()) {
      return false;
    }

    const stmts: D1PreparedStatement[] = [];
    for (const folder of chunk.folders) {
      const parentId = resolveParentId(folder.parents, rootFolderId, true);
      stmts.push(buildUpsertFolderStmt(db, drive, folder, parentId, isOwnedByMe(folder.owners)));
    }
    for (const file of chunk.files) {
      const parentId = resolveParentId(file.parents, rootFolderId, false);
      stmts.push(buildUpsertFileStmt(db, drive, file, parentId, isOwnedByMe(file.owners)));
    }
    await runD1Batch(db, stmts);
    // 2 subrequests per page: Google API fetch + D1 batch write.
    subrequestCount += 2;

    // Save checkpoint every 5 pages, or before pausing so next_page_token is always
    // preserved when we stop. Count the save subrequest only when it actually runs.
    const shouldSave = !!chunk.nextPageToken && (pagesProcessed % 5 === 0 || subrequestCount + 2 >= SUBREQUEST_BUDGET);
    if (shouldSave) {
      await db
        .prepare('UPDATE sync_state SET next_page_token = ? WHERE drive_account_id = ?')
        .bind(chunk.nextPageToken, drive.id)
        .run();
      subrequestCount += 1;
    }
    pagesProcessed++;

    // Pause before hitting the Workers 50-subrequest wall. next_page_token is already
    // saved above (if this was a save page) or on the most recent save page. Only
    // pause if there's more work to do (nextPageToken present); otherwise let the
    // loop complete naturally.
    if (subrequestCount >= SUBREQUEST_BUDGET && chunk.nextPageToken) {
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
    for (const change of response.changes) {
      if (getIsShuttingDown()) return currentToken;
      const isFolder = change.file?.mimeType === MIME_TYPE_FOLDER;

      if (change.removed || change.file?.trashed) {
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

      const file = change.file;
      if (!file) continue;
      if (file.mimeType === MIME_TYPE_SHORTCUT) continue;

      if (isFolder) {
        const parentId = resolveParentId(file.parents, rootFolderId, true);
        stmts.push(buildUpsertFolderStmt(db, drive, { id: file.id, name: file.name, parents: file.parents, owners: file.owners }, parentId, isOwnedByMe(file.owners)));
      } else {
        const parentId = resolveParentId(file.parents, rootFolderId, false);
        stmts.push(buildUpsertFileStmt(db, drive, file as unknown as GDriveFile, parentId, isOwnedByMe(file.owners)));
      }
    }
    await runD1Batch(db, stmts);

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

  const rows = await env.DB.prepare("SELECT * FROM drive_accounts WHERE type = 'oauth'").all();
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
        console.error(`Sync error for ${drive.email}:`, err);
      } finally {
        activeSyncs.delete(drive.id);
      }
    })
  );
}