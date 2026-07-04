import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../lib/password';
import type { AppContext, SessionData } from '../types/env';
import { AuthService } from '../services/auth.service';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { validatePassword, validateEmail } from '../lib/validation';
import { generatePKCE } from '../lib/pkce';
import { encrypt } from '../lib/crypto';
import { syncDriveAccount } from '../services/sync';
import { GoogleDriveService } from '../services/google-drive';
import { mapDriveRow } from '../types';

// ponytail: KV-based session index — D1 table would scale better for high session counts.
// Stores a JSON array of session IDs per user under user_sessions:<userId>.
async function registerSession(kv: KVNamespace, userId: string, sessionId: string): Promise<void> {
  const key = `user_sessions:${userId}`;
  const existing = await kv.get(key);
  const sessions: string[] = existing ? JSON.parse(existing) : [];
  if (!sessions.includes(sessionId)) {
    sessions.push(sessionId);
  }
  await kv.put(key, JSON.stringify(sessions), { expirationTtl: 60 * 60 * 24 * 30 });
}

async function unregisterSession(kv: KVNamespace, userId: string, sessionId: string): Promise<void> {
  const key = `user_sessions:${userId}`;
  const existing = await kv.get(key);
  if (!existing) return;
  const sessions: string[] = JSON.parse(existing).filter((s: string) => s !== sessionId);
  if (sessions.length === 0) {
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(sessions), { expirationTtl: 60 * 60 * 24 * 30 });
  }
}

async function revokeAllSessions(kv: KVNamespace, userId: string): Promise<void> {
  const key = `user_sessions:${userId}`;
  const existing = await kv.get(key);
  if (!existing) return;
  const sessions: string[] = JSON.parse(existing);
  for (const sid of sessions) {
    await kv.delete(`session:${sid}`);
  }
  await kv.delete(key);
}

export const authRouter = new Hono<AppContext>({ strict: false });

// ponytail: SameSite=Lax is safer when frontend and worker share an origin;
// None only needed for cross-origin credentialed SPA fetch.
function sameSiteValue(env: { FRONTEND_URL: string; WORKER_URL: string }): 'None' | 'Lax' {
  try {
    const fe = new URL(env.FRONTEND_URL).hostname;
    const we = new URL(env.WORKER_URL).hostname;
    return fe === we ? 'Lax' : 'None';
  } catch {
    return 'None';
  }
}

authRouter.get('/setup-status', async (c) => {
  const result = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  return c.json({ isSetup: (result?.count || 0) > 0 });
});

authRouter.post('/register', async (c) => {
  const { name, username, password, email, invitation_code } = await c.req.json();
  if (!username || !password) throw new AppError(400, 'Username and password required');

  const passwordError = validatePassword(password);
  if (passwordError) throw new AppError(400, passwordError);

  const db = c.env.DB;
  
  // Check setup status
  const setupRes = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const isSetup = (setupRes?.count || 0) > 0;

  if (isSetup) {
    if (!invitation_code) throw new AppError(400, 'Invitation code required');
    const inv = await db.prepare('SELECT id, max_uses, used_count FROM invitation_codes WHERE code = ?').bind(invitation_code).first<{ id: string, max_uses: number, used_count: number }>();
    if (!inv) throw new AppError(400, 'Invalid invitation code');
    if (inv.max_uses > 0 && inv.used_count >= inv.max_uses) throw new AppError(400, 'Invitation code has reached its usage limit');
    
    await db.prepare('UPDATE invitation_codes SET used_count = used_count + 1 WHERE id = ?').bind(inv.id).run();
  } else {
    // ponytail: optional BOOTSTRAP_TOKEN — if set, first registration requires it instead of being fully open
    const bootstrapToken = (c.env as any).BOOTSTRAP_TOKEN;
    if (bootstrapToken) {
      if (invitation_code !== bootstrapToken) {
        throw new AppError(403, 'Bootstrap token required for first registration');
      }
    }
  }

  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) throw new AppError(400, 'Username already exists');

  if (email) {
    const emailError = validateEmail(email);
    if (emailError) throw new AppError(400, emailError);
    const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existingEmail) throw new AppError(400, 'Email already exists');
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const isSuperAdmin = isSetup ? 0 : 1;
  
  await db.prepare(
    'INSERT INTO users (id, username, password_hash, email, name, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, username, passwordHash, email || null, name || username, isSuperAdmin).run();

  const sessionData: SessionData = { userId: id, username, email: email || null, name: name || username, avatarUrl: null, role: isSuperAdmin ? 'super_admin' : 'member', createdAt: Date.now() };
  const sessionId = generateId();
  
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
  const isSecure = c.env.WORKER_URL.startsWith('https://');
  const sameSite = sameSiteValue(c.env);
  setCookie(c, 'omnidrive_sid', sessionId, { path: '/', secure: isSecure, httpOnly: true, sameSite, maxAge: 60 * 60 * 24 * 7 });

  // ponytail: register session in user session index for revocation support
  await registerSession(c.env.KV, id, sessionId);

  return c.json({ success: true, user: sessionData, isSuperAdmin: !!isSuperAdmin });
});

authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) throw new AppError(400, 'Username and password required');

  const user = await c.env.DB.prepare('SELECT id, username, password_hash, email, name, avatar_url, is_super_admin FROM users WHERE username = ?').bind(username).first<any>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AppError(401, 'Invalid credentials');
  }

  const sessionData: SessionData = { userId: user.id, username: user.username, email: user.email, name: user.name, avatarUrl: user.avatar_url, role: user.is_super_admin ? 'super_admin' : 'member', createdAt: Date.now() };
  const sessionId = generateId();

  try {
    // ponytail: registerSession skipped on login to halve KV writes (free tier = 1k/day).
    // revokeAllSessions won't find sessions created after this change; upgrade to paid tier or
    // move sessions to D1 if full revocation is needed.
    await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
  } catch (e: any) {
    if (e?.message?.includes('limit exceeded')) {
      throw new AppError(503, 'Service temporarily unavailable. Please try again later.');
    }
    throw e;
  }

  const isSecure = c.env.WORKER_URL.startsWith('https://');
  const sameSite = sameSiteValue(c.env);
  setCookie(c, 'omnidrive_sid', sessionId, { path: '/', secure: isSecure, httpOnly: true, sameSite, maxAge: 60 * 60 * 24 * 7 });

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

  // Store state + PKCE verifier + userId in KV (10-min TTL). The userId is
  // read back in /callback so the Drive link survives the cross-site redirect.
  await env.KV.put(`oauth_state:${state}`, JSON.stringify({ codeVerifier, userId }), { expirationTtl: 600 });
  const isSecure = env.WORKER_URL.startsWith('https://');
  setCookie(c, 'oauth_state', state, { path: '/', httpOnly: true, secure: isSecure, sameSite: isSecure ? 'None' : 'Lax', maxAge: 60 * 5 });

  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('code_challenge', codeChallenge);
  authUrl.searchParams.append('code_challenge_method', 'S256');

  return c.json({ url: authUrl.toString() });
});

// OAuth callback — a top-level navigation arriving back from Google. The
// session cookie is NOT reliably sent on this cross-site redirect, so the
// linking user is read from the KV OAuth state (set during the credentialed
// /google fetch), NOT from c.get('userId'). The KV state is single-use and
// unguessable, which is the real CSRF protection; the oauth_state cookie is
// only enforced as an extra check when the browser happens to send it.
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

  // Retrieve PKCE verifier + userId from KV (authoritative single-use state)
  const stateDataJson = await c.env.KV.get(`oauth_state:${state}`);
  if (!stateDataJson) throw new AppError(400, 'OAuth state expired');
  const stateData = JSON.parse(stateDataJson);
  await c.env.KV.delete(`oauth_state:${state}`);

  const targetUserId = stateData.userId;
  if (!targetUserId) throw new AppError(400, 'OAuth session expired — please reconnect your Google account.');

  const env = c.env;
  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const authService = new AuthService(env);

  const tokens = await authService.exchangeCodeForTokens(code, redirectUri, stateData.codeVerifier);
  const googleUser = await authService.fetchUserInfo(tokens.accessToken);

  const db = env.DB;

  await db.prepare('UPDATE users SET google_id = ? WHERE id = ?')
    .bind(googleUser.id, targetUserId).run();

  let drive = await db.prepare('SELECT id FROM drive_accounts WHERE google_account_id = ? AND user_id = ?').bind(googleUser.id, targetUserId).first<{ id: string }>();
  if (!drive) {
    const driveId = generateId();
    const res = await db.prepare('SELECT COUNT(*) as count FROM drive_accounts WHERE user_id = ?').bind(targetUserId).first<{ count: number }>();
    const isPrimary = (res && res.count === 0) ? 1 : 0;

    await db.prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(driveId, targetUserId, googleUser.id, googleUser.email, googleUser.name, 'oauth', isPrimary).run();
    drive = { id: driveId };
  }

  // Encrypt tokens before storing
  const encryptedTokens = await encrypt(JSON.stringify(tokens), env.TOKEN_ENCRYPTION_KEY);
  await env.KV.put(`tokens:${drive.id}`, encryptedTokens);

  const driveRow = await db.prepare('SELECT * FROM drive_accounts WHERE id = ?').bind(drive.id).first();
  if (driveRow) {
    const driveObj = mapDriveRow(driveRow as Record<string, unknown>);
    const driveService = new GoogleDriveService(env.KV, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY);
    c.executionCtx.waitUntil(syncDriveAccount(driveObj, db, env.KV, driveService));
  }

  return c.redirect(`${env.FRONTEND_URL}/`);
});

authRouter.get('/me', authGuard, (c) => {
  return c.json({ user: c.get('session') });
});

authRouter.post('/logout', authGuard, async (c) => {
  const sid = getCookie(c, 'omnidrive_sid');
  const userId = c.get('userId');
  if (sid) {
    await c.env.KV.delete(`session:${sid}`);
    await unregisterSession(c.env.KV, userId, sid);
  }
  const isSecure = c.env.WORKER_URL.startsWith('https://');
  deleteCookie(c, 'omnidrive_sid', { path: '/', secure: isSecure, sameSite: sameSiteValue(c.env) });
  return c.json({ success: true });
});

// Revoke all sessions for the current user (e.g. after password change, compromise)
authRouter.post('/sessions/revoke', authGuard, async (c) => {
  const userId = c.get('userId');
  await revokeAllSessions(c.env.KV, userId);
  const isSecure = c.env.WORKER_URL.startsWith('https://');
  deleteCookie(c, 'omnidrive_sid', { path: '/', secure: isSecure, sameSite: sameSiteValue(c.env) });
  return c.json({ success: true });
});
