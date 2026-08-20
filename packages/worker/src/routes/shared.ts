import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';

import type { AppContext } from '../types/context';
import { authGuard } from '../middleware/auth-guard';
import type { SharedLink } from '../types/domain';
import { createDriveService } from '../lib/drive-factory';
import { verifySharedPassword } from '../lib/password';
import { logError, log } from '../lib/logger';
import { isFileInSharedFolder } from '../lib/shared-folder';
import { sharedLinkCookieOptions } from '../lib/session-cookie';
import { buildDownloadTree } from '../services/download-tree';
import { NotFoundError, ValidationError, AuthError, AppError } from '../lib/errors';
import {
  createSharedLinkSchema,
  updateSharedLinkSchema,
  sharedLinkVerifySchema,
  sharedLinkEmailSchema,
  zodErrorHook,
} from '../lib/schemas';

export const sharedRouter = new Hono<AppContext>({ strict: false });

// ─── Shared validation helper (no SQL — uses cookies + JWT only) ───

async function validateSharedLink(
  c: Context<AppContext>,
  link: SharedLink,
): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  requiresPassword?: boolean;
  requiresEmail?: boolean;
}> {
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { ok: false, status: 410, error: 'Link expired' };
  }

  // requireEmail gate: visitor must have submitted an email (signed JWT cookie)
  if (link.requireEmail) {
    const emailCookie = getCookie(c, `shared_email_${link.id}`);
    if (!emailCookie) {
      return { ok: false, status: 403, error: 'Email required', requiresEmail: true };
    }
    try {
      const payload = await verify(emailCookie, c.env.JWT_SECRET, 'HS256');
      if (payload.id !== link.id || typeof payload.email !== 'string' || !payload.email) {
        return { ok: false, status: 403, error: 'Email required', requiresEmail: true };
      }
    } catch {
      return { ok: false, status: 403, error: 'Email required', requiresEmail: true };
    }
  }

  const requiresPassword = !!link.passwordHash;
  if (!requiresPassword) {
    return { ok: true };
  }

  const sessionCookie = getCookie(c, `shared_session_${link.id}`);
  if (sessionCookie) {
    try {
      const payload = await verify(sessionCookie, c.env.JWT_SECRET, 'HS256');
      if (payload.id === link.id && payload.kind === 'session') {
        return { ok: true };
      }
    } catch {
      // Invalid token
    }
  }

  return { ok: false, status: 401, error: 'Password required', requiresPassword: true };
}

// ─── Management Endpoints (Require Auth) ───

sharedRouter.post(
  '/',
  authGuard,
  zValidator('json', createSharedLinkSchema, zodErrorHook),
  async (c) => {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // ponytail: allowUploads not yet implemented — refuse to store a false promise
    if (body.allowUploads) {
      throw new ValidationError('Uploads via shared links are not yet supported');
    }

    const sharedService = c.get('sharedService');
    const id = await sharedService.createLink(userId, {
      targetType: body.targetType,
      targetId: body.targetId,
      password: body.password,
      expiresAt: body.expiresAt,
      allowDownloads: body.allowDownloads,
      allowUploads: body.allowUploads,
      maxDownloads: body.maxDownloads,
      requireEmail: body.requireEmail,
      webhookUrl: body.webhookUrl,
    });

    const baseUrl = c.env.FRONTEND_URL.replace(/\/$/, '');
    return c.json({ id, url: `${baseUrl}/shared/${id}` });
  },
);

sharedRouter.get('/', authGuard, async (c) => {
  const sharedService = c.get('sharedService');
  const links = await sharedService.listLinks(c.get('userId'));
  return c.json({ links });
});

sharedRouter.put(
  '/:id',
  authGuard,
  zValidator('json', updateSharedLinkSchema, zodErrorHook),
  async (c) => {
    const sharedService = c.get('sharedService');
    await sharedService.updateLink(c.get('userId'), c.req.param('id'), c.req.valid('json'));
    return c.body(null, 204);
  },
);

sharedRouter.delete('/:id', authGuard, async (c) => {
  const sharedService = c.get('sharedService');
  await sharedService.deleteLink(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

// ─── Public Endpoints (No Auth) ───

sharedRouter.get('/:id/meta', async (c) => {
  const sharedService = c.get('sharedService');
  const { link, target, targetName } = await sharedService.getPublicMeta(c.req.param('id'));

  const validation = await validateSharedLink(c, link);
  if (!validation.ok) {
    log(
      c,
      'warn',
      'Shared link validation failed',
      { status: validation.status },
      new Error(validation.error),
    );
    return c.json(
      {
        error: validation.error,
        requiresPassword: validation.requiresPassword,
        requiresEmail: validation.requiresEmail,
      },
      validation.status as 400 | 401 | 403 | 410 | 500,
    );
  }

  c.executionCtx.waitUntil(
    Promise.all([
      sharedService.incrementViewCount(link.id),
      sharedService.logAction(link.id, 'view'),
    ]),
  );

  if (link.targetType === 'file') {
    return c.json({ target, type: 'file' });
  }
  return c.json({ targetId: link.targetId, type: 'folder', targetName });
});

// Password verification for password-protected links
sharedRouter.post(
  '/:id/verify',
  zValidator('json', sharedLinkVerifySchema, zodErrorHook),
  async (c) => {
    const sharedService = c.get('sharedService');
    const link = await sharedService.getLinkForValidation(c.req.param('id'));
    if (!link) throw new NotFoundError('Link not found');

    // ponytail: check expiry before minting token — prevents password oracle on expired links
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      throw new AppError(410, 'Link expired');
    }

    if (!link.passwordHash) throw new ValidationError('Link does not require password');

    const { password } = c.req.valid('json');

    // ponytail: per-link lockout stops distributed brute-force beyond IP rate limit.
    // KV lockout logic stays in the route (needs c.env.KV, which SharedService doesn't receive).
    const lockKey = `shared_verify_lock:${link.id}`;
    const failKey = `shared_verify_fail:${link.id}`;
    if (await c.env.KV.get(lockKey)) {
      throw new AppError(429, 'Too many failed attempts. Try again later.');
    }

    const valid = await verifySharedPassword(password, link.passwordHash);
    if (!valid) {
      const failed = Number((await c.env.KV.get(failKey)) || '0') + 1;
      if (failed >= 20) {
        await c.env.KV.put(lockKey, '1', { expirationTtl: 15 * 60 });
        await c.env.KV.delete(failKey);
      } else {
        await c.env.KV.put(failKey, String(failed), { expirationTtl: 15 * 60 });
      }
      throw new AuthError('Invalid password');
    }

    await c.env.KV.delete(failKey);
    const token = await sign(
      { id: link.id, kind: 'session', exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 },
      c.env.JWT_SECRET,
      'HS256',
    );
    setCookie(c, `shared_session_${link.id}`, token, sharedLinkCookieOptions(c.env));
    return c.body(null, 204);
  },
);

// Email gate for requireEmail links — ponytail: no password needed, just record the email
sharedRouter.post(
  '/:id/email',
  zValidator('json', sharedLinkEmailSchema, zodErrorHook),
  async (c) => {
    const sharedService = c.get('sharedService');
    const link = await sharedService.getLinkForValidation(c.req.param('id'));
    if (!link) throw new NotFoundError('Link not found');

    if (!link.requireEmail) throw new ValidationError('This link does not require email');
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      throw new AppError(410, 'Link expired');
    }

    const { email } = c.req.valid('json');

    // JWT signing + cookie logic stays in route (needs c.env.JWT_SECRET)
    const emailToken = await sign(
      { id: link.id, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 },
      c.env.JWT_SECRET,
      'HS256',
    );
    setCookie(c, `shared_email_${link.id}`, emailToken, sharedLinkCookieOptions(c.env));

    c.executionCtx.waitUntil(sharedService.logAction(link.id, 'email_access', email));
    return c.body(null, 204);
  },
);

// GET /:id/download — stream the file (for file links) or a specific file
// inside the shared folder (for folder links, via ?fileId= query param).
sharedRouter.get('/:id/download', async (c) => {
  const sharedService = c.get('sharedService');
  const link = await sharedService.getLinkForValidation(c.req.param('id'));
  if (!link) return c.text('Not found', 404);

  const validation = await validateSharedLink(c, link);
  if (!validation.ok) {
    return c.text(
      validation.error || 'Unauthorized',
      validation.status as 400 | 401 | 403 | 410 | 500,
    );
  }

  if (!link.allowDownloads) {
    return c.text('Downloads are disabled for this link', 403);
  }

  const fileId = c.req.query('fileId');

  // Existing flow: single-file link (no fileId param)
  if (link.targetType === 'file' && !fileId) {
    const ctx = await sharedService.getDownloadContext(link);
    if (!ctx) return c.text('File not found', 404);
    const { file, driveAccountId } = ctx;

    const driveService = createDriveService(c.env);

    // Enforce download limit BEFORE opening Google Drive stream (prevents wasted subrequests)
    if (link.maxDownloads !== null && link.maxDownloads !== undefined) {
      const newCount = await sharedService.incrementDownloadCountWithLimit(link.id);
      if (newCount === null) return c.text('Maximum download limit reached', 403);
    } else {
      c.executionCtx.waitUntil(sharedService.incrementDownloadCount(link.id));
    }
    c.executionCtx.waitUntil(sharedService.logAction(link.id, 'download'));

    let stream: ReadableStream<Uint8Array>;
    let finalMimeType = (file.mime_type as string) || 'application/octet-stream';
    let finalFileName = file.name as string;

    try {
      const downloadResult = await driveService.downloadFile(
        driveAccountId,
        file.google_file_id,
        file.mime_type ?? undefined,
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

    if (link.webhookUrl) {
      c.executionCtx.waitUntil(
        fetch(link.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'download', linkId: link.id }),
          redirect: 'manual',
        }).catch(() => {}),
      );
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
  }

  // New flow: folder link with ?fileId= (download a specific file inside the folder)
  if (link.targetType === 'folder' && fileId) {
    const target = await sharedService.resolveFolderTarget(link);
    if (!target) return c.text('Folder not found', 404);
    const { driveId, googleFolderId } = target;

    const driveService = createDriveService(c.env);

    // Fetch metadata + parents in ONE API call (previously 2 calls: getFileParents
    // for the IDOR check + getFile for the download metadata). The parents feed
    // into isFileInSharedFolder; name + mimeType feed into the download below.
    const fileMeta = await driveService.getFileWithParents(driveId, fileId);
    if (!fileMeta) return c.text('File not found', 404);

    // IDOR prevention: verify the file is inside the shared folder tree.
    // Pass fileMeta.parents so isFileInSharedFolder skips its first getFileParents
    // call — reuses the parents already fetched by getFileWithParents.
    const isInside = await isFileInSharedFolder(
      driveService,
      driveId,
      fileId,
      googleFolderId,
      fileMeta.parents,
    );
    if (!isInside) return c.text('File not found in this shared folder', 404);

    // Enforce download limit BEFORE opening Google Drive stream (prevents wasted subrequests)
    if (link.maxDownloads !== null && link.maxDownloads !== undefined) {
      const newCount = await sharedService.incrementDownloadCountWithLimit(link.id);
      if (newCount === null) return c.text('Maximum download limit reached', 403);
    } else {
      c.executionCtx.waitUntil(sharedService.incrementDownloadCount(link.id));
    }
    c.executionCtx.waitUntil(sharedService.logAction(link.id, 'download'));

    let stream: ReadableStream<Uint8Array>;
    let finalMimeType = fileMeta.mimeType || 'application/octet-stream';
    let finalFileName = fileMeta.name;

    try {
      const downloadResult = await driveService.downloadFile(
        driveId,
        fileId,
        fileMeta.mimeType ?? undefined,
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
    return c.body(stream);
  }

  return c.text('Use GET /:id/download-tree for folder downloads', 400);
});

// GET /:id/folder-contents — list a shared folder's contents (for browsing)
sharedRouter.get('/:id/folder-contents', async (c) => {
  const sharedService = c.get('sharedService');
  const link = await sharedService.getLinkForValidation(c.req.param('id'));
  if (!link) return c.text('Not found', 404);

  const validation = await validateSharedLink(c, link);
  if (!validation.ok) {
    log(
      c,
      'warn',
      'Shared link validation failed',
      { status: validation.status },
      new Error(validation.error),
    );
    return c.json(
      {
        error: validation.error,
        requiresPassword: validation.requiresPassword,
        requiresEmail: validation.requiresEmail,
      },
      validation.status as 400 | 401 | 403 | 410 | 500,
    );
  }

  if (link.targetType !== 'folder') return c.text('Not a folder link', 400);

  const target = await sharedService.resolveFolderTarget(link);
  if (!target) return c.text('Folder not found', 404);
  const { driveId, googleFolderId } = target;

  const driveService = createDriveService(c.env);
  const { files, folders } = await driveService.listFolderContents(driveId, googleFolderId);

  return c.json({
    folder: null,
    subfolders: folders.map((f) => ({ id: f.id, name: f.name })),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: parseInt(f.size ?? '0', 10),
      thumbnailUrl: f.thumbnailLink ?? null,
    })),
    breadcrumb: [],
  });
});

// GET /:id/download-tree — recursive tree for client-side ZIP (folder links)
// Tree-walk logic lives in services/download-tree.ts (shared with drives.ts).
sharedRouter.get('/:id/download-tree', async (c) => {
  const sharedService = c.get('sharedService');
  const link = await sharedService.getLinkForValidation(c.req.param('id'));
  if (!link) return c.text('Not found', 404);

  const validation = await validateSharedLink(c, link);
  if (!validation.ok) {
    log(
      c,
      'warn',
      'Shared link validation failed',
      { status: validation.status },
      new Error(validation.error),
    );
    return c.json(
      {
        error: validation.error,
        requiresPassword: validation.requiresPassword,
        requiresEmail: validation.requiresEmail,
      },
      validation.status as 400 | 401 | 403 | 410 | 500,
    );
  }

  if (!link.allowDownloads) return c.text('Downloads are disabled', 403);
  if (link.targetType !== 'folder') return c.text('Not a folder link', 400);

  const target = await sharedService.resolveFolderTarget(link);
  if (!target) return c.text('Folder not found', 404);
  const { driveId, googleFolderId, rootName } = target;

  const driveService = createDriveService(c.env);
  const { files, truncated } = await buildDownloadTree({
    driveService,
    driveId,
    rootFolderId: googleFolderId,
  });

  // Do NOT increment the download count here — /download-tree returns a file
  // listing, not an actual file download. The count is incremented on the
  // per-file /download?fileId=... endpoint (which streams the file content).
  // Counting the tree listing would consume a download slot before the user
  // downloads any files.
  c.executionCtx.waitUntil(sharedService.logAction(link.id, 'download-tree'));

  return c.json({ files, rootName, truncated });
});
