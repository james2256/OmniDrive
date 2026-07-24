import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../lib/password';
import type { AppContext, SessionData } from '../types/env';
import type { UserRow } from '../types';
import { AuthService } from '../services/auth.service';
import { AppError, ConflictError } from '../lib/errors';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { zValidator } from '@hono/zod-validator';
import { registerSchema, loginSchema, changePasswordSchema, zodErrorHook } from '../lib/schemas';
import { generatePKCE } from '../lib/pkce';
import { encrypt } from '../lib/crypto';
import { syncDriveAccount } from '../services/sync';
import { GoogleDriveService } from '../services/google-drive';
import { mapDriveRow } from '../types';
import { SESSION_TTL_MS, sessionCookieOptions, sessionDeleteCookieOptions } from '../lib/session-cookie';
import { AuthRepository } from '../repositories/auth.repository';

export const authRouter = new Hono<AppContext>({ strict: false });

authRouter.get('/setup-status', async (c) => {
  const result = await new AuthRepository(c.env.DB).countUsers();
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  return c.json({ isSetup: (result?.count || 0) > 0 });
});

authRouter.post('/register', zValidator('json', registerSchema, zodErrorHook), async (c) => {
  const { name, username, password, email, invitation_code } = c.req.valid('json');
  const authRepo = new AuthRepository(c.env.DB);

  // Check setup status
  const setupRes = await authRepo.countUsers();
  const isSetup = (setupRes?.count || 0) > 0;

  const existing = await authRepo.findByUsername(username);
  if (existing) throw new ConflictError('Username already exists');

  if (email) {
    const existingEmail = await authRepo.findByEmail(email);
    if (existingEmail) throw new ConflictError('Email already exists');
  }

  if (isSetup) {
    if (!invitation_code) throw new AppError(400, 'Invitation code required');
    // ponytail: atomic consume — no TOCTOU race; only after username/email checks pass
    const consumed = await authRepo.consumeInvitation(invitation_code);
    if (!consumed) {
      const inv = await authRepo.findInvitation(invitation_code);
      if (!inv) throw new AppError(400, 'Invalid invitation code');
      throw new AppError(400, 'Invitation code has reached its usage limit');
    }
  } else {
    // ponytail: optional BOOTSTRAP_TOKEN — if set, first registration requires it instead of being fully open
    const bootstrapToken = c.env.BOOTSTRAP_TOKEN;
    if (bootstrapToken) {
      if (invitation_code !== bootstrapToken) {
        throw new AppError(403, 'Bootstrap token required for first registration');
      }
    }
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const isSuperAdmin = isSetup ? 0 : 1;

  await authRepo.insertUser({ id, username, passwordHash, email: email || null, name: name || username, isSuperAdmin });

  const now = Date.now();
  const sessionData: SessionData = { userId: id, username, email: email || null, name: name || username, avatarUrl: null, role: isSuperAdmin ? 'super_admin' : 'member', createdAt: now };
  const sessionId = generateId();

  await authRepo.insertSession({ id: sessionId, userId: id, data: JSON.stringify(sessionData), expiresAt: now + SESSION_TTL_MS, touchedAt: now });

  setCookie(c, 'omnidrive_sid', sessionId, sessionCookieOptions(c.env));

  return c.json({ success: true, user: sessionData, isSuperAdmin: !!isSuperAdmin });
});

authRouter.post('/login', zValidator('json', loginSchema, zodErrorHook), async (c) => {
  const { username, password } = c.req.valid('json');
  const authRepo = new AuthRepository(c.env.DB);

  const user = await authRepo.findByUsernameWithAuth(username) as UserRow | null;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AppError(401, 'Invalid credentials');
  }

  const now = Date.now();
  const sessionData: SessionData = { userId: user.id, username: user.username, email: user.email, name: user.name, avatarUrl: user.avatar_url, role: user.is_super_admin ? 'super_admin' : 'member', createdAt: now };
  const sessionId = generateId();

  await authRepo.insertSession({ id: sessionId, userId: user.id, data: JSON.stringify(sessionData), expiresAt: now + SESSION_TTL_MS, touchedAt: now });

  setCookie(c, 'omnidrive_sid', sessionId, sessionCookieOptions(c.env));

  return c.json({ success: true, user: sessionData });
});

// Initiates Google OAuth. Called via credentialed fetch from the SPA: the
// session cookie IS sent on a cross-site fetch (that's how /api/auth/me
// works) but is NOT reliably sent on a cross-site top-level navigation, so
// the frontend must not use an <a href> here. Returns the Google auth URL as
// JSON and the SPA performs the redirect. The userId is carried in the
// server-side OAuth state (KV) so /callback can link the Drive without
// depending on the session cookie surviving the Google round-trip.
authRouter.get('/google', authGuard, async (c) => {
  const env = c.env;
  const userId = c.get('userId');

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(400, 'Google OAuth is not configured. Please login with username and password.');
  }

  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const scope = 'openid email profile https://www.googleapis.com/auth/drive';

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'consent');

  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePKCE();

  // Store state + PKCE verifier + userId in D1 (10-min TTL via created_at).
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

// ponytail: migrate /callback to AuthRepository when adding a new auth flow.
// Currently 8 inline SQL calls interleaved with Google API (token exchange,
// user info fetch), encryption (token storage), and c.executionCtx.waitUntil
// (background sync). The SQL is tightly coupled to the OAuth flow — extraction
// would require passing env + executionCtx to the repository, breaking the
// "repository owns SQL only" pattern. Defer until a 2nd OAuth provider appears.
authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) throw new AppError(400, 'Authorization code missing');

  const state = c.req.query('state');
  if (!state) throw new AppError(400, 'Missing state parameter');
  const savedState = getCookie(c, 'oauth_state');
  deleteCookie(c, 'oauth_state', { path: '/' });
  if (savedState && state !== savedState) {
    throw new AppError(400, 'Invalid state parameter');
  }

  const db = c.env.DB;

  // Retrieve PKCE verifier + userId from D1 (authoritative single-use state)
  const stateRow = await db.prepare('SELECT code_verifier, user_id FROM oauth_states WHERE state = ?')
    .bind(state).first() as { code_verifier: string; user_id: string };
  if (!stateRow) throw new AppError(400, 'OAuth state expired');
  await db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

  const targetUserId = stateRow.user_id;
  const codeVerifier = stateRow.code_verifier;
  if (!targetUserId) throw new AppError(400, 'OAuth session expired — please reconnect your Google account.');

  const authService = new AuthService(c.env);
  const tokens = await authService.exchangeCodeForTokens(code, `${c.env.WORKER_URL}/api/auth/callback`, codeVerifier);
  const googleUser = await authService.fetchUserInfo(tokens.accessToken);

  await db.prepare('UPDATE users SET google_id = ? WHERE id = ?')
    .bind(googleUser.id, targetUserId).run();

  let drive = await db.prepare('SELECT id FROM drive_accounts WHERE google_account_id = ? AND user_id = ?').bind(googleUser.id, targetUserId).first() as { id: string };
  if (!drive) {
    const res = await db.prepare('SELECT COUNT(*) as count FROM drive_accounts WHERE user_id = ?').bind(targetUserId).first() as { count: number };
    const isPrimary = res.count === 0 ? 1 : 0;
    const driveId = generateId();
    await db.prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, is_primary, root_folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(driveId, targetUserId, googleUser.id, googleUser.email, googleUser.name || googleUser.email, isPrimary, null).run();
    drive = { id: driveId };
  }

  await db.prepare(
    'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(drive_account_id) DO UPDATE SET encrypted_tokens = excluded.encrypted_tokens, updated_at = excluded.updated_at'
  ).bind(drive.id, await encrypt(JSON.stringify(tokens), c.env.TOKEN_ENCRYPTION_KEY), Date.now()).run();

  const driveRow = await db.prepare('SELECT * FROM drive_accounts WHERE id = ?').bind(drive.id).first();
  if (driveRow) {
    const driveObj = mapDriveRow(driveRow as Record<string, unknown>);
    const driveService = new GoogleDriveService(db, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.TOKEN_ENCRYPTION_KEY);
    c.executionCtx.waitUntil(syncDriveAccount(driveObj, db, driveService));
  }

  return c.redirect(c.env.FRONTEND_URL);
});

authRouter.get('/me', authGuard, (c) => {
  return c.json({ user: c.get('session') });
});

// Change password for the authenticated user (admin or member).
// Requires current password; revokes all other sessions, keeps this one.
authRouter.post('/change-password', authGuard, zValidator('json', changePasswordSchema, zodErrorHook), async (c) => {
  const { currentPassword, newPassword } = c.req.valid('json');

  if (currentPassword === newPassword) {
    throw new AppError(400, 'New password must be different from current password');
  }

  const userId = c.get('userId');
  const authRepo = c.get('authRepo');
  const user = await authRepo.findPasswordHash(userId);
  if (!user) throw new AppError(404, 'User not found');

  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AppError(401, 'Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);
  await authRepo.updatePasswordHash(userId, passwordHash);

  // Kill other sessions (stolen cookies); keep current so the user stays signed in.
  const sid = getCookie(c, 'omnidrive_sid');
  if (sid) {
    await authRepo.deleteOtherSessions(userId, sid);
  } else {
    await authRepo.deleteAllSessions(userId);
  }

  return c.json({ success: true });
});

authRouter.post('/logout', authGuard, async (c) => {
  const sid = getCookie(c, 'omnidrive_sid');
  if (sid) {
    await c.get('authRepo').deleteSessionById(sid);
  }
  deleteCookie(c, 'omnidrive_sid', sessionDeleteCookieOptions(c.env));
  return c.json({ success: true });
});

// Revoke all sessions for the current user (e.g. after password change, compromise)
authRouter.post('/sessions/revoke', authGuard, async (c) => {
  await c.get('authRepo').deleteAllSessions(c.get('userId'));
  deleteCookie(c, 'omnidrive_sid', sessionDeleteCookieOptions(c.env));
  return c.json({ success: true });
});
