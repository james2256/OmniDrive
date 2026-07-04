import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppContext, SessionData } from '../types/env';
import { AppError } from './error-handler';

const MAX_SESSION_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days absolute max

export const authGuard = createMiddleware<AppContext>(async (c, next) => {
  const cookie = getCookie(c, 'omnidrive_sid');
  if (!cookie) {
    throw new AppError(401, 'Not authenticated');
  }

  const sessionJson = await c.env.KV.get(`session:${cookie}`);
  if (!sessionJson) {
    throw new AppError(401, 'Session expired');
  }

  const session: SessionData = JSON.parse(sessionJson);

  // Enforce absolute session lifetime
  if (session.createdAt && Date.now() - session.createdAt > MAX_SESSION_AGE) {
    await c.env.KV.delete(`session:${cookie}`);
    throw new AppError(401, 'Session expired');
  }

  c.set('userId', session.userId);
  c.set('session', session);

  // ponytail: throttled sliding window — only extend TTL if session hasn't been touched
  // in the last hour, saving ~90% of KV writes (free tier = 1k/day). On paid tier,
  // remove the threshold check to get true sliding window (extend on every request).
  const EXTENSION_THRESHOLD = 60 * 60 * 1000; // 1 hour
  const lastTouched = session.createdAt || 0;
  const shouldExtend = Date.now() - lastTouched > EXTENSION_THRESHOLD;

  if (shouldExtend) {
    const updated = { ...session, createdAt: Date.now() };
    await c.env.KV.put(`session:${cookie}`, JSON.stringify(updated), {
      expirationTtl: 60 * 60 * 24 * 7, // 7 days
    });
    c.set('session', updated);
  }

  await next();
});
