import { Hono } from 'hono';
import type { AppContext, Env } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { AppError } from '../middleware/error-handler';
import { mapDriveRow } from '../types';
import { syncDriveAccount, syncDriveFolder } from '../services/sync';
import { GoogleDriveService } from '../services/google-drive';
import { decodeCursor } from '../lib/cursor';
import { zValidator } from '@hono/zod-validator';
import { createFolderSchema, updateFolderSchema, addFilesToFolderSchema, zodErrorHook } from '../lib/schemas';
import { logError, logErrorNoCtx } from '../lib/logger';

export const foldersRouter = new Hono<AppContext>({ strict: false });

foldersRouter.use('*', authGuard);

/**
 * Background sync helper. Stays as a standalone function (not on the service)
 * because it uses env + syncDriveFolder + needs to update sync status on error.
 */
async function performBackgroundSync(env: Env, folderId: string, driveId: string | null, userId: string) {
  const folderService = new (await import('../services/folder.service')).FolderService(env.DB);
  try {
    await folderService.markSyncing(folderId);
    if (driveId) {
      await syncDriveFolder(env, driveId, folderId, userId);
    }
    await folderService.markSyncComplete(folderId);
  } catch (err) {
    logErrorNoCtx('Background sync error', err);
    await folderService.markSyncError(folderId);
  }
}

// GET /tree — folder tree (workspaces as roots + all folders)
foldersRouter.get('/tree', async (c) => {
  const folderService = c.get('folderService');
  const rootFolders = await folderService.listWorkspacesAsRootFolders(c.get('userId'));

  const { results: folders } = await c.get('folderService').findAllFoldersByUser(c.get('userId'));

  const subFolders = folders.map((f: Record<string, unknown>) => ({
    id: f.id, workspaceId: f.workspace_id, name: f.name, parentId: f.parent_id || f.workspace_id, icon: f.icon || '📁', color: f.color || '#4A90D9', isStarred: !!f.is_starred, metadata: f.metadata, createdAt: f.created_at, updatedAt: f.updated_at
  }));

  return c.json({ folders: [...rootFolders, ...subFolders] });
});

// GET /:id? — list workspaces, workspace contents, or folder contents
foldersRouter.get('/:id?', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id') || null;
  const folderService = c.get('folderService');

  const cursorParam = c.req.query('cursor');
  const parsed = parseInt(c.req.query('limit') || '50', 10);
  const limit = isNaN(parsed) || parsed < 1 ? 50 : Math.min(parsed, 100);
  const cursor = cursorParam ? decodeCursor<{ name: string, id: string }>(cursorParam) : null;

  let currentFolder = null;
  let subfolders: unknown[];
  let files: unknown[] = [];
  let breadcrumb: { id: string | null; name: string }[] = [];
  let hasMore = false;
  let nextCursor: string | null = null;

  if (!folderId) {
    // No folderId — list workspaces as root folders
    subfolders = await folderService.listWorkspacesAsRootFolders(userId);
  } else {
    // Check if folderId is a workspace
    const ws = await c.get('workspaceService').findByIdAndMember(folderId, userId);

    if (ws) {
      // Workspace case
      const result = await folderService.getWorkspaceContents(userId, folderId, cursor, limit);
      currentFolder = result.currentFolder;
      subfolders = result.subfolders;
      files = result.files;
      breadcrumb = result.breadcrumb;
      hasMore = result.hasMore;
      nextCursor = result.nextCursor;
    } else {
      // Folder case
      const result = await folderService.getFolderContents(userId, folderId, cursor, limit);
      currentFolder = result.currentFolder;
      subfolders = result.subfolders;
      files = result.files;
      breadcrumb = result.breadcrumb;
      hasMore = result.hasMore;
      nextCursor = result.nextCursor;
    }
  }

  // Sync TTL + background sync trigger (stays in route — uses c.executionCtx.waitUntil)
  if (currentFolder && (currentFolder as { id: string; workspaceId: string }).id !== (currentFolder as { id: string; workspaceId: string }).workspaceId) {
    const cf = currentFolder as { workspaceId: string; id: string; lastSyncedAt: string | null; syncStatus: string };
    const ws = await c.get('workspaceService').findSyncTtl(cf.workspaceId);
    const ttlMinutes = ws?.sync_ttl_minutes || 5;

    let isExpired = true;
    if (cf.lastSyncedAt) {
      const lastSynced = new Date(cf.lastSyncedAt).getTime();
      const now = Date.now();
      isExpired = (now - lastSynced) > (ttlMinutes * 60 * 1000);
    }

    let driveId = c.req.query('driveId') || null;
    if (!driveId) {
      const driveRow = await c.get('fileService').findDriveIdForFolder(cf.id, userId);
      if (driveRow) {
        driveId = driveRow.id;
      }
    }

    if (isExpired && cf.syncStatus !== 'syncing') {
      c.executionCtx.waitUntil(performBackgroundSync(c.env, cf.id, driveId, userId));
    }
  }

  return c.json({ folder: currentFolder, subfolders, files, breadcrumb, pagination: { nextCursor, hasMore } });
});

// POST / — create folder or workspace
foldersRouter.post('/', zValidator('json', createFolderSchema, zodErrorHook), async (c) => {
  const folderService = c.get('folderService');
  const result = await folderService.createFolderOrWorkspace(c.get('userId'), c.req.valid('json'));
  return c.json(result);
});

// PUT /:id — update folder or workspace
foldersRouter.put('/:id', zValidator('json', updateFolderSchema, zodErrorHook), async (c) => {
  const folderService = c.get('folderService');
  await folderService.updateFolderOrWorkspace(c.get('userId'), c.req.param('id'), c.req.valid('json'));
  return c.json({ success: true });
});

// POST /:id/star
foldersRouter.post('/:id/star', async (c) => {
  const folderService = c.get('folderService');
  await folderService.starFolder(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

// POST /:id/unstar
foldersRouter.post('/:id/unstar', async (c) => {
  const folderService = c.get('folderService');
  await folderService.unstarFolder(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

// DELETE /:id — delete folder or workspace
foldersRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const folderService = c.get('folderService');

  // Try workspace deletion first (owner check inside service)
  const deleted = await folderService.deleteWorkspace(userId, folderId);
  if (deleted) {
    return c.json({ success: true });
  }

  // Not a workspace (or not owner) — try folder deletion
  await folderService.deleteFolder(userId, folderId);
  return c.json({ success: true });
});

// POST /:id/files — add files to folder or workspace
foldersRouter.post('/:id/files', zValidator('json', addFilesToFolderSchema, zodErrorHook), async (c) => {
  const folderService = c.get('folderService');
  const { fileIds } = c.req.valid('json');
  await folderService.addFilesToFolder(c.get('userId'), c.req.param('id'), fileIds);
  return c.json({ success: true });
});

// POST /:id/sync — sync all drives in a folder/workspace
foldersRouter.post('/:id/sync', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const db = c.env.DB;

  const { results } = await c.get('driveService').findDrivesForFolder(folderId, userId);

  if (results && results.length > 0) {
    const driveService = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
    for (const row of results) {
      const drive = mapDriveRow(row as unknown as Record<string, unknown>);
      c.executionCtx.waitUntil(syncDriveAccount(drive, db, driveService).catch(e => logError(c, 'Sync drive account failed', e)));
    }
  }

  return c.json({ success: true });
});

// POST /:id/force-sync — force sync a specific folder
foldersRouter.post('/:id/force-sync', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  let driveId = c.req.query('driveId') || null;

  if (!driveId) {
    const driveRow = await c.get('fileService').findDriveIdForFolder(folderId, userId);
    if (driveRow) {
      driveId = driveRow.id;
    }
  }

  if (!driveId) {
    const primaryDrive = await c.get('driveService').findPrimaryDriveId(userId);
    if (primaryDrive) {
      driveId = primaryDrive.id;
    }
  }

  if (!driveId) {
    throw new AppError(400, 'driveId is required or could not be determined');
  }

  c.executionCtx.waitUntil(performBackgroundSync(c.env, folderId, driveId, userId));

  return c.json({ success: true });
});
