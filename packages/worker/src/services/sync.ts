import type { DriveAccount } from '../types/index';
import { mapDriveRow } from '../types/index';
import { GoogleDriveService } from './google-drive';
import { generateId } from '../lib/id';

export async function syncDriveAccount(
  drive: DriveAccount,
  db: D1Database,
  kv: KVNamespace,
  driveService: GoogleDriveService
): Promise<void> {
  // Skip drives without root folder
  if (!drive.rootFolderId) {
    console.log(`Skipping sync for ${drive.email}: no root folder`);
    return;
  }

  // Update status to syncing
  await db
    .prepare("UPDATE sync_state SET status = 'syncing', error_message = NULL WHERE drive_account_id = ?")
    .bind(drive.id)
    .run();

  try {
    // Get sync state
    const syncState = await db
      .prepare('SELECT * FROM sync_state WHERE drive_account_id = ?')
      .bind(drive.id)
      .first();

    let changeToken = syncState?.change_token as string | null;

    // If no change token, do initial sync
    if (!changeToken) {
      await performInitialSync(drive, db, driveService);
      changeToken = await driveService.getStartPageToken(drive.id);
    } else {
      // Incremental sync via Changes API
      await performIncrementalSync(drive, db, changeToken, driveService);
      // Get the latest token after processing all changes
      changeToken = await getLatestChangeToken(drive, changeToken, driveService);
    }

    // Update sync state
    await db
      .prepare(
        "UPDATE sync_state SET change_token = ?, last_synced_at = datetime('now'), status = 'idle' WHERE drive_account_id = ?"
      )
      .bind(changeToken, drive.id)
      .run();

    // Refresh quota cache
    try {
      await driveService.getQuota(drive.id);
    } catch {
      // Non-fatal: quota refresh can fail
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Sync failed for ${drive.email}:`, message);

    await db
      .prepare("UPDATE sync_state SET status = 'error', error_message = ? WHERE drive_account_id = ?")
      .bind(message, drive.id)
      .run();
  }
}

async function performInitialSync(
  drive: DriveAccount,
  db: D1Database,
  driveService: GoogleDriveService
): Promise<void> {
  console.log(`Initial sync for ${drive.email}`);

  const files = await driveService.listFilesInFolder(drive.id, drive.rootFolderId!);

  for (const file of files) {
    // Skip folders
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;

    await upsertFile(db, drive, {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      thumbnailLink: file.thumbnailLink,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
    });
  }
}

async function performIncrementalSync(
  drive: DriveAccount,
  db: D1Database,
  pageToken: string,
  driveService: GoogleDriveService
): Promise<void> {
  console.log(`Incremental sync for ${drive.email} from token ${pageToken}`);

  let currentToken = pageToken;
  let hasMore = true;

  while (hasMore) {
    const response = await driveService.listChanges(drive.id, currentToken);

    for (const change of response.changes) {
      // File removed entirely
      if (change.removed) {
        await db
          .prepare('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?')
          .bind(drive.id, change.fileId)
          .run();
        continue;
      }

      const file = change.file;
      if (!file) continue;

      // Skip folders
      if (file.mimeType === 'application/vnd.google-apps.folder') continue;

      // File trashed or not in Omnidrive folder
      if (file.trashed || !file.parents?.includes(drive.rootFolderId!)) {
        await db
          .prepare('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?')
          .bind(drive.id, change.fileId)
          .run();
        continue;
      }

      // File created or modified within Omnidrive folder
      await upsertFile(db, drive, {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        thumbnailLink: file.thumbnailLink,
        webViewLink: file.webViewLink,
        webContentLink: file.webContentLink,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
      });
    }

    if (response.nextPageToken) {
      currentToken = response.nextPageToken;
    } else {
      hasMore = false;
    }
  }
}

async function getLatestChangeToken(
  drive: DriveAccount,
  startToken: string,
  driveService: GoogleDriveService
): Promise<string> {
  let currentToken = startToken;
  let hasMore = true;

  while (hasMore) {
    const response = await driveService.listChanges(drive.id, currentToken);
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

async function upsertFile(
  db: D1Database,
  drive: DriveAccount,
  file: {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    thumbnailLink?: string;
    webViewLink?: string;
    webContentLink?: string;
    createdTime: string;
    modifiedTime: string;
  }
): Promise<void> {
  const existing = await db
    .prepare('SELECT id, virtual_folder_id FROM files WHERE drive_account_id = ? AND google_file_id = ?')
    .bind(drive.id, file.id)
    .first();

  if (existing) {
    // Update existing file metadata, preserve virtual_folder_id
    await db
      .prepare(
        `UPDATE files SET name = ?, mime_type = ?, size = ?, thumbnail_url = ?, web_view_link = ?, web_content_link = ?, google_modified_at = ?, synced_at = datetime('now')
         WHERE id = ?`
      )
      .bind(
        file.name,
        file.mimeType,
        parseInt(file.size ?? '0', 10),
        file.thumbnailLink ?? null,
        file.webViewLink ?? null,
        file.webContentLink ?? null,
        file.modifiedTime,
        existing.id as string
      )
      .run();
  } else {
    // Insert new file
    const fileId = generateId();
    await db
      .prepare(
        `INSERT INTO files (id, user_id, drive_account_id, google_file_id, name, mime_type, size, thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        fileId,
        drive.userId,
        drive.id,
        file.id,
        file.name,
        file.mimeType,
        parseInt(file.size ?? '0', 10),
        file.thumbnailLink ?? null,
        file.webViewLink ?? null,
        file.webContentLink ?? null,
        file.createdTime,
        file.modifiedTime
      )
      .run();
  }
}

export async function runScheduledSync(env: { DB: D1Database; KV: KVNamespace; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string }): Promise<void> {
  const driveService = new GoogleDriveService(env.KV, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);

  // Get all drive accounts
  const rows = await env.DB.prepare("SELECT * FROM drive_accounts WHERE type = 'oauth'").all();
  const driveAccounts = (rows.results ?? []).map(mapDriveRow);

  console.log(`Syncing ${driveAccounts.length} drive accounts`);

  for (const drive of driveAccounts) {
    try {
      await syncDriveAccount(drive, env.DB, env.KV, driveService);
    } catch (err) {
      console.error(`Sync error for ${drive.email}:`, err);
    }
  }
}
