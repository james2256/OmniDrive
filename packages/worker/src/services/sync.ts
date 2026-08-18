import { NotFoundError } from '../lib/errors';
import type { D1Database } from '@cloudflare/workers-types';
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
import { batchUpsertUnitsWithCheckpoint, type BatchUnit } from '../lib/d1-batch';
import { D1_MAX_BIND_VARIABLES } from '../lib/d1-constants';
import { logErrorNoCtx, logNoCtx } from '../lib/logger';
import { computeStorageDelta, type FileStateForStats } from '../lib/storage-stats';

/**
 * Graceful shutdown flag — set by the Node.js self-host server (node-server.ts)
 * on SIGTERM/SIGINT. Checked per page during sync to stop processing early.
 *
 * LIMITATION: This does NOT work on Cloudflare Workers — there is no signal
 * handler in the Workers runtime. When a Worker is killed (CPU limit, deploy,
 * OOM), the flag stays false and the sync is interrupted mid-page without
 * cleanup. The 5-minute stale-lock timeout (acquireLock) is the fallback.
 */
let isShuttingDown = false;

export function getIsShuttingDown() {
  return isShuttingDown;
}

export function setShuttingDown(): void {
  isShuttingDown = true;
}

const MIME_TYPE_FOLDER = 'application/vnd.google-apps.folder';
const MIME_TYPE_SHORTCUT = 'application/vnd.google-apps.shortcut';

// Workers Free has TWO separate subrequest pools (verified Feb 2026 changelog
// — https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit):
//   - External (fetch to Google API): 50/invocation
//   - Internal (D1/KV/R2):           1,000/invocation
// db.batch([N stmts]) counts as 1 internal subrequest regardless of N.
// Per sync page (Google pageSize=1000, initial sync worst case — 1000 files/page):
//   External: 1 (Google API fetch for next page)
//   Internal: 1 heartbeat + 11 findExistingForDelta + 10 batchUpsertUnits = 22
// For incremental sync with sparse changes (e.g., 5 changes), internal cost
// is ~3/page (1 heartbeat + 1 lookup + 0-1 batch). External is always the
// binding constraint regardless of sync type.
// Pre-loop overhead: 0-1 external (getRootFolderId only for OAuth — service
//   accounts with stored rootFolderId skip it) + 2 internal (acquireLock,
//   findSyncState in syncDriveAccount).
// Budgets leave margin under both walls:
//   EXTERNAL_BUDGET=45 → pauses at page 44 (1 + 44 = 45 ≥ 45, 5 under 50)
//   INTERNAL_BUDGET=990 → would pause at page 45 (2 + 22×45 = 992 ≥ 990)
// External is the binding constraint (hits first) → ~44 pages/invocation = 44K files.
const EXTERNAL_SUBREQUEST_BUDGET = 45;
const INTERNAL_SUBREQUEST_BUDGET = 990;

// NOTE: The D1 platform limits page (developers.cloudflare.com/d1/platform/limits)
// is STALE — it still shows "Queries per Worker invocation: 50 (Free)" from the
// pre-Feb-2026 single-pool model. The authoritative source is the Workers limits
// page (developers.cloudflare.com/workers/platform/limits) which documents the
// two-pool model: 50 external + 1000 internal on Free. Do NOT reduce the budget
// based on the D1 docs alone — you'd re-introduce the single-pool regression.

/**
 * Number of internal subrequests findExistingForDelta will consume for N IDs.
 * Each D1 `.all()` call binds ≤ 99 IDs + 1 driveAccountId (D1's 100-bind limit).
 * Ceil(N/99) calls → ceil(N/99) internal subrequests.
 */
function findExistingForDeltaSubrequestCount(idCount: number): number {
  if (idCount === 0) return 0;
  return Math.ceil(idCount / (D1_MAX_BIND_VARIABLES - 1));
}

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
 *
 * Service accounts (shared Drives) don't have owners[] populated at all
 * (Google API: "This field isn't populated for items in shared drives").
 * The service account has full access to the shared Drive — treat as owned
 * so storage stats + S3 lifecycle + retention policies include them.
 */
function resolveOwnership(
  owners: GDriveOwner[] | undefined,
  isServiceAccount: boolean = false,
): {
  ownedByMe: boolean;
  ownerEmail: string | null;
} {
  if (isServiceAccount) {
    return { ownedByMe: true, ownerEmail: null };
  }
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

/**
 * Batch-upsert lazy-loaded folder contents (used by drives route — drill-in).
 *
 * Per-file unit grouping: each file's UPSERT + its storage deltas commit in
 * the same db.batch() chunk, matching performInitialSync's atomicity
 * guarantee. No checkpoint — this is a single user-initiated load, not a
 * paginated sync, so there is no cursor to advance.
 */
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

  const units: BatchUnit[] = [];

  // Folder UPSERTs — no storage delta (folders don't count toward quota).
  for (const folder of folders) {
    const { ownedByMe, ownerEmail } = resolveOwnership(
      folder.owners,
      drive.type === 'service_account',
    );
    units.push({
      stmt: folderRepo.buildDriveFolderUpsertStmt(
        drive,
        folder,
        googleParentId,
        ownedByMe,
        ownerEmail,
      ),
      deltas: [],
    });
  }

  // File UPSERTs + storage deltas — each file's UPSERT and its deltas are
  // grouped in the same BatchUnit so they commit atomically in the same
  // db.batch() chunk. resolveOwnership is called once per file.
  for (const file of files) {
    const { ownedByMe, ownerEmail } = resolveOwnership(
      file.owners,
      drive.type === 'service_account',
    );
    const old = oldStates.get(file.id) ?? null;
    const next: FileStateForStats = {
      size: parseInt(file.size ?? '0', 10),
      mimeType: file.mimeType ?? '',
      isTrashed: false,
      ownedByMe,
    };
    const deltaStmts = computeStorageDelta(old, next)
      .filter((d) => d.delta !== 0)
      .map((d) => fileRepo.applyStorageDeltaStmt(drive.userId, d.mimeType, d.delta));
    units.push({
      stmt: fileRepo.buildUpsertStmt(drive, file, googleParentId, ownedByMe, ownerEmail),
      deltas: deltaStmts,
    });
  }

  // Atomic batch: UPSERTs + deltas in a single db.batch() per chunk.
  // No checkpoint (lazy load is single-shot, not paginated).
  await batchUpsertUnitsWithCheckpoint(db, units, null);
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
  const wallStart = Date.now();
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
        logNoCtx('info', 'Sync invocation paused (budget hit)', {
          driveId: drive.id,
          wallTimeMs: Date.now() - wallStart,
        });
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
    logNoCtx('info', 'Sync invocation completed', {
      driveId: drive.id,
      wallTimeMs: Date.now() - wallStart,
    });
    return true; // completed — don't re-enqueue
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logErrorNoCtx('Sync failed for drive', undefined, {
      driveId: drive.id,
      driveEmail: drive.email,
      message,
      wallTimeMs: Date.now() - wallStart,
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
  // Two subrequest pools on Workers Free (verified Feb 2026 changelog):
  //   external: fetch() to Google API — 50/invocation
  //   internal: D1/KV/R2 calls — 1,000/invocation (db.batch counts as 1)
  // Pre-loop: 0-1 external (getRootFolderId only for OAuth — service accounts
  //   with stored rootFolderId skip it) + 2 internal (acquireLock, findSyncState).
  //   Mirrors resolveSyncRootFolderId's condition exactly.
  let externalCount = drive.type === 'service_account' && drive.rootFolderId ? 0 : 1;
  let internalCount = 2;

  // Repositories are stateless — instantiate once before the loop, not per page.
  const syncStateRepo = new SyncStateRepository(db);
  const fileRepo = new FileRepository(db);
  const folderRepo = new FolderRepository(db);

  for await (const chunk of iterator) {
    if (getIsShuttingDown()) {
      return false;
    }
    // Heartbeat — refresh locked_at so acquireLock's stale check sees a live sync.
    await syncStateRepo.heartbeat(drive.id);
    internalCount += 1;

    const units: BatchUnit[] = [];

    // Store ALL files (owned + non-owned) — resolveParentId maps the correct
    // location. owned_by_me is set per-file.
    const allIds = [...chunk.files.map((f) => f.id), ...chunk.folders.map((f) => f.id)];
    const oldStates = await fileRepo.findExistingForDelta(drive.id, allIds);
    internalCount += findExistingForDeltaSubrequestCount(allIds.length);

    for (const folder of chunk.folders) {
      const parentId = resolveParentId(folder.parents, rootFolderId, true);
      const { ownedByMe, ownerEmail } = resolveOwnership(
        folder.owners,
        drive.type === 'service_account',
      );
      units.push({
        stmt: folderRepo.buildDriveFolderUpsertStmt(drive, folder, parentId, ownedByMe, ownerEmail),
        deltas: [],
      });
    }
    // Build file UPSERT units + storage deltas in a single pass — each file's
    // UPSERT and its deltas are grouped in the same BatchUnit so they commit
    // atomically in the same db.batch() chunk. This prevents permanent
    // file_storage_stats drift if the Worker is killed mid-page.
    for (const file of chunk.files) {
      const parentId = resolveParentId(file.parents, rootFolderId, false);
      const { ownedByMe, ownerEmail } = resolveOwnership(
        file.owners,
        drive.type === 'service_account',
      );
      const stmt = fileRepo.buildUpsertStmt(drive, file, parentId, ownedByMe, ownerEmail);

      // Storage delta — reuse ownedByMe from the same resolveOwnership call.
      const old = oldStates.get(file.id) ?? null;
      const next: FileStateForStats = {
        size: parseInt(file.size ?? '0', 10),
        mimeType: file.mimeType ?? '',
        isTrashed: false,
        ownedByMe,
      };
      const deltaStmts = computeStorageDelta(old, next)
        .filter((d) => d.delta !== 0)
        .map((d) => fileRepo.applyStorageDeltaStmt(drive.userId, d.mimeType, d.delta));

      units.push({ stmt, deltas: deltaStmts });
    }

    // Atomic batch: UPSERTs + deltas + checkpoint in a single db.batch()
    // per chunk. Each file's UPSERT + its deltas commit together. The
    // checkpoint goes in the last chunk so the cursor only advances if
    // all writes in the last chunk succeed.
    const checkpointStmt = chunk.nextPageToken
      ? db
          .prepare('UPDATE sync_state SET next_page_token = ? WHERE drive_account_id = ?')
          .bind(chunk.nextPageToken, drive.id)
      : null;
    const d1Subrequests = await batchUpsertUnitsWithCheckpoint(db, units, checkpointStmt);
    internalCount += d1Subrequests;

    // 1 external call per page: Google API fetch that produced this chunk
    // (via the for-await iterator's implicit .next()).
    externalCount += 1;

    // Pause before hitting EITHER subrequest wall. next_page_token is already
    // saved above, so the next cron cycle resumes cleanly. Only pause if there's
    // more work to do (nextPageToken present); otherwise let the loop complete.
    if (
      (externalCount >= EXTERNAL_SUBREQUEST_BUDGET ||
        internalCount >= INTERNAL_SUBREQUEST_BUDGET) &&
      chunk.nextPageToken
    ) {
      return false;
    }
  }
  return true;
}

/** Context object for applyChange — avoids a 7-param function signature. */
export interface ApplyChangeContext {
  drive: DriveAccount;
  rootFolderId: string;
  fileRepo: FileRepository;
  folderRepo: FolderRepository;
  driveRepo: DriveRepository;
}

/** Return type: BatchUnits to commit + optional newState for oldStates update (C11 fix). */
export interface ApplyChangeResult {
  units: BatchUnit[];
  /** The new file state after this change, or null if the file was removed or is a folder. */
  newState: FileStateForStats | null;
}

/**
 * Process a single Google Drive change and return BatchUnits for atomic
 * batched writes. Returns null if the change should be skipped (no file
 * metadata or shortcut type).
 *
 * Pure function — builds prepared statements but does not execute them.
 * The caller batches all units from a page into a single db.batch().
 *
 * Returns `newState` so the caller can update its `oldStates` map within
 * the same page (fixes C11: within-page oldState staleness that caused
 * quota drift when Google returned multiple changes for the same fileId
 * in one page).
 */
export function applyChange(
  change: { fileId: string; removed: boolean; file?: GDriveFile },
  oldState: FileStateForStats | null,
  ctx: ApplyChangeContext,
): ApplyChangeResult | null {
  const { drive, rootFolderId, fileRepo, folderRepo, driveRepo } = ctx;

  // ─── 1. Removed: deleted or access lost (unshared) → delete from D1 + delta ───
  if (change.removed) {
    // Google omits `file` when removed=true, so isFolder is unreliable here.
    // Push BOTH deletes — one is always a 0-row no-op (idempotent). The delta
    // only fires for files (oldState is null for folders — findExistingForDelta
    // queries the files table only).
    const deltaStmts = computeStorageDelta(oldState, null)
      .filter((d) => d.delta !== 0)
      .map((d) => fileRepo.applyStorageDeltaStmt(drive.userId, d.mimeType, d.delta));
    return {
      units: [
        { stmt: driveRepo.deleteDriveFolderStmt(drive.id, change.fileId), deltas: [] },
        {
          stmt: fileRepo.deleteByDriveAndGoogleIdStmt(drive.id, change.fileId),
          deltas: deltaStmts,
        },
      ],
      newState: null,
    };
  }

  // ─── 2. Skip: no file metadata (anomaly) or shortcut ───
  const file = change.file;
  if (!file) return null;
  if (file.mimeType === MIME_TYPE_SHORTCUT) return null;

  const isFolder = file.mimeType === MIME_TYPE_FOLDER;
  const { ownedByMe, ownerEmail } = resolveOwnership(file.owners, drive.type === 'service_account');

  // ─── 3. Trashed: mark as trashed (recoverable via /trash → restore) + delta ───
  if (file.trashed) {
    if (isFolder) {
      return {
        units: [
          { stmt: driveRepo.markDriveFolderTrashedStmt(drive.id, change.fileId), deltas: [] },
        ],
        newState: null,
      };
    }
    const newState: FileStateForStats = {
      size: parseInt(file.size ?? '0', 10),
      mimeType: file.mimeType ?? '',
      isTrashed: true,
      ownedByMe,
    };
    const deltaStmts = computeStorageDelta(oldState, newState)
      .filter((d) => d.delta !== 0)
      .map((d) => fileRepo.applyStorageDeltaStmt(drive.userId, d.mimeType, d.delta));
    return {
      units: [
        {
          stmt: fileRepo.markTrashedByDriveAndGoogleIdStmt(drive.id, change.fileId),
          deltas: deltaStmts,
        },
      ],
      newState,
    };
  }

  // ─── 4. Active: upsert (owned + non-owned) + delta ───
  if (isFolder) {
    const parentId = resolveParentId(file.parents, rootFolderId, true);
    return {
      units: [
        {
          stmt: folderRepo.buildDriveFolderUpsertStmt(
            drive,
            {
              id: file.id,
              name: file.name,
              parents: file.parents,
              owners: file.owners,
              starred: file.starred,
            },
            parentId,
            ownedByMe,
            ownerEmail,
          ),
          deltas: [],
        },
      ],
      newState: null,
    };
  }

  const parentId = resolveParentId(file.parents, rootFolderId, false);
  const newState: FileStateForStats = {
    size: parseInt(file.size ?? '0', 10),
    mimeType: file.mimeType ?? '',
    isTrashed: false,
    ownedByMe,
  };
  const deltaStmts = computeStorageDelta(oldState, newState)
    .filter((d) => d.delta !== 0)
    .map((d) => fileRepo.applyStorageDeltaStmt(drive.userId, d.mimeType, d.delta));
  return {
    units: [
      {
        stmt: fileRepo.buildUpsertStmt(drive, file, parentId, ownedByMe, ownerEmail),
        deltas: deltaStmts,
      },
    ],
    newState,
  };
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
  // Two subrequest pools on Workers Free (verified Feb 2026 changelog):
  //   external: fetch() to Google API — 50/invocation
  //   internal: D1/KV/R2 calls — 1,000/invocation (db.batch counts as 1)
  // Pre-loop: 0-1 external (getRootFolderId only for OAuth — service accounts
  //   with stored rootFolderId skip it) + 2 internal (acquireLock, findSyncState).
  //   Mirrors resolveSyncRootFolderId's condition exactly.
  let externalCount = drive.type === 'service_account' && drive.rootFolderId ? 0 : 1;
  let internalCount = 2;

  let currentToken = pageToken;

  // Repositories are stateless — instantiate once before the loop, not per page.
  const syncStateRepo = new SyncStateRepository(db);
  const driveRepo = new DriveRepository(db);
  const fileRepo = new FileRepository(db);
  const folderRepo = new FolderRepository(db);

  while (true) {
    if (getIsShuttingDown()) return currentToken;
    // Heartbeat — refresh locked_at so acquireLock's stale check sees a live sync.
    await syncStateRepo.heartbeat(drive.id);
    internalCount += 1;
    // Pause before hitting EITHER subrequest wall. currentToken is saved by
    // the caller so the next cron cycle resumes from here.
    if (
      externalCount >= EXTERNAL_SUBREQUEST_BUDGET ||
      internalCount >= INTERNAL_SUBREQUEST_BUDGET
    ) {
      return currentToken;
    }

    const response = await driveService.listChanges(drive.id, currentToken);
    externalCount++;

    const units: BatchUnit[] = [];

    // Read existing file states BEFORE processing changes — needed for delta
    // computation. Fetch all change fileIds (removed, trashed, upserted) since
    // any may have an existing D1 row whose state determines the delta.
    const fileIdsToLookup = response.changes.filter((c) => c.fileId).map((c) => c.fileId);
    const oldStates = await fileRepo.findExistingForDelta(drive.id, fileIdsToLookup);
    internalCount += findExistingForDeltaSubrequestCount(fileIdsToLookup.length);

    const ctx: ApplyChangeContext = { drive, rootFolderId, fileRepo, folderRepo, driveRepo };

    for (const change of response.changes) {
      if (getIsShuttingDown()) return currentToken;
      const oldState = oldStates.get(change.fileId) ?? null;
      const result = applyChange(change, oldState, ctx);
      if (result) {
        units.push(...result.units);
        // C11 fix: update oldStates within the same page so that if Google
        // returns multiple changes for the same fileId, subsequent changes
        // compute deltas against the fresh state (not the stale pre-page state).
        if (result.newState) {
          oldStates.set(change.fileId, result.newState);
        }
      }
    }
    // Atomic batch: UPSERTs/deletes + deltas in a single db.batch() per chunk.
    // No checkpoint for incremental sync (changeToken is returned, not saved per-page).
    const d1Subrequests = await batchUpsertUnitsWithCheckpoint(db, units, null);
    internalCount += d1Subrequests;

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
