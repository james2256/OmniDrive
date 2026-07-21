import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';

import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import type { SharedLink } from '../types';
import { GoogleDriveService } from '../services/google-drive';
import { verifySharedPassword } from '../lib/password';
import { logError } from '../lib/logger';
import {
  createSharedLinkSchema,
  updateSharedLinkSchema,
  sharedLinkVerifySchema,
  sharedLinkEmailSchema,
  zodErrorHook,
} from '../lib/schemas';

export const sharedRouter = new Hono<AppContext>({ strict: false });

// ─── Shared validation helper (no SQL — uses cookies + JWT only) ───

async function validateSharedLink(c: Context<AppContext>, link: SharedLink): Promise<{ ok: boolean; status?: number; error?: string; requiresPassword?: boolean; requiresEmail?: boolean }> {
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
      if (payload.id === link.id) {
        return { ok: true };
      }
    } catch {
      // Invalid token
    }
  }

  return { ok: false, status: 401, error: 'Password required', requiresPassword: true };
}

// ─── Management Endpoints (Require Auth) ───

sharedRouter.post('/', authGuard, zValidator('json', createSharedLinkSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  // ponytail: allowUploads not yet implemented — refuse to store a false promise
  if (body.allowUploads) {
    return c.json({ error: 'Uploads via shared links are not yet supported' }, 400);
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
});

sharedRouter.get('/', authGuard, async (c) => {
  const sharedService = c.get('sharedService');
  const links = await sharedService.listLinks(c.get('userId'));
  return c.json({ links });
});

sharedRouter.put('/:id', authGuard, zValidator('json', updateSharedLinkSchema, zodErrorHook), async (c) => {
  const sharedService = c.get('sharedService');
  await sharedService.updateLink(c.get('userId'), c.req.param('id'), c.req.valid('json'));
  return c.json({ success: true });
});

sharedRouter.delete('/:id', authGuard, async (c) => {
  const sharedService = c.get('sharedService');
  await sharedService.deleteLink(c.get('userId'), c.req.param('id'));
  return c.json({ success: true });
});

// ─── Public Endpoints (No Auth) ───

sharedRouter.get('/:id/meta', async (c) => {
  const sharedService = c.get('sharedService');
  const { link, target } = await sharedService.getPublicMeta(c.req.param('id'));

  const validation = await validateSharedLink(c, link);
  if (!validation.ok) {
    return c.json({ error: validation.error, requiresPassword: validation.requiresPassword, requiresEmail: validation.requiresEmail }, validation.status as 400 | 401 | 403 | 410 | 500);
  }

  c.executionCtx.waitUntil(Promise.all([
    sharedService.incrementViewCount(link.id),
    sharedService.logAction(link.id, 'view'),
  ]));

  if (link.targetType === 'file') {
    return c.json({ target, type: 'file' });
  }
  return c.json({ targetId: link.targetId, type: 'folder' });
});

// Password verification for password-protected links
sharedRouter.post('/:id/verify', zValidator('json', sharedLinkVerifySchema, zodErrorHook), async (c) => {
  const sharedService = c.get('sharedService');
  const link = await sharedService.getLinkForValidation(c.req.param('id'));
  if (!link) return c.json({ error: 'Link not found' }, 404);

  // ponytail: check expiry before minting token — prevents password oracle on expired links
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return c.json({ error: 'Link expired' }, 410);
  }

  if (!link.passwordHash) return c.json({ error: 'Link does not require password' }, 400);

  const { password } = c.req.valid('json');

  // ponytail: per-link lockout stops distributed brute-force beyond IP rate limit.
  // KV lockout logic stays in the route (needs c.env.KV, which SharedService doesn't receive).
  const lockKey = `shared_verify_lock:${link.id}`;
  const failKey = `shared_verify_fail:${link.id}`;
  if (await c.env.KV.get(lockKey)) {
    return c.json({ error: 'Too many failed attempts. Try again later.' }, 429);
  }

  const valid = await verifySharedPassword(password, link.passwordHash);
  if (!valid) {
    const failed = Number(await c.env.KV.get(failKey) || '0') + 1;
    if (failed >= 20) {
      await c.env.KV.put(lockKey, '1', { expirationTtl: 15 * 60 });
      await c.env.KV.delete(failKey);
    } else {
      await c.env.KV.put(failKey, String(failed), { expirationTtl: 15 * 60 });
    }
    return c.json({ error: 'Invalid password' }, 401);
  }

  await c.env.KV.delete(failKey);
  const token = await sign({ id: link.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 }, c.env.JWT_SECRET, 'HS256');
  setCookie(c, `shared_session_${link.id}`, token, { path: '/', httpOnly: true, secure: true, sameSite: 'None', maxAge: 60 * 60 * 24 });
  return c.json({ success: true });
});

// Email gate for requireEmail links — ponytail: no password needed, just record the email
sharedRouter.post('/:id/email', zValidator('json', sharedLinkEmailSchema, zodErrorHook), async (c) => {
  const sharedService = c.get('sharedService');
  const link = await sharedService.getLinkForValidation(c.req.param('id'));
  if (!link) return c.json({ error: 'Link not found' }, 404);

  if (!link.requireEmail) return c.json({ error: 'This link does not require email' }, 400);
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return c.json({ error: 'Link expired' }, 410);
  }

  const { email } = c.req.valid('json');

  // JWT signing + cookie logic stays in route (needs c.env.JWT_SECRET)
  const emailToken = await sign(
    { id: link.id, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 },
    c.env.JWT_SECRET,
    'HS256',
  );
  setCookie(c, `shared_email_${link.id}`, emailToken, { path: '/', httpOnly: true, secure: true, sameSite: 'None', maxAge: 60 * 60 * 24 });

  c.executionCtx.waitUntil(
    sharedService.logAction(link.id, 'email_access', JSON.stringify({ email }))
  );
  return c.json({ success: true });
});

sharedRouter.get('/:id/download', async (c) => {
  const sharedService = c.get('sharedService');
  const link = await sharedService.getLinkForValidation(c.req.param('id'));
  if (!link) return c.text('Not found', 404);

  const validation = await validateSharedLink(c, link);
  if (!validation.ok) {
    return c.text(validation.error || 'Unauthorized', validation.status as 400 | 401 | 403 | 410 | 500);
  }

  if (!link.allowDownloads) {
    return c.text('Downloads are disabled for this link', 403);
  }

  if (link.targetType !== 'file') {
    return c.text('Folder download not supported yet', 400);
  }

  const ctx = await sharedService.getDownloadContext(link);
  if (!ctx) return c.text('File not found', 404);
  const { file, driveAccountId } = ctx;

  const driveService = new GoogleDriveService(
    c.env.DB,
    c.env.GOOGLE_CLIENT_ID,
    c.env.GOOGLE_CLIENT_SECRET,
    c.env.TOKEN_ENCRYPTION_KEY
  );

  let stream: ReadableStream<Uint8Array>;
  let finalMimeType = (file.mime_type as string) || 'application/octet-stream';
  let finalFileName = file.name as string;

  try {
    const downloadResult = await driveService.downloadFile(
      driveAccountId,
      file.google_file_id,
      file.mime_type ?? undefined
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

  // ponytail: increment only after Google fetch succeeds — failed downloads don't burn quota.
  // When maxDownloads is set, use the atomic RETURNING query (enforces limit + blocks before streaming).
  // When maxDownloads is null, fire-and-forget is safe (no limit to enforce).
  if (link.maxDownloads !== null && link.maxDownloads !== undefined) {
    const newCount = await sharedService.incrementDownloadCountWithLimit(link.id);
    if (newCount === null) {
      return c.text('Maximum download limit reached', 403);
    }
  } else {
    c.executionCtx.waitUntil(
      sharedService.incrementDownloadCount(link.id)
    );
  }

  c.executionCtx.waitUntil(
    sharedService.logAction(link.id, 'download')
  );

  if (link.webhookUrl) {
    c.executionCtx.waitUntil(
      fetch(link.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download', linkId: link.id })
      }).catch(() => {})
    );
  }

  c.header('Content-Type', finalMimeType);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(finalFileName)}`);
  if (file.size && !finalFileName.endsWith('.pdf') && !finalFileName.endsWith('.xlsx')) {
    c.header('Content-Length', String(file.size));
  }

  return c.body(stream);
});
