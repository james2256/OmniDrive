import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppContext, SessionData } from '../types/env';
import { AppError } from './error-handler';

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
  c.set('userId', session.userId);
  c.set('session', session);

  // Sliding window: extend session TTL on each valid request
  await c.env.KV.put(`session:${cookie}`, sessionJson, {
    expirationTtl: 60 * 60 * 24 * 7, // 7 days
  });

  await next();
});


