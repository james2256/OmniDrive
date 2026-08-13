import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { SessionData } from '../types/env';
import type { AppContext } from '../types/context';
import { AppError } from '../lib/errors';
import { SESSION_TTL_MS } from '../lib/session-cookie';
import { FileService } from '../services/file.service';
import { FolderService } from '../services/folder.service';
import { DriveService } from '../services/drive.service';
import { WorkspaceService } from '../services/workspace.service';
import { AutomationRepository } from '../repositories/automation.repository';
import { S3CredentialsRepository } from '../repositories/s3-credentials.repository';
import { AdminRepository } from '../repositories/admin.repository';
import { AuthRepository } from '../repositories/auth.repository';
import { createDriveService } from '../lib/drive-factory';

const EXTENSION_THRESHOLD = 60 * 60 * 1000; // 1 hour

export const authGuard = createMiddleware<AppContext>(async (c, next) => {
  const cookie = getCookie(c, 'omnidrive_sid');
  if (!cookie) {
    throw new AppError(401, 'Not authenticated');
  }

  // Constructed early — the session validation below needs it, and routes read
  // it via c.get('authRepo') after c.set() below.
  const authRepo = new AuthRepository(c.env.DB);
  const row = await authRepo.findSession(cookie);

  if (!row) {
    throw new AppError(401, 'Session expired');
  }

  const now = Date.now();

  if (row.expires_at < now) {
    await authRepo.deleteSessionById(cookie);
    throw new AppError(401, 'Session expired');
  }

  let session: SessionData;
  try {
    session = JSON.parse(row.data);
  } catch {
    // Corrupted session data — delete so the user can log in fresh (self-heal)
    await authRepo.deleteSessionById(cookie);
    throw new AppError(401, 'Session expired');
  }
  c.set('userId', session.userId);
  c.set('session', session);

  // Instantiate services once per request — routes access via c.get().
  // A single shared DriveProvider is injected into both facades so they share
  // the same in-memory token cache (avoids redundant loadTokens D1 reads when
  // both facades call Google API for the same drive in one request).
  const sharedDriveProvider = createDriveService(c.env);
  c.set('fileService', new FileService(c.env.DB, sharedDriveProvider));
  c.set('folderService', new FolderService(c.env.DB));
  c.set('driveService', new DriveService(c.env.DB, sharedDriveProvider));
  c.set('workspaceService', new WorkspaceService(c.env.DB));
  c.set('automationRepo', new AutomationRepository(c.env.DB));
  c.set('s3CredentialsRepo', new S3CredentialsRepository(c.env.DB));
  c.set('adminRepo', new AdminRepository(c.env.DB));
  c.set('authRepo', authRepo);

  // ponytail: throttled sliding window — only extend TTL if session hasn't been touched
  // in the last hour, saving ~90% of D1 writes vs extending on every request.
  if (now - row.touched_at > EXTENSION_THRESHOLD) {
    const newExpiresAt = now + SESSION_TTL_MS;
    await authRepo.touchSession(cookie, newExpiresAt, now, row.touched_at);
  }

  await next();
});
