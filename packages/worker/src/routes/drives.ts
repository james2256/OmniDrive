import { Hono } from 'hono';
import { AppError, ConflictError, ValidationError } from '../lib/errors';
import type { AppContext } from '../types/context';
import { authGuard } from '../middleware/auth-guard';
import { createDriveService } from '../lib/drive-factory';
import { DriveRepository } from '../repositories/drive.repository';
import { syncDriveAccount, batchUpsertFolderContents } from '../services/sync';
import { mapDriveRow, mapDriveFolderRow, mapFileRow } from '../types/db';
import type { FileEntry } from '../types/domain';
import { generateId } from '../lib/id';
import type { BreadcrumbItem } from '../types/api';
import { buildDownloadTree } from '../services/download-tree';
import { decodeCursor } from '../lib/cursor';
import { buildDriveOAuthUrl } from '../lib/oauth';
import { computeDriveQuota } from '../lib/storage-quota';
import { encrypt } from '../lib/crypto';
import { resolveGoogleFolderId } from '../lib/drive-folder';
import { logError } from '../lib/logger';
import { zValidator } from '@hono/zod-validator';
import {
  createDriveFolderSchema,
  ensureDriveFolderSchema,
  ensureDriveFoldersBatchSchema,
  renameDriveFolderSchema,
  serviceAccountSchema,
  moveWithinDriveSchema,
  zodErrorHook,
} from '../lib/schemas';
import {
  fetchServiceAccountAccessToken,
  parseServiceAccountJson,
  verifySharedFolderAccess,
} from '../lib/google-service-account';

export async function buildDriveBreadcrumb(
  db: D1Database,
  driveId: string,
  googleFolderId: string,
): Promise<BreadcrumbItem[]> {
  const path: BreadcrumbItem[] = [];

  if (googleFolderId && googleFolderId !== 'root') {
    const driveRepo = new DriveRepository(db);
    const { results } = await driveRepo.findBreadcrumbPath(driveId, googleFolderId);
    for (const row of results) {
      path.push({ id: row.id, name: row.name });
    }
  }

  path.unshift({ id: 'root', name: 'All Files' });
  return path;
}

export const drivesRouter = new Hono<AppContext>({ strict: false });

drivesRouter.use('*', authGuard);

// Returns the Google OAuth URL as JSON (called via credentialed fetch from
// the SPA). userId is carried in the KV OAuth state so /api/auth/callback
// can link the Drive without relying on the session cookie across the
// cross-site Google redirect. See auth.ts /google for the matching flow.
drivesRouter.get('/connect', async (c) => {
  const env = c.env;
  const userId = c.get('userId');

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(
      400,
      'Google OAuth is not configured. Please use a Service Account JSON to connect your drives.',
    );
  }

  const redirectUri = `${env.FRONTEND_URL}/api/auth/callback`;
  const scope = 'openid email profile https://www.googleapis.com/auth/drive';

  const url = await buildDriveOAuthUrl(c, env, userId, redirectUri, scope, {
    prompt: 'select_account consent',
  });
  return c.json({ url });
});

// GET /api/drives/external — list items you own that are not in My Drive
drivesRouter.get('/external', async (c) => {
  const cursorRaw = c.req.query('cursor');
  const cursor = cursorRaw ? decodeCursor<{ name: string; id: string }>(cursorRaw) : null;
  const data = await c.get('driveService').listExternal(c.get('userId'), cursor);
  return c.json(data);
});

// GET /api/drives/:driveId/external-folders/:googleFolderId — live API list children of an external folder
drivesRouter.get('/:driveId/external-folders/:googleFolderId', async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFolderId } = c.req.param();
  const db = c.env.DB;

  const driveRepo = new DriveRepository(db);
  // findFullByIdAndUser (not findByIdAndUser) — batchUpsertFolderContents → buildUpsertStmt
  // binds drive.userId to files.user_id (NOT NULL). Only the full row includes user_id.
  // Mirrors the FilesPage drill-in at drives.ts:327.
  const driveRow = await driveRepo.findFullByIdAndUser(driveId, userId);
  if (!driveRow) return c.json({ error: 'Drive not found' }, 404);

  const drive = mapDriveRow(driveRow as Record<string, unknown>);
  const driveService = createDriveService(c.env);
  const { files: gFiles, folders: gFolders } = await driveService.listFolderContents(
    driveId,
    googleFolderId,
  );

  // Persist live Google data to D1 so file actions (star/rename/share/delete/move)
  // work — they query D1 primary key (files.id), not Google IDs. Same pattern as
  // drives.ts:354 (FilesPage drill-in).
  await batchUpsertFolderContents(db, drive, gFolders, gFiles, googleFolderId);

  // Re-read from D1 — returns full FileEntry/DriveFolder objects with D1 row ids
  // and all fields (isStarred, isTrashed, googleFileId, etc.).
  const newFolders = await driveRepo.findDriveFoldersByParent(driveId, googleFolderId);
  const newFiles = await driveRepo.findFilesByParent(driveId, googleFolderId);

  // Build real breadcrumb (same pattern as sibling route at line 291).
  // findBreadcrumbPath returns the folder chain (parent → child) without a root;
  // the frontend prepends its own "My External Items" root entry.
  const { results: breadcrumbPath } = await driveRepo.findBreadcrumbPath(driveId, googleFolderId);
  const folderRow = await driveRepo.findDriveFolderByGoogleId(driveId, googleFolderId);

  return c.json({
    folder: folderRow ? mapDriveFolderRow(folderRow as Record<string, unknown>) : null,
    subfolders: newFolders.results.map((r) => mapDriveFolderRow(r as Record<string, unknown>)),
    files: newFiles.results.map((r) => mapFileRow(r as Record<string, unknown>)),
    breadcrumb: breadcrumbPath.map((b) => ({ id: b.id, name: b.name })),
  });
});

drivesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const driveService = c.get('driveService');

  const drives = await driveService.listDrives(userId);

  // Free-tier subrequest budget: each getQuota does 1-3 D1 reads + 1 Google API call.
  // 10 drives × 3 = 30 subrequests (safe). Beyond 10, skip live fetch to avoid
  // exceeding the 50-subrequest limit. Users with >10 drives see cached quota only.
  const MAX_QUOTA_FETCHES = 10;
  const drivesWithQuota = await Promise.all(
    drives.slice(0, MAX_QUOTA_FETCHES).map(async (drive) => {
      const hasTokens = await driveService.hasValidTokens(drive.id);
      if (!hasTokens) {
        const computed = computeDriveQuota(drive);
        return { ...drive, ...computed, health: 'auth_expired' as const };
      }

      // Skip live quota fetch for drives already in sync error — the token refresh
      // will fail and hang the entire Promise.all for 10-30s (withBackoff retries).
      // Return cached quota with 'error' health so the UI shows the broken state
      // without freezing. The user must reconnect to fix the token.
      if (drive.syncStatus === 'error') {
        const computed = computeDriveQuota(drive);
        return { ...drive, ...computed, health: 'error' as const };
      }

      try {
        const driveProvider = driveService.getDriveProvider();
        const quota = await driveProvider.getQuota(drive.id);

        // Only persist the total quota Google actually reports. Google omits
        // storageQuota.limit for Google Workspace pooled storage and service
        // accounts (it is returned only "if applicable"); persisting the 1 TiB
        // fallback there would clobber a user-set override on next refresh.
        // Skip the write entirely when nothing changed — saves D1 rows-written quota.
        const quotaChanged = quota.hasLimit
          ? drive.totalQuota !== quota.total || drive.usedQuota !== quota.used
          : drive.usedQuota !== quota.used;

        if (quotaChanged) {
          const driveRepo = new DriveRepository(db);
          if (quota.hasLimit) {
            c.executionCtx.waitUntil(driveRepo.updateQuota(drive.id, quota.total, quota.used));
          } else {
            c.executionCtx.waitUntil(driveRepo.updateUsedQuota(drive.id, quota.used));
          }
        }

        const computed = computeDriveQuota(drive, {
          total: quota.hasLimit ? quota.total : 0,
          used: quota.used,
          hasLimit: quota.hasLimit,
        });
        return { ...drive, ...computed, health: 'connected' as const };
      } catch (e) {
        logError(c, 'Failed to fetch quota for drive', e, { driveId: drive.id });
        const computed = computeDriveQuota({
          totalQuota: drive.totalQuota,
          usedQuota: drive.usedQuota,
          quotaOverride: drive.quotaOverride,
        });
        return { ...drive, ...computed, health: 'error' as const };
      }
    }),
  );
  // Append remaining drives with cached quota (no live Google API fetch)
  for (let i = MAX_QUOTA_FETCHES; i < drives.length; i++) {
    const drive = drives[i];
    drivesWithQuota.push({
      ...drive,
      ...computeDriveQuota(drive),
      health: drive.syncStatus === 'error' ? ('error' as const) : ('connected' as const),
    });
  }

  const aggregate = {
    totalQuota: drivesWithQuota.reduce((sum, d) => sum + d.totalQuota, 0),
    totalUsed: drivesWithQuota.reduce((sum, d) => sum + d.usedQuota, 0),
    totalFree: drivesWithQuota.reduce((sum, d) => sum + d.freeSpace, 0),
    driveCount: drivesWithQuota.length,
  };

  return c.json({ drives: drivesWithQuota, aggregate });
});

drivesRouter.post(
  '/service-account',
  zValidator('json', serviceAccountSchema, zodErrorHook),
  async (c) => {
    const userId = c.get('userId');
    const { credentials: rawCredentials, folderId: rawFolderId } = c.req.valid('json');
    const credentials = rawCredentials.trim();
    const folderId = rawFolderId.trim();

    let sa;
    try {
      sa = parseServiceAccountJson(credentials);
    } catch (err) {
      logError(c, 'Service account JSON parse error', err);
      throw new ValidationError('Invalid service account JSON');
    }

    const serviceAccount = { clientEmail: sa.client_email, privateKey: sa.private_key };

    let accessToken: string;
    let expiresAt: number;
    try {
      ({ accessToken, expiresAt } = await fetchServiceAccountAccessToken(serviceAccount));
    } catch (err) {
      logError(c, 'Service account auth error', err);
      throw new AppError(400, 'Failed to connect Google Drive account');
    }

    let folderInfo: { id: string; name: string };
    try {
      folderInfo = await verifySharedFolderAccess(accessToken, folderId);
    } catch (err) {
      logError(c, 'Shared folder access error', err);
      throw new AppError(400, 'Cannot access the specified shared folder');
    }

    const db = c.env.DB;

    const driveRepo = new DriveRepository(db);
    const existing = await driveRepo.findDriveByGoogleAccountId(userId, sa.client_email);

    if (existing) throw new ConflictError('This service account is already connected');

    const driveId = generateId();
    const countRow = await driveRepo.countDrivesByUser(userId);
    const isPrimary = (countRow?.count ?? 0) === 0 ? 1 : 0;

    await driveRepo.insertDriveAccount({
      id: driveId,
      userId,
      googleAccountId: sa.client_email,
      email: sa.client_email,
      name: folderInfo.name || sa.project_id || sa.client_email,
      isPrimary,
      rootFolderId: folderId,
    });

    const tokens = {
      authType: 'service_account' as const,
      accessToken,
      expiresAt,
      serviceAccount,
    };
    await c
      .get('driveService')
      .upsertTokens(
        driveId,
        await encrypt(JSON.stringify(tokens), c.env.TOKEN_ENCRYPTION_KEY),
        Date.now(),
      );

    const driveRow = await c.get('driveService').findById(driveId);
    if (driveRow) {
      const driveObj = mapDriveRow(driveRow as Record<string, unknown>);
      const driveService = createDriveService(c.env);
      c.executionCtx.waitUntil(syncDriveAccount(driveObj, db, driveService));
    }

    return c.json({ driveId });
  },
);

// ─── Folder read endpoint (from DB, no Google API call) ───

drivesRouter.get('/:driveId/folders/:googleFolderId', async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFolderId } = c.req.param();

  const driveRepo = new DriveRepository(c.env.DB);
  const drive = await driveRepo.findByIdAndUser(driveId, userId);
  if (!drive) return c.json({ error: 'Drive not found' }, 404);

  const folder =
    googleFolderId === 'root'
      ? null
      : await driveRepo.findDriveFolderByGoogleId(driveId, googleFolderId);

  const subfolderResult =
    googleFolderId === 'root'
      ? await driveRepo.findDriveFoldersByParent(driveId, null)
      : await driveRepo.findDriveFoldersByParent(driveId, googleFolderId);

  const filesResult = await driveRepo.findFilesByParent(driveId, googleFolderId);

  const breadcrumb = await buildDriveBreadcrumb(c.env.DB, driveId, googleFolderId);

  return c.json({
    folder: folder
      ? mapDriveFolderRow(folder as Record<string, unknown>)
      : { googleFolderId: 'root', name: 'My Drive', isSynced: true },
    subfolders: subfolderResult.results.map((r) => mapDriveFolderRow(r as Record<string, unknown>)),
    files: filesResult.results.map((r) => mapFileRow(r as Record<string, unknown>)),
    breadcrumb,
  });
});

// ─── Manual drive sync endpoint ───

drivesRouter.post('/:id/sync', async (c) => {
  const userId = c.get('userId');
  const driveId = c.req.param('id');

  const driveRepo = new DriveRepository(c.env.DB);
  const row = await driveRepo.findFullByIdAndUser(driveId, userId);

  if (!row) return c.json({ error: 'Drive not found' }, 404);

  const drive = mapDriveRow(row as Record<string, unknown>);
  const driveService = createDriveService(c.env);

  // Run the sync process in the background via c.executionCtx.waitUntil
  // so the user doesn't have to wait for the entire sync to complete
  c.executionCtx.waitUntil(syncDriveAccount(drive, c.env.DB, driveService));

  return c.body(null, 204);
});

// ─── Lazy folder sync endpoint ───
drivesRouter.post('/:driveId/folders/:googleFolderId/sync', async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFolderId } = c.req.param();

  const driveRepo = new DriveRepository(c.env.DB);
  const driveRow = await driveRepo.findFullByIdAndUser(driveId, userId);
  if (!driveRow) return c.json({ error: 'Drive not found' }, 404);

  const folder = await driveRepo.findDriveFolderByGoogleId(driveId, googleFolderId);

  // Idempotency: already synced — return existing DB data
  if (folder && (folder as Record<string, unknown>).is_synced) {
    const subfolders = await driveRepo.findDriveFoldersByParent(driveId, googleFolderId);
    const files = await driveRepo.findFilesByParent(driveId, googleFolderId);
    const breadcrumb = await buildDriveBreadcrumb(c.env.DB, driveId, googleFolderId);

    return c.json({
      folder: mapDriveFolderRow(folder as Record<string, unknown>),
      subfolders: subfolders.results.map((r) => mapDriveFolderRow(r as Record<string, unknown>)),
      files: files.results.map((r) => mapFileRow(r as Record<string, unknown>)),
      breadcrumb,
    });
  }

  const hasTokens = await c.get('driveService').hasValidTokens(driveId);
  if (!hasTokens) return c.json({ error: 'No tokens for drive' }, 400);

  const drive = mapDriveRow(driveRow as Record<string, unknown>);
  const driveService = createDriveService(c.env);
  const effectiveFolderId = resolveGoogleFolderId(drive, googleFolderId);
  const { files: gFiles, folders: gFolders } = await driveService.listFolderContents(
    driveId,
    effectiveFolderId,
  );

  await batchUpsertFolderContents(c.env.DB, drive, gFolders, gFiles, googleFolderId);

  // Mark folder as synced
  if (folder) {
    await driveRepo.markDriveFolderSynced(driveId, googleFolderId);
  }

  const newSubfolders = await driveRepo.findDriveFoldersByParent(driveId, googleFolderId);
  const newFiles = await driveRepo.findFilesByParent(driveId, googleFolderId);

  const breadcrumb = await buildDriveBreadcrumb(c.env.DB, driveId, googleFolderId);

  return c.json({
    folder: folder ? mapDriveFolderRow(folder as Record<string, unknown>) : null,
    subfolders: newSubfolders.results.map((r) => mapDriveFolderRow(r as Record<string, unknown>)),
    files: newFiles.results.map((r) => mapFileRow(r as Record<string, unknown>)),
    breadcrumb,
  });
});

// Move a Google Drive folder to trash (Google Drive trash + DB is_trashed=1)
drivesRouter.delete('/:driveId/folders/:googleFolderId', async (c) => {
  const driveService = c.get('driveService');
  await driveService.trashDriveFolder(
    c.get('userId'),
    c.req.param('driveId'),
    c.req.param('googleFolderId'),
  );
  return c.body(null, 204);
});

// Restore a trashed Google Drive folder (Google Drive untrash + DB is_trashed=0)
drivesRouter.post('/:driveId/folders/:googleFolderId/restore', async (c) => {
  const driveService = c.get('driveService');
  await driveService.restoreDriveFolder(
    c.get('userId'),
    c.req.param('driveId'),
    c.req.param('googleFolderId'),
  );
  return c.body(null, 204);
});

// Permanently delete a Google Drive folder (cannot be undone)
drivesRouter.delete('/:driveId/folders/:googleFolderId/permanent', async (c) => {
  const driveService = c.get('driveService');
  await driveService.permanentDeleteDriveFolder(
    c.get('userId'),
    c.req.param('driveId'),
    c.req.param('googleFolderId'),
  );
  return c.body(null, 204);
});

// Create a Google Drive folder (optionally inside a parent folder)
drivesRouter.post(
  '/:driveId/folders',
  zValidator('json', createDriveFolderSchema, zodErrorHook),
  async (c) => {
    const driveService = c.get('driveService');
    const { name, parentId } = c.req.valid('json');
    const googleFolderId = await driveService.createDriveFolder(
      c.get('userId'),
      c.req.param('driveId'),
      name.trim(),
      parentId && parentId !== 'root' ? parentId : undefined,
    );
    return c.json({ googleFolderId });
  },
);

/**
 * Ensure a nested folder path exists on a drive, creating folders as needed.
 * Used by folder upload — the web client sends `projects/src/utils` + a parent
 * (the current view), and this walks each segment, creating real Google Drive
 * folders via `driveService.createDriveFolder` (which handles RBAC + Google
 * API + D1 insert). Returns the leaf folder's Google ID so the caller can use
 * it as `parentFolderId` for the files inside that path.
 *
 * Idempotent: if a folder already exists at a segment (by name + parent), it's
 * reused — so retries don't create duplicates.
 */
drivesRouter.post(
  '/:driveId/folders/ensure',
  zValidator('json', ensureDriveFolderSchema, zodErrorHook),
  async (c) => {
    const driveService = c.get('driveService');
    const driveRepo = new DriveRepository(c.env.DB);
    const userId = c.get('userId');
    const driveId = c.req.param('driveId');
    const { path, parentFolderId } = c.req.valid('json');

    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) {
      throw new ValidationError('Path must contain at least one folder name');
    }

    let currentParentId = parentFolderId && parentFolderId !== 'root' ? parentFolderId : undefined;

    for (const segment of segments) {
      // Check if this folder already exists (by name + parent) — idempotent.
      const existing = await driveRepo.findDriveFolderByParentAndName(
        driveId,
        currentParentId ?? null,
        segment,
      );
      if (existing) {
        currentParentId = existing.google_folder_id;
        continue;
      }
      // Create the folder via the RBAC-wrapped service method.
      currentParentId = await driveService.createDriveFolder(
        userId,
        driveId,
        segment,
        currentParentId,
      );
    }

    return c.json({ googleFolderId: currentParentId });
  },
);

/**
 * Batch-ensure multiple folder paths on a drive in a single request.
 * Builds an in-memory trie from all paths, walks it once — creating each
 * unique folder exactly once. Returns a map of path → googleFolderId.
 *
 * Replaces the N+1 pattern of calling /ensure once per path.
 *
 * Idempotent: existing folders are reused (same contract as single /ensure).
 * Throws on first failure (Google API error, quota) — matches single /ensure
 * contract. Client retries the entire batch.
 *
 * SUBREQUEST BUDGET (Free tier):
 * - External (Google API): 50/invocation
 *   (https://developers.cloudflare.com/workers/platform/limits/)
 * - D1: 50/invocation — separate co-bottleneck on Free tier
 *   (https://developers.cloudflare.com/d1/platform/limits/, sync.ts:32)
 *
 * Per createDriveFolder cost:
 * - 2-3 D1 calls (getDriveOrThrow + insertDriveFolder + possible loadTokens)
 * - 1 external call (Google API create)
 *
 * Cap at 15 folder creations: 15 × 3 D1 = 45 (under 50 D1), 15 × 1 ext = 15
 * (under 50 ext). Matches codebase pattern: MAX_QUOTA_FETCHES=10,
 * MAX_DELETES_PER_CYCLE=20, download-tree caps at 40 API calls. If batch
 * would exceed 15 creates, throws 400 — client chunks and retries.
 */
drivesRouter.post(
  '/:driveId/folders/ensure-batch',
  zValidator('json', ensureDriveFoldersBatchSchema, zodErrorHook),
  async (c) => {
    const driveService = c.get('driveService');
    const driveRepo = new DriveRepository(c.env.DB);
    const userId = c.get('userId');
    const driveId = c.req.param('driveId');
    const { paths, parentFolderId } = c.req.valid('json');

    const uniquePaths = [...new Set(paths)];

    // Build a trie: { "projects": { "src": { "utils": {} } } }
    const trie: Record<string, unknown> = {};
    for (const path of uniquePaths) {
      const segments = path.split('/');
      let node = trie;
      for (const seg of segments) {
        node[seg] = (node[seg] as Record<string, unknown>) ?? {};
        node = node[seg] as Record<string, unknown>;
      }
    }

    // Walk the trie, creating folders as needed. cache: segment-path → googleFolderId.
    const cache = new Map<string, string>();
    const MAX_FOLDER_CREATES = 15; // 15 × 3 D1 = 45 (under 50 D1 limit on Free)
    let createCount = 0;

    async function walkTrie(
      node: Record<string, unknown>,
      currentPath: string,
      currentParentId: string | undefined,
    ): Promise<void> {
      const childNames = Object.keys(node);
      if (childNames.length === 0) return;

      // Batch-lookup existing folders at this level (D1-safe chunking inside).
      const existing = await driveRepo.findDriveFoldersByParentAndNames(
        driveId,
        currentParentId ?? null,
        childNames,
      );
      for (const row of existing) {
        const fullPath = currentPath ? `${currentPath}/${row.name}` : row.name;
        cache.set(fullPath, row.google_folder_id);
      }

      // Create missing children sequentially (Google Drive API doesn't batch folder creation).
      for (const name of childNames) {
        const fullPath = currentPath ? `${currentPath}/${name}` : name;
        if (cache.has(fullPath)) continue;
        if (createCount >= MAX_FOLDER_CREATES) {
          throw new ValidationError(
            `Batch exceeds ${MAX_FOLDER_CREATES} folder creations (D1 + external subrequest budget). Split into smaller batches.`,
          );
        }
        const googleFolderId = await driveService.createDriveFolder(
          userId,
          driveId,
          name,
          currentParentId,
        );
        createCount++; // each createDriveFolder = 2-3 D1 + 1 external subrequest
        cache.set(fullPath, googleFolderId);
        await walkTrie(node[name] as Record<string, unknown>, fullPath, googleFolderId);
      }
    }

    await walkTrie(
      trie,
      '',
      parentFolderId && parentFolderId !== 'root' ? parentFolderId : undefined,
    );

    // Return only the requested paths (not intermediate nodes).
    const result: Record<string, string> = {};
    for (const path of uniquePaths) {
      const id = cache.get(path);
      if (id) result[path] = id;
    }
    return c.json({ folderIds: result });
  },
);

// Star a Google Drive folder
drivesRouter.post('/:driveId/folders/:googleFolderId/star', async (c) => {
  const driveService = c.get('driveService');
  await driveService.starDriveFolder(
    c.get('userId'),
    c.req.param('driveId'),
    c.req.param('googleFolderId'),
  );
  return c.body(null, 204);
});

// Unstar a Google Drive folder
drivesRouter.post('/:driveId/folders/:googleFolderId/unstar', async (c) => {
  const driveService = c.get('driveService');
  await driveService.unstarDriveFolder(
    c.get('userId'),
    c.req.param('driveId'),
    c.req.param('googleFolderId'),
  );
  return c.body(null, 204);
});

// Rename a Google Drive folder
drivesRouter.patch(
  '/:driveId/folders/:googleFolderId/rename',
  zValidator('json', renameDriveFolderSchema, zodErrorHook),
  async (c) => {
    const driveService = c.get('driveService');
    const { name } = c.req.valid('json');
    await driveService.renameDriveFolder(
      c.get('userId'),
      c.req.param('driveId'),
      c.req.param('googleFolderId'),
      name,
    );
    return c.body(null, 204);
  },
);

// Move a file or folder to a different folder within the same drive
drivesRouter.patch(
  '/:driveId/move/:googleFileId',
  zValidator('json', moveWithinDriveSchema, zodErrorHook),
  async (c) => {
    const userId = c.get('userId');
    const { driveId, googleFileId } = c.req.param();
    const { targetFolderId, oldParentId, isFolder } = c.req.valid('json');

    await c
      .get('driveService')
      .moveItemWithinDrive(
        userId,
        driveId,
        googleFileId,
        targetFolderId,
        oldParentId || null,
        isFolder,
      );

    return c.body(null, 204);
  },
);

drivesRouter.delete('/:id', async (c) => {
  await c.get('driveService').disconnectDrive(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

// GET /api/drives/:driveId/folders/:googleFolderId/download-tree
// Recursively lists all files in a folder (including subfolders), persists them
// to D1 so the existing GET /api/files/:id/download endpoint works, and returns
// a flat array with relative paths for client-side ZIP assembly.
// Caps at 500 files + 40 API calls to stay within Free tier subrequest budget.
// Tree-walk logic lives in services/download-tree.ts (shared with shared.ts).
drivesRouter.get('/:driveId/folders/:googleFolderId/download-tree', async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFolderId } = c.req.param();
  const db = c.env.DB;

  const driveRepo = new DriveRepository(db);
  const driveRow = await driveRepo.findFullByIdAndUser(driveId, userId);
  if (!driveRow) return c.json({ error: 'Drive not found' }, 404);

  const drive = mapDriveRow(driveRow as Record<string, unknown>);
  const driveService = createDriveService(c.env);

  // Build a googleFileId → FileEntry map as we persist each folder's contents
  // to D1. The helper returns Google-file-keyed tree items; this map swaps in
  // D1 row ids (so GET /api/files/:id/download works) and applies the userId
  // sanity check (no-op given findFullByIdAndUser, but preserved for parity
  // with the pre-refactor handler).
  const d1FilesByGoogleId = new Map<string, FileEntry>();

  const { files: googleTree, truncated } = await buildDownloadTree({
    driveService,
    driveId,
    rootFolderId: googleFolderId,
    // Exclude files not owned by the user — mirrors batchUpsertFolderContents's
    // ownership filter so maxFiles counts only owned files (the pre-refactor
    // handler iterated D1 rows already filtered to owned).
    filterFile: (f) => f.owners?.some((o) => o.me) ?? false,
    onFolderListed: async (folderId, gFiles, gFolders) => {
      await batchUpsertFolderContents(db, drive, gFolders, gFiles, folderId);
      const fileRows = await driveRepo.findFilesByParent(driveId, folderId);
      for (const row of fileRows.results) {
        const file = mapFileRow(row as Record<string, unknown>);
        d1FilesByGoogleId.set(file.googleFileId, file);
      }
    },
  });

  const tree = googleTree
    .map((item) => {
      const file = d1FilesByGoogleId.get(item.googleFileId);
      if (!file || file.userId !== userId) return null;
      return {
        id: file.id,
        name: file.name,
        path: item.path,
        size: file.size,
        mimeType: file.mimeType,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const rootFolder = await driveRepo.findDriveFolderByGoogleId(driveId, googleFolderId);
  return c.json({
    files: tree,
    rootName: (rootFolder as Record<string, unknown>)?.name ?? 'folder',
    truncated,
  });
});
