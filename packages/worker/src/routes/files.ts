import type { DbFile } from '../services/automation.service';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { AppError } from '../middleware/error-handler';
import { GoogleDriveService } from '../services/google-drive';
import { resolveDrivesWithQuota } from '../services/drive-quota';
import { UploadRouter } from '../services/upload-router';
import { AutomationEngine } from '../services/automation.service';
import { PolicyService } from '../services/policy.service';
import { logError } from '../lib/logger';
import { mapFileRow } from '../types';
import { zValidator } from '@hono/zod-validator';
import {
  renameFileSchema,
  moveFileSchema,
  moveDriveFileSchema,
  uploadInitSchema,
  uploadFinalizeSchema,
  fileMetadataSchema,
  zodErrorHook,
} from '../lib/schemas';

export const filesRouter = new Hono<AppContext>({ strict: false });

filesRouter.use('*', authGuard);

// GET /api/files/recent
// Access via ownership OR workspace membership (EXISTS in repository SQL).
filesRouter.get('/recent', async (c) => {
  const data = await c.get('fileService').listRecent(c.get('userId'));
  return c.json(data);
});

// GET /api/files/category-overview
filesRouter.get('/category-overview', async (c) => {
  const overview = await c.get('fileService').getCategoryOverview(c.get('userId'));
  return c.json(overview);
});

// GET /api/files/search
filesRouter.get('/search', async (c) => {
  const data = await c.get('fileService').searchFiles(
    c.get('userId'),
    c.req.query('q') || null,
    c.req.query('workspaceId') || null,
    c.req.query('metadata') || null,
  );
  return c.json(data);
});


// GET /api/files/starred
filesRouter.get('/starred', async (c) => {
  const data = await c.get('fileService').getStarred(c.get('userId'));
  return c.json(data);
});

// Move file to trash (Google Drive trash + DB is_trashed=1)
filesRouter.delete('/:id', async (c) => {
  const fileService = c.get('fileService');
  await fileService.trashFile(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

// Rename file
filesRouter.patch('/:id/rename', zValidator('json', renameFileSchema, zodErrorHook), async (c) => {
  const fileService = c.get('fileService');
  const { name } = c.req.valid('json');
  await fileService.renameFile(c.get('userId'), c.req.param('id'), name);
  return c.json({ success: true });
});

// Move file to different virtual folder
filesRouter.patch('/:id/move', zValidator('json', moveFileSchema, zodErrorHook), async (c) => {
  const fileService = c.get('fileService');
  const { workspaceFolderId } = c.req.valid('json');
  await fileService.moveToWorkspaceFolder(c.get('userId'), c.req.param('id'), workspaceFolderId ?? null);
  return c.json({ success: true });
});

// Move file to another drive
filesRouter.post('/:id/move-drive', zValidator('json', moveDriveFileSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const { targetDriveId } = c.req.valid('json');

  const fileService = c.get('fileService');
  const file = await fileService.getForMoveDrive(userId, fileId) as { driveEmail: string; sourceDriveId: string; google_file_id: string; name: string };

  if (file.sourceDriveId === targetDriveId) {
    throw new AppError(400, 'File is already in the target drive');
  }

  const targetDrive = await c.get('driveService').findByIdAndUser(targetDriveId, userId) as { id: string; email: string } | null;

  if (!targetDrive) {
    throw new AppError(404, 'Target drive not found or unauthorized');
  }

  const driveService = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);

  let sharePermissionId: string | null = null;
  let copySuccessId: string | null = null;
  let trashSuccess = false;

  try {
    sharePermissionId = await driveService.shareFile(
      file.sourceDriveId,
      file.google_file_id,
      targetDrive.email,
      'writer'
    );

    const copiedFile = await driveService.copyFile(
      targetDriveId,
      file.google_file_id,
      file.name
    );
    copySuccessId = copiedFile.id;

    try {
      if (sharePermissionId) {
        await driveService.revokeShare(file.sourceDriveId, file.google_file_id, sharePermissionId);
        sharePermissionId = null;
      }
    } catch (revokeError) {
      logError(c, 'Failed to revoke share after copy', revokeError);
    }

    try {
      await driveService.trashFile(file.sourceDriveId, file.google_file_id);
      trashSuccess = true;
    } catch (trashError) {
      logError(c, 'Failed to trash original file', trashError);
    }

    await c.get('fileService').updateDriveAssignment(fileId, targetDriveId, copiedFile.id);

    const updatedFile = await c.get('fileService').findById(fileId);

    return c.json({ file: mapFileRow((updatedFile as unknown as Record<string, unknown>)), success: true });
  } catch (error) {
    logError(c, 'Move drive failed', error);
    
    if (trashSuccess) {
      try { await driveService.untrashFile(file.sourceDriveId, file.google_file_id); }
      catch (e) { logError(c, 'Rollback untrash failed', e); }
    }
    
    if (copySuccessId) {
      try { await driveService.deleteFile(targetDriveId, copySuccessId); }
      catch (e) { logError(c, 'Rollback delete failed', e); }
    }
    
    if (sharePermissionId) {
      try { await driveService.revokeShare(file.sourceDriveId, file.google_file_id, sharePermissionId); }
      catch (e) { logError(c, 'Failed to revoke share', e); }
    }
    
    throw new AppError(500, 'Failed to move file to another drive');
  }
});

// Initialize upload (returns Google Drive Resumable URL)
// Proxy direct-to-Google upload bytes through Worker (Google resumable endpoints
// don't set CORS headers, so browser can't PUT directly)
filesRouter.put('/upload/proxy', async (c) => {
  const uploadUrl = c.req.header('X-Upload-Url');
  if (!uploadUrl) throw new AppError(400, 'Missing X-Upload-Url header');

  const contentLength = c.req.header('Content-Length');
  const contentType = c.req.header('Content-Type') || 'application/octet-stream';
  const contentRange = c.req.header('Content-Range');

  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };
  if (contentLength) headers['Content-Length'] = contentLength;
  if (contentRange) headers['Content-Range'] = contentRange;

  // Stream the request body straight to Google instead of buffering it in RAM
  // (arrayBuffer() would hold the whole file, crashing the Worker's 128MB limit
  // on large uploads). duplex: 'half' is required to send a streaming body.
  // ponytail: `as any` — RequestInit's type lacks `duplex`, which the Workers runtime supports.
  const googleResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: c.req.raw.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  const responseBody = await googleResponse.text();

  const cleanHeaders = new Headers();
  googleResponse.headers.forEach((v, k) => {
    if (!['access-control-allow-origin', 'access-control-allow-credentials'].includes(k.toLowerCase())) {
      cleanHeaders.set(k, v);
    }
  });

  return new Response(responseBody, {
    status: googleResponse.status,
    headers: cleanHeaders,
  });
});

filesRouter.post('/upload/init', zValidator('json', uploadInitSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  // parentFolderId is the Google Drive folder id the user is currently viewing
  // ('root' at top level), NOT a workspace_folders id. It controls where the
  // resumable upload's `parents` point, so files land in the right Drive folder.
  const { name, mimeType, size, parentFolderId, workspaceId, driveAccountId } = c.req.valid('json');
  const db = c.env.DB;

  if (workspaceId) {
    // IDOR/quota guard: workspaceId comes from the request body, so verify the
    // caller is an editor of that workspace before touching its quota.
    const { getWorkspaceRole, hasPermission } = await import('../middleware/rbac');
    const role = await getWorkspaceRole(db, workspaceId, userId);
    if (!role || !hasPermission(role, 'editor')) {
      throw new AppError(403, 'Forbidden');
    }
  }

  if (workspaceId && size) {
    const policyService = new PolicyService(db, new GoogleDriveService(db, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY));
    const hasQuota = await policyService.checkQuota(workspaceId, size);
    if (!hasQuota) {
      return c.json({ error: 'Storage quota exceeded' }, 403);
    }
  }

  const drives = await resolveDrivesWithQuota(c.env, db, userId, (driveId, total, used) => {
    c.executionCtx.waitUntil(
      db.prepare('UPDATE drive_accounts SET total_quota = ?, used_quota = ?, quota_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(total, used, driveId)
        .run()
    );
  });
  if (drives.length === 0) throw new AppError(400, 'No connected drives');

  const driveIds = drives.map(d => d.id);
  const { results: tokenRows } = await c.get('driveService').findDrivesWithTokens(driveIds);
  if (!tokenRows?.length) {
    throw new AppError(400, 'Google Drive session expired. Disconnect and reconnect your account in Settings.');
  }

  const router = new UploadRouter(drives);
  const targetDrive = router.selectDriveForUpload(size, driveAccountId);

  const gDrive = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
  // parentFolderId (current view) wins; fall back to the drive's configured root folder, then Google 'root'.
  const uploadParent = parentFolderId || targetDrive.rootFolderId || 'root';
  let uploadUrl: string;
  try {
    uploadUrl = await gDrive.initiateResumableUpload(targetDrive.id, name, mimeType, uploadParent);
  } catch (err) {
    const msg = (err as Error).message || '';
    logError(c, 'upload/init initiateResumableUpload failed', undefined, { driveId: targetDrive.id, uploadParent, msg });
    // Auth/refresh failures → 401 so the client can prompt reconnect; upstream Google errors → 502.
    const status = /token|refresh|No tokens|expired/i.test(msg) ? 401 : 502;
    throw new AppError(status, `Failed to start resumable upload: ${msg}`);
  }

  // Return the URL so the client can stream bytes to Google via the proxy.
  return c.json({
    uploadUrl,
    driveAccountId: targetDrive.id,
    googleFolderId: uploadParent,
  });
});

filesRouter.post('/upload/finalize', zValidator('json', uploadFinalizeSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  // parentFolderId is the Google Drive folder id ('root' at top level) the file
  // was uploaded into. It goes into files.google_parent_id so the file appears in
  // the folder the user is viewing (drives.ts lists files by google_parent_id).
  // Do NOT put it in workspace_folder_id — that column is FK→workspace_folders and
  // 'root'/a Google folder id is not a workspace folder, which throws a FK
  // constraint violation (the previous 500 root cause).
  const { googleFileId, driveAccountId, parentFolderId, workspaceFolderId, workspaceId } = c.req.valid('json');

  // Verify drive belongs to user
  const db = c.env.DB;

  if (workspaceId) {
    // IDOR/quota guard: workspaceId comes from the request body. Verify the
    // caller is an editor before attaching the file to the workspace or
    // mutating its stored byte count.
    const { getWorkspaceRole, hasPermission } = await import('../middleware/rbac');
    const role = await getWorkspaceRole(db, workspaceId, userId);
    if (!role || !hasPermission(role, 'editor')) {
      throw new AppError(403, 'Forbidden');
    }
  }

  const drive = await c.get('driveService').findByIdAndUser(driveAccountId, userId);

  if (!drive) {
    throw new AppError(404, 'Drive account not found or unauthorized');
  }

  // Fetch file metadata from Google Drive
  const driveService = new GoogleDriveService(c.env.DB, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
  let gFile;
  try {
    gFile = await driveService.getFile(driveAccountId, googleFileId);
  } catch (err) {
    logError(c, 'Upload finalize getFile error', err, { googleFileId, driveAccountId });
    throw new AppError(400, 'Failed to fetch uploaded file from Google Drive');
  }

  const id = generateId();
  const fileSize = parseInt(gFile.size || '0', 10);
  // Only set workspace_folder_id when a genuine workspace folder id is provided
  // (workspace upload context). The Drive-folder view passes parentFolderId only.
  const wsFolder = workspaceFolderId || null;
  const googleParent = parentFolderId || null;
  
  const created = await c.get('fileService').finalizeUpload(userId, {
    id,
    driveAccountId,
    workspaceId: workspaceId || null,
    workspaceFolderId: wsFolder,
    googleFileId: gFile.id,
    googleParentId: googleParent,
    name: gFile.name,
    mimeType: gFile.mimeType,
    size: fileSize,
    thumbnailUrl: gFile.thumbnailLink || null,
    webViewLink: gFile.webViewLink || null,
    webContentLink: gFile.webContentLink || null,
    googleCreatedAt: gFile.createdTime,
    googleModifiedAt: gFile.modifiedTime,
  });

  if (workspaceId && fileSize > 0) {
    const policyService = new PolicyService(db, driveService);
    await policyService.updateWorkspaceStorage(workspaceId, fileSize);
  }

  // Invalidate quota cache
  await c.get('driveService').deleteQuotaCache(driveAccountId);

  const engine = new AutomationEngine(c.env);
  c.executionCtx.waitUntil(engine.processEventTrigger({ ...(created as Record<string, unknown>), user_id: userId } as DbFile, c.executionCtx as unknown as ExecutionContext));

  return c.json({ file: mapFileRow((created as Record<string, unknown>)), success: true }, 201);
});

// GET /api/files/trash
filesRouter.get('/trash', async (c) => {
  const data = await c.get('fileService').getTrash(c.get('userId'));
  return c.json(data);
});

// POST /api/files/:id/restore
filesRouter.post('/:id/restore', async (c) => {
  const fileService = c.get('fileService');
  await fileService.restoreFile(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});


filesRouter.post('/:id/star', async (c) => {
  const fileService = c.get('fileService');
  await fileService.starFile(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

filesRouter.post('/:id/unstar', async (c) => {
  const fileService = c.get('fileService');
  await fileService.unstarFile(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

// DELETE /api/files/:id/permanent
filesRouter.delete('/:id/permanent', async (c) => {
  const fileService = c.get('fileService');
  await fileService.permanentDelete(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

filesRouter.patch('/:id/metadata', zValidator('json', fileMetadataSchema, zodErrorHook), async (c) => {
  const fileService = c.get('fileService');
  const { metadata } = c.req.valid('json');
  await fileService.updateMetadata(c.get('userId'), c.req.param('id'), metadata);
  return c.json({ success: true });
});

function isPreviewableImageMime(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/vnd.google-apps.photo';
}

// GET /api/files/:id/preview — inline image stream for authenticated preview
filesRouter.get('/:id/preview', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const fileService = c.get('fileService');

  const file = await fileService.getFileForRead(userId, fileId);

  const mimeType = (file.mime_type as string) || '';
  if (!isPreviewableImageMime(mimeType)) {
    throw new AppError(415, 'Preview not available for this file type');
  }

  const driveService = fileService.getGoogleDriveService();

  let stream: ReadableStream<Uint8Array>;
  let finalMimeType = mimeType === 'application/vnd.google-apps.photo' ? 'image/jpeg' : mimeType;

  try {
    const downloadResult = await driveService.downloadFile(
      file.drive_account_id as string,
      file.google_file_id as string,
      file.mime_type as string
    );
    stream = downloadResult.stream;
    if (downloadResult.exportedMimeType) {
      finalMimeType = downloadResult.exportedMimeType;
    }
  } catch (e: unknown) {
    logError(c, 'Preview error', e);
    return c.text('Failed to load preview', 502);
  }

  c.header('Content-Type', finalMimeType);
  c.header('Content-Disposition', 'inline');
  c.header('Cache-Control', 'private, max-age=300');
  if (file.size) {
    c.header('Content-Length', String(file.size));
  }

  return c.body(stream);
});

// GET /api/files/:id/download
filesRouter.get('/:id/download', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const fileService = c.get('fileService');

  const file = await fileService.getFileForRead(userId, fileId);

  const driveService = fileService.getGoogleDriveService();

  let stream: ReadableStream<Uint8Array>;
  let finalMimeType = (file.mime_type as string) || 'application/octet-stream';
  let finalFileName = file.name as string;

  try {
    const downloadResult = await driveService.downloadFile(
      file.drive_account_id as string,
      file.google_file_id as string,
      file.mime_type as string
    );
    stream = downloadResult.stream;
    
    if (downloadResult.exportedMimeType && downloadResult.exportedExtension) {
      finalMimeType = downloadResult.exportedMimeType;
      finalFileName = `${finalFileName}${downloadResult.exportedExtension}`;
    }
  } catch (e: unknown) {
    logError(c, 'Download error', e);
    return c.text('Failed to download file', 502);
  }
  
  c.header('Content-Type', finalMimeType);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(finalFileName)}`);
  if (file.size && !finalFileName.endsWith('.pdf') && !finalFileName.endsWith('.xlsx')) {
    c.header('Content-Length', String(file.size));
  }
  
  return c.body(stream);
});
