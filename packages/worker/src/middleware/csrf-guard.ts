import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../lib/errors';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const CSRF_EXEMPT_PATHS = ['/api/auth/google/callback'];

function isPublicSharedEndpoint(method: string, path: string): boolean {
  const sharedMatch = path.match(/^\/api\/shared\/[^/]+/);
  if (!sharedMatch) return false;
  if (method === 'GET') return true;
  if (method === 'POST' && path.endsWith('/verify')) return true;
  return false;
}

export const csrfGuard = createMiddleware<{
  Bindings: { FRONTEND_URL: string; WORKER_URL: string };
}>(async (c, next) => {
  if (SAFE_METHODS.includes(c.req.method)) {
    return next();
  }

  const path = new URL(c.req.url).pathname;
  if (CSRF_EXEMPT_PATHS.includes(path)) {
    return next();
  }
  if (isPublicSharedEndpoint(c.req.method, path)) {
    return next();
  }

  const allowedOrigins = [c.env.FRONTEND_URL, c.env.WORKER_URL].filter(Boolean);

  const origin = c.req.header('Origin');
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      throw new ForbiddenError('CSRF validation failed');
    }
    return next();
  }

  const referer = c.req.header('Referer');
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (!allowedOrigins.includes(refererOrigin)) {
        throw new ForbiddenError('CSRF validation failed');
      }
      return next();
    } catch {
      throw new ForbiddenError('CSRF validation failed');
    }
  }

  throw new ForbiddenError('CSRF validation failed');
});
