import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppContext, SessionData } from '../types/env';
import { AppError } from './error-handler';
import { SESSION_TTL_MS } from '../lib/session-cookie';

const EXTENSION_THRESHOLD = 60 * 60 * 1000; // 1 hour

export const authGuard = createMiddleware<AppContext>(async (c, next) => {
  const cookie = getCookie(c, 'omnidrive_sid');
  if (!cookie) {
    throw new AppError(401, 'Not authenticated');
  }

  const row = await c.env.DB.prepare(
    'SELECT data, expires_at, touched_at FROM sessions WHERE id = ?'
  ).bind(cookie).first<{ data: string; expires_at: number; touched_at: number }>();

  if (!row) {
    throw new AppError(401, 'Session expired');
  }

  const now = Date.now();

  if (row.expires_at < now) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(cookie).run();
    throw new AppError(401, 'Session expired');
  }

  const session: SessionData = JSON.parse(row.data);
  c.set('userId', session.userId);
  c.set('session', session);

  // ponytail: throttled sliding window — only extend TTL if session hasn't been touched
  // in the last hour, saving ~90% of D1 writes vs extending on every request.
  if (now - row.touched_at > EXTENSION_THRESHOLD) {
    const newExpiresAt = now + SESSION_TTL_MS;
    await c.env.DB.prepare(
      'UPDATE sessions SET expires_at = ?, touched_at = ? WHERE id = ?'
    ).bind(newExpiresAt, now, cookie).run();
  }

  await next();
});
