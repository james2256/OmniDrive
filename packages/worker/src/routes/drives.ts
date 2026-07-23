import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { AppError } from '../middleware/error-handler';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { GoogleDriveService } from '../services/google-drive';
import { DriveRepository } from '../repositories/drive.repository';
import { syncDriveAccount, batchUpsertFolderContents } from '../services/sync';
import { mapDriveRow, mapDriveFolderRow, mapFileRow } from '../types';
import { generateId } from '../lib/id';
import type { BreadcrumbItem } from '../types';
import { generatePKCE } from '../lib/pkce';
import { computeDriveQuota } from '../lib/storage-quota';
import { encrypt } from '../lib/crypto';
import { resolveGoogleFolderId } from '../lib/drive-folder';
import { logError } from '../lib/logger';
import { zValidator } from '@hono/zod-validator';
import {
  createDriveFolderSchema,
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

export async function buildDriveBreadcrumb(db: D1Database, driveId: string, googleFolderId: string): Promise<BreadcrumbItem[]> {
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
    throw new AppError(400, 'Google OAuth is not configured. Please use a Service Account JSON to connect your drives.');
  }

  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const scope = 'openid email profile https://www.googleapis.com/auth/drive';

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'select_account consent');

  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePKCE();

  await env.DB.prepare(
    'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)'
  ).bind(state, codeVerifier, userId, Date.now()).run();
  const isSecure = env.WORKER_URL.startsWith('https://');
  setCookie(c, 'oauth_state', state, { path: '/', httpOnly: true, secure: isSecure, sameSite: isSecure ? 'None' : 'Lax', maxAge: 60 * 5 });
  
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('code_challenge', codeChallenge);
  authUrl.searchParams.append('code_challenge_method', 'S256');

  return c.json({ url: authUrl.toString() });
});

// GET /api/drives/shared-with-me — list shared items not added to My Drive (owned_by_me = 1, google_parent_id = '__shared__')
drivesRouter.get('/shared-with-me', async (c) => {
  const data = await c.get('driveService').listSharedWithMe(c.get('userId'));
  return c.json(data);
});

// GET /api/drives/:driveId/shared-folders/:googleFolderId — live API list children of a shared folder
drivesRouter.get('/:driveId/shared-folders/:googleFolderId', async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFolderId } = c.req.param();
  const db = c.env.DB;

  const driveRepo = new DriveRepository(db);
  const drive = await driveRepo.findByIdAndUser(driveId, userId);
  if (!drive) return c.json({ error: 'Drive not found' }, 404);

  const driveService = new GoogleDriveService(db, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
  const { files, folders } = await driveService.listFolderContents(driveId, googleFolderId);

  // Map to frontend-expected format: GDriveFolder → DriveFolder, GDriveFile → FileEntry-like
  return c.json({
    folder: null,
    subfolders: folders.map((f) => ({
      googleFolderId: f.id,
      name: f.name,
      driveAccountId: driveId,
      isSynced: false,
    })),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: parseInt(f.size ?? '0', 10),
      thumbnailUrl: f.thumbnailLink ?? null,
      webViewLink: f.webViewLink ?? null,
      webContentLink: f.webContentLink ?? null,
      googleCreatedAt: f.createdTime,
      googleModifiedAt: f.modifiedTime,
      driveAccountId: driveId,
      driveEmail: drive.email,
    })),
    breadcrumb: [],
  });
});

drivesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const driveService = c.get('driveService');

  const drives = await driveService.listDrives(userId);

  const drivesWithQuota = await Promise.all(drives.map(async (drive) => {
    const hasTokens = await driveService.hasValidTokens(drive.id);
    if (!hasTokens) {
      const { freeSpace, usagePercent } = computeDriveQuota(drive);
      return { ...drive, freeSpace, usagePercent, health: 'auth_expired' as const };
    }

    try {
      const googleDriveService = driveService.getGoogleDriveService();
      const quota = await googleDriveService.getQuota(drive.id);

      // Only persist the total quota Google actually reports. Google omits
      // storageQuota.limit for Google Workspace pooled storage and service
      // accounts (it is returned only "if applicable"); persisting the 1 TiB
      // fallback there would clobber a user-set override on next refresh.
      // Skip the write entirely when nothing changed — saves D1 rows-written quota.
      const quotaChanged = quota.hasLimit
        ? (drive.totalQuota !== quota.total || drive.usedQuota !== quota.used)
        : (drive.usedQuota !== quota.used);

      if (quotaChanged) {
        if (quota.hasLimit) {
          c.executionCtx.waitUntil(
            db.prepare('UPDATE drive_accounts SET total_quota = ?, used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .bind(quota.total, quota.used, drive.id).run()
          );
        } else {
          c.executionCtx.waitUntil(
            db.prepare('UPDATE drive_accounts SET used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .bind(quota.used, drive.id).run()
          );
        }
      }

      const computed = computeDriveQuota(drive, { total: quota.hasLimit ? quota.total : 0, used: quota.used });
      return { ...drive, ...computed, health: 'connected' as const };

    } catch (e) {
      logError(c, 'Failed to fetch quota for drive', e, { driveId: drive.id });
      const computed = computeDriveQuota({ totalQuota: 0, usedQuota: drive.usedQuota, quotaOverride: drive.quotaOverride });
      return { ...drive, ...computed, health: 'error' as const };
    }
  }));

  const aggregate = {
    totalQuota: drivesWithQuota.reduce((sum, d) => sum + d.totalQuota, 0),
    totalUsed: drivesWithQuota.reduce((sum, d) => sum + d.usedQuota, 0),
    totalFree: drivesWithQuota.reduce((sum, d) => sum + d.freeSpace, 0),
    driveCount: drivesWithQuota.length,
  };

  return c.json({ drives: drivesWithQuota, aggregate });
});

drivesRouter.post('/service-account', zValidator('json', serviceAccountSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const { credentials: rawCredentials, folderId: rawFolderId } = c.req.valid('json');
  const credentials = rawCredentials.trim();
  const folderId = rawFolderId.trim();

  let sa;
  try {
    sa = parseServiceAccountJson(credentials);
  } catch (err) {
    logError(c, 'Service account JSON parse error', err);
    throw new AppError(400, 'Invalid service account JSON');
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

  if (existing) throw new AppError(409, 'This service account is already connected');

  const driveId = generateId();
  const countRow = await driveRepo.countDrivesByUser(userId);
  const isPrimary = (countRow?.count ?? 0) === 0 ? 1 : 0;

  await driveRepo.insertDriveAccount({
    id: driveId, userId, googleAccountId: sa.client_email,
    email: sa.client_email, name: folderInfo.name || sa.project_id || sa.client_email,
    isPrimary, rootFolderId: folderId,
  });

  const tokens = {
    authType: 'service_account' as const,
    accessToken,
    expiresAt,
    serviceAccount,
  };
  await c.get('driveService').upsertTokens(driveId, await encrypt(JSON.stringify(tokens), c.env.TOKEN_ENCRYPTION_KEY), Date.now());

  const driveRow = await c.get('driveService').findById(driveId);
  if (driveRow) {
    const driveObj = mapDriveRow(driveRow as Record<string, unknown>);
    const driveService = new GoogleDriveService(
      db,
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      c.env.TOKEN_ENCRYPTION_KEY
    );
    c.executionCtx.waitUntil(syncDriveAccount(driveObj, db, driveService));
  }

  return c.json({ success: true, driveId });
});

// ─── Folder read endpoint (from DB, no Google API call) ───

drivesRouter.get('/:driveId/folders/:googleFolderId', async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFolderId } = c.req.param();

  const driveRepo = new DriveRepository(c.env.DB);
  const drive = await driveRepo.findByIdAndUser(driveId, userId);
  if (!drive) return c.json({ error: 'Drive not found' }, 404);

  const folder = googleFolderId === 'root'
    ? null
    : await driveRepo.findDriveFolderByGoogleId(driveId, googleFolderId);

  const subfolderResult = googleFolderId === 'root'
    ? await driveRepo.findDriveFoldersByParent(driveId, null)
    : await driveRepo.findDriveFoldersByParent(driveId, googleFolderId);

  const filesResult = await driveRepo.findFilesByParent(driveId, googleFolderId);

  const breadcrumb = await buildDriveBreadcrumb(c.env.DB, driveId, googleFolderId);

  return c.json({
    folder: folder
      ? mapDriveFolderRow(folder as Record<string, unknown>)
      : { googleFolderId: 'root', name: 'My Drive', isSynced: true },
    subfolders: subfolderResult.results.map(r => mapDriveFolderRow(r as Record<string, unknown>)),
    files: filesResult.results.map(r => mapFileRow(r as Record<string, unknown>)),
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
  const driveService = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
  
  // Run the sync process in the background via c.executionCtx.waitUntil
  // so the user doesn't have to wait for the entire sync to complete
  c.executionCtx.waitUntil(syncDriveAccount(drive, c.env.DB, driveService));
  
  return c.json({ success: true });
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
      subfolders: subfolders.results.map(r => mapDriveFolderRow(r as Record<string, unknown>)),
      files: files.results.map(r => mapFileRow(r as Record<string, unknown>)),
      breadcrumb,
    });
  }

  const hasTokens = await c.get('driveService').hasValidTokens(driveId);
  if (!hasTokens) return c.json({ error: 'No tokens for drive' }, 400);

  const drive = mapDriveRow(driveRow as Record<string, unknown>);
  const driveService = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
  const effectiveFolderId = resolveGoogleFolderId(drive, googleFolderId);
  const { files: gFiles, folders: gFolders } = await driveService.listFolderContents(driveId, effectiveFolderId);

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
    subfolders: newSubfolders.results.map(r => mapDriveFolderRow(r as Record<string, unknown>)),
    files: newFiles.results.map(r => mapFileRow(r as Record<string, unknown>)),
    breadcrumb,
  });
});

// Move a Google Drive folder to trash (Google Drive trash + DB is_trashed=1)
drivesRouter.delete('/:driveId/folders/:googleFolderId', async (c) => {
  const driveService = c.get('driveService');
  await driveService.trashDriveFolder(c.get('userId'), c.req.param('driveId'), c.req.param('googleFolderId'));
  return c.json({ success: true });
});

// Restore a trashed Google Drive folder (Google Drive untrash + DB is_trashed=0)
drivesRouter.post('/:driveId/folders/:googleFolderId/restore', async (c) => {
  const driveService = c.get('driveService');
  await driveService.restoreDriveFolder(c.get('userId'), c.req.param('driveId'), c.req.param('googleFolderId'));
  return c.json({ success: true });
});

// Permanently delete a Google Drive folder (cannot be undone)
drivesRouter.delete('/:driveId/folders/:googleFolderId/permanent', async (c) => {
  const driveService = c.get('driveService');
  await driveService.permanentDeleteDriveFolder(c.get('userId'), c.req.param('driveId'), c.req.param('googleFolderId'));
  return c.json({ success: true });
});

// Create a Google Drive folder (optionally inside a parent folder)
drivesRouter.post('/:driveId/folders', zValidator('json', createDriveFolderSchema, zodErrorHook), async (c) => {
  const driveService = c.get('driveService');
  const { name, parentId } = c.req.valid('json');
  const googleFolderId = await driveService.createDriveFolder(c.get('userId'), c.req.param('driveId'), name.trim(), parentId || undefined);
  return c.json({ success: true, googleFolderId });
});

// Star a Google Drive folder
drivesRouter.post('/:driveId/folders/:googleFolderId/star', async (c) => {
  const driveService = c.get('driveService');
  await driveService.starDriveFolder(c.get('userId'), c.req.param('driveId'), c.req.param('googleFolderId'));
  return c.json({ success: true });
});

// Unstar a Google Drive folder
drivesRouter.post('/:driveId/folders/:googleFolderId/unstar', async (c) => {
  const driveService = c.get('driveService');
  await driveService.unstarDriveFolder(c.get('userId'), c.req.param('driveId'), c.req.param('googleFolderId'));
  return c.json({ success: true });
});

// Rename a Google Drive folder
drivesRouter.patch('/:driveId/folders/:googleFolderId/rename', zValidator('json', renameDriveFolderSchema, zodErrorHook), async (c) => {
  const driveService = c.get('driveService');
  const { name } = c.req.valid('json');
  await driveService.renameDriveFolder(c.get('userId'), c.req.param('driveId'), c.req.param('googleFolderId'), name);
  return c.json({ success: true });
});

// Move a file or folder to a different folder within the same drive
drivesRouter.patch('/:driveId/move/:googleFileId', zValidator('json', moveWithinDriveSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const { driveId, googleFileId } = c.req.param();
  const { targetFolderId, oldParentId, isFolder } = c.req.valid('json');

  await c.get('driveService').moveItemWithinDrive(userId, driveId, googleFileId, targetFolderId, oldParentId || null, isFolder);

  return c.json({ success: true });
});

drivesRouter.delete('/:id', async (c) => {
  await c.get('driveService').disconnectDrive(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});
