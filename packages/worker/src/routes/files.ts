import type { DbFile } from '../services/automation.service';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { createDriveService } from '../middleware/shared-services';
import { AppError, ConflictError, NotFoundError, ForbiddenError } from '../lib/errors';
import { DriveRepository } from '../repositories/drive.repository';
import { resolveDrivesWithQuota } from '../services/drive-quota';
import { UploadRouter } from '../services/upload-router';
import { AutomationEngine } from '../services/automation.service';
import { PolicyService } from '../services/policy.service';
import { logError } from '../lib/logger';
import { mapFileRow } from '../types/db';
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

// Google hosts permitted for resumable upload proxying (SSRF guard).
const ALLOWED_UPLOAD_HOSTS = new Set([
  'www.googleapis.com',
  'upload.googleapis.com',
  'storage.googleapis.com',
  'www.googleusercontent.com',
  'lh3.googleusercontent.com',
  'drive.google.com',
]);

/** Validate X-Upload-Url points to an allowed Google host over HTTPS (SSRF guard). */
function validateUploadUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'Invalid upload URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(400, 'Upload URL must use HTTPS');
  }
  if (!ALLOWED_UPLOAD_HOSTS.has(parsed.hostname)) {
    throw new AppError(400, 'Disallowed upload URL host');
  }
  return parsed;
}

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
  const data = await c
    .get('fileService')
    .searchFiles(
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
  return c.body(null, 204);
});

// Rename file
filesRouter.patch('/:id/rename', zValidator('json', renameFileSchema, zodErrorHook), async (c) => {
  const fileService = c.get('fileService');
  const { name } = c.req.valid('json');
  await fileService.renameFile(c.get('userId'), c.req.param('id'), name);
  return c.body(null, 204);
});

// Move file to different virtual folder
filesRouter.patch('/:id/move', zValidator('json', moveFileSchema, zodErrorHook), async (c) => {
  const fileService = c.get('fileService');
  const { workspaceFolderId } = c.req.valid('json');
  await fileService.moveToWorkspaceFolder(
    c.get('userId'),
    c.req.param('id'),
    workspaceFolderId ?? null,
  );
  return c.body(null, 204);
});

// Move file to another drive
filesRouter.post(
  '/:id/move-drive',
  zValidator('json', moveDriveFileSchema, zodErrorHook),
  async (c) => {
    const userId = c.get('userId');
    const fileId = c.req.param('id');
    const { targetDriveId } = c.req.valid('json');

    const fileService = c.get('fileService');
    const file = (await fileService.getForMoveDrive(userId, fileId)) as {
      driveEmail: string;
      sourceDriveId: string;
      google_file_id: string;
      name: string;
    };

    if (file.sourceDriveId === targetDriveId) {
      throw new ConflictError('File is already in the target drive');
    }

    const targetDrive = (await c.get('driveService').findByIdAndUser(targetDriveId, userId)) as {
      id: string;
      email: string;
    } | null;

    if (!targetDrive) {
      throw new NotFoundError('Target drive not found or unauthorized');
    }

    const driveService = createDriveService(c.env);

    let sharePermissionId: string | null = null;
    let copySuccessId: string | null = null;

    try {
      sharePermissionId = await driveService.shareFile(
        file.sourceDriveId,
        file.google_file_id,
        targetDrive.email,
        'writer',
      );

      const copiedFile = await driveService.copyFile(targetDriveId, file.google_file_id, file.name);
      copySuccessId = copiedFile.id;

      try {
        if (sharePermissionId) {
          await driveService.revokeShare(
            file.sourceDriveId,
            file.google_file_id,
            sharePermissionId,
          );
          sharePermissionId = null;
        }
      } catch (revokeError) {
        logError(c, 'Failed to revoke share after copy', revokeError);
      }

      // Update D1 BEFORE trashing — if D1 fails, the original is still alive.
      // Trash is best-effort (happens last, after D1 succeeds).
      await c.get('fileService').updateDriveAssignment(fileId, targetDriveId, copiedFile.id);

      try {
        await driveService.trashFile(file.sourceDriveId, file.google_file_id);
      } catch (trashError) {
        logError(c, 'Failed to trash original file', trashError);
      }

      // Invalidate quota cache for both drives — the move changes used space
      // on each. Non-blocking: the cache is read on next /api/drives/ GET,
      // which will refetch from Google.
      c.executionCtx.waitUntil(
        Promise.all([
          c.get('driveService').deleteQuotaCache(file.sourceDriveId),
          c.get('driveService').deleteQuotaCache(targetDriveId),
        ]).catch((e) => logError(c, 'Quota cache invalidation failed', e)),
      );

      const updatedFile = await c.get('fileService').findById(fileId);

      return c.json({
        file: mapFileRow(updatedFile as unknown as Record<string, unknown>),
      });
    } catch (error) {
      logError(c, 'Move drive failed', error);

      // No untrash needed — trash happens after D1 update, so if we're in
      // the catch block, either D1 failed (trash never ran) or trash failed
      // (best-effort, already logged, move should still succeed).
      if (copySuccessId) {
        try {
          await driveService.deleteFile(targetDriveId, copySuccessId);
        } catch (e) {
          logError(c, 'Rollback delete failed', e);
        }
      }

      if (sharePermissionId) {
        try {
          await driveService.revokeShare(
            file.sourceDriveId,
            file.google_file_id,
            sharePermissionId,
          );
        } catch (e) {
          logError(c, 'Failed to revoke share', e);
        }
      }

      throw new AppError(500, 'Failed to move file to another drive');
    }
  },
);

// Initialize upload (returns Google Drive Resumable URL)
// Proxy direct-to-Google upload bytes through Worker (Google resumable endpoints
// don't set CORS headers, so browser can't PUT directly)
filesRouter.put('/upload/proxy', async (c) => {
  const rawUploadUrl = c.req.header('X-Upload-Url');
  if (!rawUploadUrl) throw new AppError(400, 'Missing X-Upload-Url header');
  const uploadUrl = validateUploadUrl(rawUploadUrl);

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
  const googleResponse = await fetch(uploadUrl.href, {
    method: 'PUT',
    headers,
    body: c.req.raw.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  const responseBody = await googleResponse.text();

  const cleanHeaders = new Headers();
  googleResponse.headers.forEach((v, k) => {
    if (
      !['access-control-allow-origin', 'access-control-allow-credentials'].includes(k.toLowerCase())
    ) {
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
    const { getWorkspaceRole, hasPermission } = await import('../lib/rbac');
    const role = await getWorkspaceRole(db, workspaceId, userId);
    if (!role || !hasPermission(role, 'editor')) {
      throw new ForbiddenError();
    }
  }

  if (workspaceId && size) {
    const policyService = new PolicyService(db, createDriveService(c.env));
    const hasQuota = await policyService.checkQuota(workspaceId, size);
    if (!hasQuota) {
      return c.json({ error: 'Storage quota exceeded' }, 403);
    }
  }

  const drives = await resolveDrivesWithQuota(c.env, db, userId, (driveId, total, used) => {
    const driveRepo = new DriveRepository(db);
    c.executionCtx.waitUntil(driveRepo.updateQuota(driveId, total, used));
  });
  if (drives.length === 0) throw new AppError(400, 'No connected drives');

  const driveIds = drives.map((d) => d.id);
  const { results: tokenRows } = await c.get('driveService').findDrivesWithTokens(driveIds);
  if (!tokenRows?.length) {
    throw new AppError(
      400,
      'Google Drive session expired. Disconnect and reconnect your account in Settings.',
    );
  }

  const router = new UploadRouter(drives);
  const targetDrive = router.selectDriveForUpload(size, driveAccountId);

  const gDrive = createDriveService(c.env);
  // parentFolderId (current view) wins; fall back to the drive's configured root folder, then Google 'root'.
  const uploadParent = parentFolderId || targetDrive.rootFolderId || 'root';
  let uploadUrl: string;
  try {
    uploadUrl = await gDrive.initiateResumableUpload(targetDrive.id, name, mimeType, uploadParent);
  } catch (err) {
    const msg = (err as Error).message || '';
    logError(c, 'upload/init initiateResumableUpload failed', undefined, {
      driveId: targetDrive.id,
      uploadParent,
      msg,
    });
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

filesRouter.post(
  '/upload/finalize',
  zValidator('json', uploadFinalizeSchema, zodErrorHook),
  async (c) => {
    const userId = c.get('userId');
    // parentFolderId is the Google Drive folder id ('root' at top level) the file
    // was uploaded into. It goes into files.google_parent_id so the file appears in
    // the folder the user is viewing (drives.ts lists files by google_parent_id).
    // Do NOT put it in workspace_folder_id — that column is FK→workspace_folders and
    // 'root'/a Google folder id is not a workspace folder, which throws a FK
    // constraint violation (the previous 500 root cause).
    const { googleFileId, driveAccountId, parentFolderId, workspaceFolderId, workspaceId } =
      c.req.valid('json');

    // Verify drive belongs to user
    const db = c.env.DB;

    if (workspaceId) {
      // IDOR/quota guard: workspaceId comes from the request body. Verify the
      // caller is an editor before attaching the file to the workspace or
      // mutating its stored byte count.
      const { getWorkspaceRole, hasPermission } = await import('../lib/rbac');
      const role = await getWorkspaceRole(db, workspaceId, userId);
      if (!role || !hasPermission(role, 'editor')) {
        throw new ForbiddenError();
      }
    }

    const drive = await c.get('driveService').findByIdAndUser(driveAccountId, userId);

    if (!drive) {
      throw new NotFoundError('Drive account not found or unauthorized');
    }

    // Fetch file metadata from Google Drive
    const driveService = createDriveService(c.env);
    let gFile;
    try {
      gFile = await driveService.getFile(driveAccountId, googleFileId);
    } catch (err) {
      logError(c, 'Upload finalize getFile error', err, { googleFileId, driveAccountId });
      throw new AppError(400, 'Failed to fetch uploaded file from Google Drive');
    }

    const id = generateId();
    const fileSize = parseInt(gFile.size || '0', 10);

    // Re-check quota with ACTUAL size (from Google) before creating the D1 row.
    // Init checks the client-declared size; a client can declare size:1 at init
    // and stream more bytes through the proxy. Google records the real size —
    // use it here. Placed BEFORE finalizeUpload so a failed check creates no
    // D1 row (no cleanup needed, no Trash-UI pollution).
    if (workspaceId && fileSize > 0) {
      const policyService = new PolicyService(db, driveService);
      const hasQuota = await policyService.checkQuota(workspaceId, fileSize);
      if (!hasQuota) {
        // File is already on Google Drive (can't un-upload). Trash best-effort.
        try {
          await driveService.trashFile(driveAccountId, gFile.id);
        } catch {
          /* best-effort — quota rejection is the primary signal */
        }
        throw new AppError(403, 'Storage quota exceeded');
      }
    }

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

    const engine = new AutomationEngine(c.env, createDriveService(c.env));
    c.executionCtx.waitUntil(
      engine.processEventTrigger(
        { ...(created as Record<string, unknown>), user_id: userId } as DbFile,
        c.executionCtx as unknown as ExecutionContext,
      ),
    );

    return c.json({ file: mapFileRow(created as Record<string, unknown>) }, 201);
  },
);

// GET /api/files/trash
filesRouter.get('/trash', async (c) => {
  const data = await c.get('fileService').getTrash(c.get('userId'));
  return c.json(data);
});

// POST /api/files/:id/restore
filesRouter.post('/:id/restore', async (c) => {
  const fileService = c.get('fileService');
  await fileService.restoreFile(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

filesRouter.post('/:id/star', async (c) => {
  const fileService = c.get('fileService');
  await fileService.starFile(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

filesRouter.post('/:id/unstar', async (c) => {
  const fileService = c.get('fileService');
  await fileService.unstarFile(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

// DELETE /api/files/:id/permanent
filesRouter.delete('/:id/permanent', async (c) => {
  const fileService = c.get('fileService');
  await fileService.permanentDelete(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

filesRouter.patch(
  '/:id/metadata',
  zValidator('json', fileMetadataSchema, zodErrorHook),
  async (c) => {
    const fileService = c.get('fileService');
    const { metadata } = c.req.valid('json');
    await fileService.updateMetadata(c.get('userId'), c.req.param('id'), metadata);
    return c.body(null, 204);
  },
);

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
      file.mime_type as string,
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
      file.mime_type as string,
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
  c.header(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(finalFileName)}`,
  );
  if (file.size && !finalFileName.endsWith('.pdf') && !finalFileName.endsWith('.xlsx')) {
    c.header('Content-Length', String(file.size));
  }

  return c.body(stream);
});
