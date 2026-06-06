import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { AppContext, SessionData } from '../types/env';
import { AuthService } from '../services/auth.service';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';

export const authRouter = new Hono<AppContext>();

authRouter.get('/google', (c) => {
  const env = c.env;
  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const scope = 'openid email profile https://www.googleapis.com/auth/drive';
  
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'consent'); // Force refresh token for demo
  
  const state = crypto.randomUUID();
  setCookie(c, 'oauth_state', state, { path: '/', httpOnly: true, secure: true, maxAge: 60 * 5 });
  authUrl.searchParams.append('state', state);

  return c.redirect(authUrl.toString());
});

authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) throw new AppError(400, 'Authorization code missing');

  const state = c.req.query('state');
  const savedState = getCookie(c, 'oauth_state');
  if (!state || state !== savedState) {
    throw new AppError(400, 'Invalid state parameter');
  }
  deleteCookie(c, 'oauth_state', { path: '/' });

  const env = c.env;
  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const authService = new AuthService(env);

  // 1. Exchange code
  const tokens = await authService.exchangeCodeForTokens(code, redirectUri);
  
  // 2. Get user info
  const googleUser = await authService.fetchUserInfo(tokens.accessToken);

  // 3. Upsert user in D1
  const db = env.DB;
  let user = await db.prepare('SELECT id FROM users WHERE google_id = ?').bind(googleUser.id).first<{ id: string }>();
  
  if (!user) {
    const userId = generateId();
    await db.prepare(
      'INSERT INTO users (id, google_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, googleUser.id, googleUser.email, googleUser.name, googleUser.picture).run();
    user = { id: userId };
  }

  // 3b. Upsert drive account and save tokens
  let drive = await db.prepare('SELECT id FROM drive_accounts WHERE google_account_id = ?').bind(googleUser.id).first<{ id: string }>();
  if (!drive) {
    const driveId = generateId();
    await db.prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(driveId, user.id, googleUser.id, googleUser.email, googleUser.name, 'oauth', 1).run();
    drive = { id: driveId };
  }
  await env.KV.put(`tokens:${drive.id}`, JSON.stringify(tokens));

  // 4. Create session
  const sessionId = generateId();
  const sessionData: SessionData = {
    userId: user.id,
    email: googleUser.email,
    name: googleUser.name,
    avatarUrl: googleUser.picture,
  };

  await env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), {
    expirationTtl: 60 * 60 * 24 * 7, // 7 days
  });

  setCookie(c, 'omnidrive_sid', sessionId, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.redirect(`${env.FRONTEND_URL}/dashboard`);
});

// Protected routes below
authRouter.use('*', authGuard);

authRouter.get('/me', (c) => {
  const session = c.get('session');
  return c.json({ user: session });
});

authRouter.post('/logout', async (c) => {
  const sid = getCookie(c, 'omnidrive_sid');
  if (sid) {
    await c.env.KV.delete(`session:${sid}`);
  }
  
  deleteCookie(c, 'omnidrive_sid', { path: '/' });
  return c.json({ success: true });
});
