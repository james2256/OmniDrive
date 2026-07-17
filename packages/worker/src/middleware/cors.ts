import { cors } from 'hono/cors';
import type { Env } from '../types/env';

/** Safe localhost check using URL parsing instead of regex (avoids ReDoS heuristic). */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' && url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function corsMiddleware() {
  return cors({
    origin: (origin, c) => {
      const env = c.env as Env;
      const allowed = [env.FRONTEND_URL];
      if (allowed.includes(origin)) {
        return origin;
      }
      // Only allow localhost in development (when FRONTEND_URL is localhost)
      const isDev = env.FRONTEND_URL?.includes('localhost');
      if (isDev && origin && isLocalhostOrigin(origin)) {
        return origin;
      }
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Content-Range', 'X-Upload-Url'],
    credentials: true,
    maxAge: 86400,
  });
}
