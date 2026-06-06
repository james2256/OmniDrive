import { createMiddleware } from 'hono/factory';
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

function getCookie(c: { req: { header: (name: string) => string | undefined } }, name: string): string | undefined {
  const cookieHeader = c.req.header('cookie');
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }
  return undefined;
}
