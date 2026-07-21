import { createMiddleware } from 'hono/factory';
import { SharedService } from '../services/shared.service';
import type { AppContext } from '../types/env';

/**
 * Instantiates SharedService on every /api/shared/* request.
 *
 * Unlike authGuard (which only runs on authed routes), this middleware
 * runs on ALL shared routes — including public ones (meta, verify, email,
 * download) that don't require authentication but still need SharedService
 * for DB access.
 */
export const sharedServices = createMiddleware<AppContext>(async (c, next) => {
  c.set('sharedService', new SharedService(c.env.DB));
  await next();
});
