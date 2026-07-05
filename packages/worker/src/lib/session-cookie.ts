import type { CookieOptions } from 'hono/utils/cookie';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

/** Whether frontend and worker share a site (same host or same registrable domain). */
export function isSameSiteDeployment(env: { FRONTEND_URL: string; WORKER_URL: string }): boolean {
  try {
    const fe = new URL(env.FRONTEND_URL);
    const we = new URL(env.WORKER_URL);
    if (fe.hostname === we.hostname) return true;
    if (fe.hostname === 'localhost' && we.hostname === 'localhost') return true;
    const feBase = fe.hostname.split('.').slice(-2).join('.');
    const weBase = we.hostname.split('.').slice(-2).join('.');
    return feBase.length > 0 && feBase === weBase;
  } catch {
    return false;
  }
}

/**
 * Session cookie for omnidrive_sid.
 *
 * SameSite=Lax + same-origin /api (Vite proxy in dev, Pages rewrite in production)
 * stores a first-party cookie on the frontend host so it survives tab close.
 *
 * Direct cross-site fetch (SPA on azadrive.my.id → *.workers.dev) with
 * SameSite=None is increasingly dropped by browsers after tabs close.
 */
export function sessionCookieOptions(env: { FRONTEND_URL: string; WORKER_URL: string }): CookieOptions {
  const secure = new URL(env.FRONTEND_URL).protocol === 'https:';
  return {
    path: '/',
    secure,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SEC,
  };
}

export function sessionDeleteCookieOptions(env: { FRONTEND_URL: string; WORKER_URL: string }): CookieOptions {
  return { ...sessionCookieOptions(env), maxAge: 0 };
}