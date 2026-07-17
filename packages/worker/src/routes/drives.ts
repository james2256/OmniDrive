import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { AppError } from '../middleware/error-handler';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { GoogleDriveService } from '../services/google-drive';
import { syncDriveAccount, batchUpsertFolderContents } from '../services/sync';
import { mapDriveRow, mapDriveFolderRow, mapFileRow } from '../types';
import { generateId } from '../lib/id';
import type { BreadcrumbItem } from '../types';
import { generatePKCE } from '../lib/pkce';
import { computeDriveQuota } from '../lib/storage-quota';
import { encrypt } from '../lib/crypto';
import { resolveGoogleFolderId } from '../lib/drive-folder';
import {
  fetchServiceAccountAccessToken,
  parseServiceAccountJson,
  verifySharedFolderAccess,
} from '../lib/google-service-account';

export async function buildDriveBreadcrumb(db: D1Database, driveId: string, googleFolderId: string): Promise<BreadcrumbItem[]> {
  const path: BreadcrumbItem[] = [];
  
  if (googleFolderId && googleFolderId !== 'root') {
    const query = `
      WITH RECURSIVE breadcrumb_path(id, google_parent_id, name, lvl) AS (
        SELECT google_folder_id, google_parent_id, name, 0 as lvl 
        FROM drive_folders 
        WHERE drive_account_id = ? AND google_folder_id = ?
        UNION ALL
        SELECT d.google_folder_id, d.google_parent_id, d.name, bp.lvl + 1 
        FROM drive_folders d
        JOIN breadcrumb_path bp ON d.google_folder_id = bp.google_parent_id
        WHERE d.drive_account_id = ?
      )
      SELECT id, name FROM breadcrumb_path ORDER BY lvl DESC
    `;
    const { results } = await db.prepare(query).bind(driveId, googleFolderId, driveId).all() as { results: { id: string, name: string }[] };
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

drivesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const { results } = await db
    .prepare('SELECT a.*, s.status as sync_status, s.last_synced_at FROM drive_accounts a LEFT JOIN sync_state s ON a.id = s.drive_account_id WHERE a.user_id = ?')
    .bind(userId)
    .all();

  const drives = results.map(mapDriveRow);

  const drivesWithQuota = await Promise.all(drives.map(async (drive) => {
    const tokenRow = await db.prepare('SELECT 1 as ok FROM drive_tokens WHERE drive_account_id = ?').bind(drive.id).first();
    if (!tokenRow) {
      const { freeSpace, usagePercent } = computeDriveQuota(drive);
      return { ...drive, freeSpace, usagePercent, health: 'auth_expired' as const };
    }

    try {
      const driveService = new GoogleDriveService(db, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
      const quota = await driveService.getQuota(drive.id);

      // Only persist the total quota Google actually reports. Google omits
      // storageQuota.limit for Google Workspace pooled storage and service
      // accounts (it is returned only "if applicable"); persisting the 1 TiB
      // fallback there would clobber a user-set override on next refresh.
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

      const computed = computeDriveQuota(drive, { total: quota.hasLimit ? quota.total : 0, used: quota.used });
      return { ...drive, ...computed, health: 'connected' as const };

    } catch (e) {
      console.error(`Failed to fetch quota for drive ${drive.id}`, e);
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

drivesRouter.post('/service-account', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ credentials?: string; folderId?: string }>();
  const credentials = body.credentials?.trim();
  const folderId = body.folderId?.trim();

  if (!credentials) throw new AppError(400, 'Service account JSON is required');
  if (!folderId) throw new AppError(400, 'Shared folder ID is required');

  let sa;
  try {
    sa = parseServiceAccountJson(credentials);
  } catch (err) {
    console.error('Service account JSON parse error:', err);
    throw new AppError(400, 'Invalid service account JSON');
  }

  const serviceAccount = { clientEmail: sa.client_email, privateKey: sa.private_key };

  let accessToken: string;
  let expiresAt: number;
  try {
    ({ accessToken, expiresAt } = await fetchServiceAccountAccessToken(serviceAccount));
  } catch (err) {
    console.error('Service account auth error:', err);
    throw new AppError(400, 'Failed to connect Google Drive account');
  }

  let folderInfo: { id: string; name: string };
  try {
    folderInfo = await verifySharedFolderAccess(accessToken, folderId);
  } catch (err) {
    console.error('Shared folder access error:', err);
    throw new AppError(400, 'Cannot access the specified shared folder');
  }

  const db = c.env.DB;

  const existing = await db
    .prepare('SELECT id FROM drive_accounts WHERE user_id = ? AND google_account_id = ?')
    .bind(userId, sa.client_email)
    .first();

  if (existing) throw new AppError(409, 'This service account is already connected');

  const driveId = generateId();
  const countRow = await db
    .prepare('SELECT COUNT(*) as count FROM drive_accounts WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>();
  const isPrimary = (countRow?.count ?? 0) === 0 ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary, root_folder_id)
       VALUES (?, ?, ?, ?, ?, 'service_account', ?, ?)`
    )
    .bind(
      driveId,
      userId,
      sa.client_email,
      sa.client_email,
      folderInfo.name || sa.project_id || sa.client_email,
      isPrimary,
      folderId
    )
    .run();

  const tokens = {
    authType: 'service_account' as const,
    accessToken,
    expiresAt,
    serviceAccount,
  };
  await db.prepare(
    'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(drive_account_id) DO UPDATE SET encrypted_tokens = excluded.encrypted_tokens, updated_at = excluded.updated_at'
  ).bind(driveId, await encrypt(JSON.stringify(tokens), c.env.TOKEN_ENCRYPTION_KEY), Date.now()).run();

  const driveRow = await db.prepare('SELECT * FROM drive_accounts WHERE id = ?').bind(driveId).first();
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

  const drive = await c.env.DB
    .prepare('SELECT id FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId)
    .first();

  if (!drive) return c.json({ error: 'Drive not found' }, 404);

  const folder = googleFolderId === 'root'
    ? null
    : await c.env.DB
        .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
        .bind(driveId, googleFolderId)
        .first();

  const subfolderResult = googleFolderId === 'root'
    ? await c.env.DB
        .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_parent_id IS NULL ORDER BY name ASC LIMIT 1000')
        .bind(driveId)
        .all()
    : await c.env.DB
        .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_parent_id = ? ORDER BY name ASC LIMIT 1000')
        .bind(driveId, googleFolderId)
        .all();

  const filesResult = await c.env.DB
    .prepare('SELECT * FROM files WHERE drive_account_id = ? AND google_parent_id = ? AND is_trashed = 0 ORDER BY name ASC LIMIT 1000')
    .bind(driveId, googleFolderId)
    .all();

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

  const row = await c.env.DB
    .prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId)
    .first();

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

  const driveRow = await c.env.DB
    .prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId)
    .first();

  if (!driveRow) return c.json({ error: 'Drive not found' }, 404);

  const folder = await c.env.DB
    .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_folder_id = ?')
    .bind(driveId, googleFolderId)
    .first();

  // Idempotency: already synced — return existing DB data
  if (folder && (folder as Record<string, unknown>).is_synced) {
    const subfolders = await c.env.DB
      .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_parent_id = ? ORDER BY name ASC LIMIT 1000')
      .bind(driveId, googleFolderId)
      .all();
    const files = await c.env.DB
      .prepare('SELECT * FROM files WHERE drive_account_id = ? AND google_parent_id = ? AND is_trashed = 0 ORDER BY name ASC LIMIT 1000')
      .bind(driveId, googleFolderId)
      .all();
    const breadcrumb = await buildDriveBreadcrumb(c.env.DB, driveId, googleFolderId);

    return c.json({
      folder: mapDriveFolderRow(folder as Record<string, unknown>),
      subfolders: subfolders.results.map(r => mapDriveFolderRow(r as Record<string, unknown>)),
      files: files.results.map(r => mapFileRow(r as Record<string, unknown>)),
      breadcrumb,
    });
  }

  const tokenRow = await c.env.DB.prepare('SELECT 1 as ok FROM drive_tokens WHERE drive_account_id = ?').bind(driveId).first();
  if (!tokenRow) return c.json({ error: 'No tokens for drive' }, 400);

  const drive = mapDriveRow(driveRow as Record<string, unknown>);
  const driveService = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
  const effectiveFolderId = resolveGoogleFolderId(drive, googleFolderId);
  const { files: gFiles, folders: gFolders } = await driveService.listFolderContents(driveId, effectiveFolderId);

  await batchUpsertFolderContents(c.env.DB, drive, gFolders, gFiles, googleFolderId);

  // Mark folder as synced
  if (folder) {
    await c.env.DB
      .prepare(`UPDATE drive_folders SET is_synced = 1, synced_at = datetime('now') WHERE drive_account_id = ? AND google_folder_id = ?`)
      .bind(driveId, googleFolderId)
      .run();
  }

  const newSubfolders = await c.env.DB
    .prepare('SELECT * FROM drive_folders WHERE drive_account_id = ? AND google_parent_id = ? ORDER BY name ASC LIMIT 1000')
    .bind(driveId, googleFolderId)
    .all();
  const newFiles = await c.env.DB
    .prepare('SELECT * FROM files WHERE drive_account_id = ? AND google_parent_id = ? AND is_trashed = 0 ORDER BY name ASC LIMIT 1000')
    .bind(driveId, googleFolderId)
    .all();

  const breadcrumb = await buildDriveBreadcrumb(c.env.DB, driveId, googleFolderId);

  return c.json({
    folder: folder ? mapDriveFolderRow(folder as Record<string, unknown>) : null,
    subfolders: newSubfolders.results.map(r => mapDriveFolderRow(r as Record<string, unknown>)),
    files: newFiles.results.map(r => mapFileRow(r as Record<string, unknown>)),
    breadcrumb,
  });
});

drivesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const driveId = c.req.param('id');
  const db = c.env.DB;

  const row = await db
    .prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId)
    .first();

  if (!row) throw new AppError(404, 'Drive not found');

  const wasPrimary = (row as Record<string, unknown>).is_primary === 1;
  const driveType = (row as Record<string, unknown>).type as string;

  if (driveType === 'oauth') {
    const driveService = new GoogleDriveService(db, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
    await driveService.revokeTokens(driveId);
  }

  await db.prepare('DELETE FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId).run();

  if (wasPrimary) {
    const next = await db
      .prepare('SELECT id FROM drive_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
      .bind(userId)
      .first<{ id: string }>();
    if (next) {
      await db.prepare('UPDATE drive_accounts SET is_primary = 1 WHERE id = ?')
        .bind(next.id).run();
    }
  }

  // drive_tokens row auto-deleted by ON DELETE CASCADE when drive_accounts row removed,
  // but explicit delete in case the drive_account row is kept.
  await db.prepare('DELETE FROM drive_tokens WHERE drive_account_id = ?').bind(driveId).run();

  return c.json({ success: true });
});
