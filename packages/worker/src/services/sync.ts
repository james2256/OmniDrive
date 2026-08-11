import { NotFoundError } from '../lib/errors';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { DriveAccount } from '../types/domain';
import { mapDriveRow } from '../types/db';
import type { GDriveFile, GDriveFolder, GDriveOwner } from '../types/google';
import type { DriveProvider } from '../types/drive-provider';
import { createDriveService } from '../lib/drive-factory';
import { resolveSyncRootFolderId } from '../lib/drive-folder';
import type { Env } from '../types/env';
import { DriveRepository } from '../repositories/drive.repository';
import { FileRepository } from '../repositories/file.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';
import { batchInChunks } from '../lib/d1-batch';
import { logErrorNoCtx } from '../lib/logger';
import { computeStorageDelta, type FileStateForStats } from '../lib/storage-stats';

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

function resolveParentId(
  parents: string[] | undefined | null,
  rootFolderId: string,
  isFolder: boolean,
): string | null {
  if (!parents || parents.length === 0) {
    return SHARED_PARENT_MARKER;
  }
  const defaultParent = isFolder ? null : 'root';
  const parentId = parents[0];
  return parentId === rootFolderId ? defaultParent : parentId;
}

/**
 * Resolve ownership from a Google Drive owners[] array.
 * - ownedByMe: true if the requesting user is in owners[] (me === true)
 * - ownerEmail: the email of the first non-me owner, or null if the user
 *   owns it themselves or Google didn't return an emailAddress.
 *
 * Per Google's User resource docs, emailAddress may be absent "if the user
 * has not made their email address visible to the requester" — callers must
 * tolerate null (UI falls back to the connected drive's email + 👤 icon).
 */
function resolveOwnership(owners: GDriveOwner[] | undefined): {
  ownedByMe: boolean;
  ownerEmail: string | null;
} {
  if (!owners || owners.length === 0) {
    return { ownedByMe: false, ownerEmail: null };
  }
  const me = owners.find((o) => o.me === true);
  if (me) {
    return { ownedByMe: true, ownerEmail: null };
  }
  // Not owned by me — pick the first non-me owner's email (may be undefined
  // when the owner has hidden their email address from the requester).
  const other = owners[0];
  return { ownedByMe: false, ownerEmail: other?.emailAddress ?? null };
}

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

  // Store ALL files (owned + non-owned). resolveParentId maps the correct
  // location. owned_by_me is set per-file so queries can distinguish.
  const allFileIds = [...files.map((f) => f.id), ...folders.map((f) => f.id)];
  const oldStates = await fileRepo.findExistingForDelta(drive.id, allFileIds);

  // Build folder UPSERTs (no storage delta for folders — only files count).
  const stmts: D1PreparedStatement[] = folders.map((f) => {
    const { ownedByMe, ownerEmail } = resolveOwnership(f.owners);
    return folderRepo.buildDriveFolderUpsertStmt(drive, f, googleParentId, ownedByMe, ownerEmail);
  });

  // Build file UPSERTs + storage deltas in a single pass — resolveOwnership
  // is called once per file (was called twice: once for UPSERT, once for delta).
  const deltas: { userId: string; mimeType: string; delta: number }[] = [];
  for (const file of files) {
    const { ownedByMe, ownerEmail } = resolveOwnership(file.owners);
    stmts.push(fileRepo.buildUpsertStmt(drive, file, googleParentId, ownedByMe, ownerEmail));

    // Storage delta — reuse ownedByMe from the same resolveOwnership call.
    const old = oldStates.get(file.id) ?? null;
    const next: FileStateForStats = {
      size: parseInt(file.size ?? '0', 10),
      mimeType: file.mimeType ?? '',
      isTrashed: false,
      ownedByMe,
    };
    for (const d of computeStorageDelta(old, next)) {
      deltas.push({ userId: drive.userId, mimeType: d.mimeType, delta: d.delta });
    }
  }
  await batchInChunks(db, stmts);
  await fileRepo.applyStorageDeltas(deltas);
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
  const driveRepo = new DriveRepository(env.DB);
  const row = await driveRepo.findFullByIdAndUser(driveId, userId);
  if (!row) throw new NotFoundError('Drive not found');

  const drive = mapDriveRow(row);
  const driveService = createDriveService(env);
  await syncDriveAccount(drive, env.DB, driveService);
}

export async function syncDriveAccount(
  drive: DriveAccount,
  db: D1Database,
  driveService: DriveProvider,
): Promise<boolean> {
  const syncStateRepo = new SyncStateRepository(db);
  // Cross-isolate lock: INSERT if no row, UPDATE only if not already syncing.
  // If RETURNING returns null, another isolate (or direct caller) is syncing.
  const lockAcquired = await syncStateRepo.acquireLock(drive.id);
  if (!lockAcquired) return true; // already syncing — treat as completed

  try {
    const syncState = await syncStateRepo.findSyncState(drive.id);

    let changeToken = syncState?.change_token;
    const nextPageToken = syncState?.next_page_token;

    if (!changeToken) {
      const completed = await performInitialSync(
        drive,
        db,
        driveService,
        nextPageToken ?? undefined,
      );
      if (!completed) {
        // Paused (subrequest budget hit) or shutting down — next_page_token was already
        // saved per-page by performInitialSync, so the next cron cycle resumes from there.
        // Mark 'idle' (not 'error') so the UI doesn't show a false failure.
        await syncStateRepo.setIdle(drive.id);
        return false; // paused — caller (queue consumer) should re-enqueue to resume
      }
      changeToken = await driveService.getStartPageToken(drive.id);
    } else {
      changeToken = await performIncrementalSync(drive, db, changeToken, driveService);
    }

    await syncStateRepo.upsertIdleCompleted(drive.id, changeToken);

    try {
      await driveService.getQuota(drive.id);
    } catch {
      // Non-fatal
    }
    return true; // completed — don't re-enqueue
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logErrorNoCtx('Sync failed for drive', undefined, {
      driveId: drive.id,
      driveEmail: drive.email,
      message,
    });

    await syncStateRepo.upsertError(drive.id, message);
    return true; // error — treat as completed, don't re-enqueue (Queues max_retries handles retries)
  }
}

async function performInitialSync(
  drive: DriveAccount,
  db: D1Database,
  driveService: DriveProvider,
  startPageToken?: string,
): Promise<boolean> {
  const rootFolderId = await resolveSyncRootFolderId(drive, () =>
    driveService.getRootFolderId(drive.id),
  );
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

    // Store ALL files (owned + non-owned) — resolveParentId maps the correct
    // location. owned_by_me is set per-file.
    const allIds = [...chunk.files.map((f) => f.id), ...chunk.folders.map((f) => f.id)];
    const oldStates = await fileRepo.findExistingForDelta(drive.id, allIds);

    for (const folder of chunk.folders) {
      const parentId = resolveParentId(folder.parents, rootFolderId, true);
      const { ownedByMe, ownerEmail } = resolveOwnership(folder.owners);
      stmts.push(
        folderRepo.buildDriveFolderUpsertStmt(drive, folder, parentId, ownedByMe, ownerEmail),
      );
    }
    // Build file UPSERTs + storage deltas in a single pass — resolveOwnership
    // is called once per file (was called twice: once for UPSERT, once for delta).
    const deltas: { userId: string; mimeType: string; delta: number }[] = [];
    for (const file of chunk.files) {
      const parentId = resolveParentId(file.parents, rootFolderId, false);
      const { ownedByMe, ownerEmail } = resolveOwnership(file.owners);
      stmts.push(fileRepo.buildUpsertStmt(drive, file, parentId, ownedByMe, ownerEmail));

      // Storage delta — reuse ownedByMe from the same resolveOwnership call.
      const old = oldStates.get(file.id) ?? null;
      const next: FileStateForStats = {
        size: parseInt(file.size ?? '0', 10),
        mimeType: file.mimeType ?? '',
        isTrashed: false,
        ownedByMe,
      };
      for (const d of computeStorageDelta(old, next)) {
        deltas.push({ userId: drive.userId, mimeType: d.mimeType, delta: d.delta });
      }
    }
    await batchInChunks(db, stmts);
    await fileRepo.applyStorageDeltas(deltas);

    // Save checkpoint every page — bulletproof crash resilience. D1 has 1,000 subrequest
    // limit, so the extra save per page (44 max) is well within budget.
    if (chunk.nextPageToken) {
      await new SyncStateRepository(db).updateNextPageToken(drive.id, chunk.nextPageToken);
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
  driveService: DriveProvider,
): Promise<string> {
  const rootFolderId = await resolveSyncRootFolderId(drive, () =>
    driveService.getRootFolderId(drive.id),
  );
  // One external call so far: getRootFolderId. Track to stay within Free tier.
  let externalCount = 1;

  let currentToken = pageToken;

  while (true) {
    if (getIsShuttingDown()) return currentToken;
    // Pause before hitting the 50-subrequest wall. currentToken is saved by
    // the caller so the next cron cycle resumes from here.
    if (externalCount >= EXTERNAL_SUBREQUEST_BUDGET) {
      return currentToken;
    }

    const response = await driveService.listChanges(drive.id, currentToken);
    externalCount++;

    const stmts: D1PreparedStatement[] = [];
    const driveRepo = new DriveRepository(db);
    const fileRepo = new FileRepository(db);
    const folderRepo = new FolderRepository(db);
    const deltas: { userId: string; mimeType: string; delta: number }[] = [];

    // Read existing file states BEFORE processing changes — needed for delta
    // computation. Fetch all change fileIds (removed, trashed, upserted) since
    // any may have an existing D1 row whose state determines the delta.
    const fileIdsToLookup = response.changes.filter((c) => c.fileId).map((c) => c.fileId);
    const oldStates = await fileRepo.findExistingForDelta(drive.id, fileIdsToLookup);

    for (const change of response.changes) {
      if (getIsShuttingDown()) return currentToken;
      const isFolder = change.file?.mimeType === MIME_TYPE_FOLDER;

      // For delta computation: look up old state (may be null if file is new)
      const oldState = oldStates.get(change.fileId) ?? null;

      if (change.removed) {
        // Permanently deleted from Google Drive — remove from D1
        if (isFolder) {
          stmts.push(driveRepo.deleteDriveFolderStmt(drive.id, change.fileId));
        } else {
          stmts.push(fileRepo.deleteByDriveAndGoogleIdStmt(drive.id, change.fileId));
          // Delta: old state (active or trashed) → deleted
          for (const d of computeStorageDelta(oldState, null)) {
            deltas.push({ userId: drive.userId, mimeType: d.mimeType, delta: d.delta });
          }
        }
        continue;
      }

      const file = change.file;
      if (!file) continue;
      if (file.mimeType === MIME_TYPE_SHORTCUT) continue;

      const { ownedByMe, ownerEmail } = resolveOwnership(file.owners);

      if (file.trashed) {
        // Trashed → mark as trashed (recoverable via /trash → restore)
        if (isFolder) {
          stmts.push(driveRepo.markDriveFolderTrashedStmt(drive.id, change.fileId));
        } else {
          stmts.push(fileRepo.markTrashedByDriveAndGoogleIdStmt(drive.id, change.fileId));
          // Delta: old state → trashed. computeStorageDelta is ownership-aware.
          const newState: FileStateForStats = {
            size: parseInt(file.size ?? '0', 10),
            mimeType: file.mimeType ?? '',
            isTrashed: true,
            ownedByMe,
          };
          for (const d of computeStorageDelta(oldState, newState)) {
            deltas.push({ userId: drive.userId, mimeType: d.mimeType, delta: d.delta });
          }
        }
        continue;
      }

      // Not trashed → upsert (owned + non-owned). computeStorageDelta handles
      // ownership transitions (both directions) internally.
      if (isFolder) {
        const parentId = resolveParentId(file.parents, rootFolderId, true);
        stmts.push(
          folderRepo.buildDriveFolderUpsertStmt(
            drive,
            { id: file.id, name: file.name, parents: file.parents, owners: file.owners },
            parentId,
            ownedByMe,
            ownerEmail,
          ),
        );
      } else {
        const parentId = resolveParentId(file.parents, rootFolderId, false);
        stmts.push(fileRepo.buildUpsertStmt(drive, file, parentId, ownedByMe, ownerEmail));
        // Delta: old state → active. computeStorageDelta is ownership-aware.
        const newState: FileStateForStats = {
          size: parseInt(file.size ?? '0', 10),
          mimeType: file.mimeType ?? '',
          isTrashed: false,
          ownedByMe,
        };
        for (const d of computeStorageDelta(oldState, newState)) {
          deltas.push({ userId: drive.userId, mimeType: d.mimeType, delta: d.delta });
        }
      }
    }
    await batchInChunks(db, stmts);
    await fileRepo.applyStorageDeltas(deltas);

    if (response.newStartPageToken) {
      return response.newStartPageToken;
    }

    if (response.nextPageToken) {
      currentToken = response.nextPageToken;
    } else {
      // Google API anomaly — neither newStartPageToken nor nextPageToken returned.
      // Returning '' (falsy) makes syncDriveAccount save change_token='' via
      // upsertIdleCompleted. The next sync cycle sees !changeToken → runs
      // performInitialSync (full re-fetch). Self-heals without error state.
      logErrorNoCtx(
        'Google Drive API anomaly — no tokens returned, forcing full re-sync on next cycle',
        undefined,
        {
          driveId: drive.id,
          driveEmail: drive.email,
        },
      );
      return '';
    }
  }
}

export async function runScheduledSync(env: {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
}): Promise<void> {
  if (getIsShuttingDown()) return;

  const driveService = createDriveService(env);

  const driveRepo = new DriveRepository(env.DB);
  const { results: driveRows } = await driveRepo.findAllByType(['oauth', 'service_account']);
  const driveAccounts = (driveRows ?? []).map(mapDriveRow);

  for (const drive of driveAccounts) {
    if (getIsShuttingDown()) break;
    try {
      await syncDriveAccount(drive, env.DB, driveService);
    } catch (err) {
      logErrorNoCtx('Sync error for drive', err, { driveId: drive.id, driveEmail: drive.email });
    }
  }
}
