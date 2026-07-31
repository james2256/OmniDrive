import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { generatePKCE } from './pkce';
import type { AppContext, Env } from '../types/env';

export interface BuildOAuthUrlOptions {
  /** Google OAuth prompt flags. auth.ts uses 'consent'; drives.ts uses 'select_account consent'. */
  prompt: string;
}

/**
 * Build a Google OAuth URL with PKCE, persist state + verifier in D1, and set
 * the short-lived oauth_state cookie. Shared by auth.ts /google and drives.ts
 * /connect so PKCE security fixes apply to both paths.
 *
 * Returns the URL string to redirect the user to.
 */
export async function buildDriveOAuthUrl(
  c: Context<AppContext>,
  env: Env,
  userId: string,
  redirectUri: string,
  scope: string,
  opts: BuildOAuthUrlOptions,
): Promise<string> {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', opts.prompt);

  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePKCE();

  // Store state + PKCE verifier + userId in D1 (10-min TTL via created_at).
  await env.DB.prepare(
    'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(state, codeVerifier, userId, Date.now())
    .run();

  const isSecure = env.WORKER_URL.startsWith('https://');
  setCookie(c, 'oauth_state', state, {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'None' : 'Lax',
    maxAge: 60 * 5,
  });

  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('code_challenge', codeChallenge);
  authUrl.searchParams.append('code_challenge_method', 'S256');

  return authUrl.toString();
}
