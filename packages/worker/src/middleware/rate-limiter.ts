import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppContext } from '../types/context';
import { RateLimitError } from '../lib/errors';
import { logErrorNoCtx } from '../lib/logger';

export interface RateLimitOptions {
  /** Unique limiter name — isolates rows in the rate_limits table so limiters
   * sharing the same key (e.g. the same IP hitting both /api/auth/login and
   * the /api/* catch-all) don't collide. */
  name: string;
  windowMs: number;
  maxRequests: number;
  /** Async-capable key function. When omitted, the key defaults to the client
   * IP. Awaited by the middleware so callers can read the request body (e.g.
   * the login email for per-(IP, email) rate limiting). */
  keyFn?: (c: Context) => string | Promise<string>;
}

// Hybrid UPSERT: on conflict (same name+key), increment hits if the window
// hasn't rolled over, otherwise reset to 1. The WHERE clause blocks the
// update when the current window is already at cap — so a blocked request
// costs ZERO D1 writes (the ON CONFLICT DO UPDATE fails its WHERE, no row is
// touched). An allowed request costs exactly 1 write (insert or update).
const UPSERT_SQL = `INSERT INTO rate_limits (name, key, window_start, hits) VALUES (?, ?, ?, 1)
ON CONFLICT (name, key) DO UPDATE SET
  hits = CASE WHEN rate_limits.window_start = excluded.window_start
              THEN rate_limits.hits + 1 ELSE 1 END,
  window_start = excluded.window_start
WHERE NOT (rate_limits.window_start = excluded.window_start AND rate_limits.hits >= ?)`;

export function rateLimiter(opts: RateLimitOptions) {
  return createMiddleware<AppContext>(async (c, next) => {
    const key = opts.keyFn
      ? await opts.keyFn(c)
      : (c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown');

    const now = Date.now();
    // Aligned (fixed) window: windowStart is a multiple of windowMs. This
    // makes Retry-After computable without a D1 read — the next window
    // boundary is always windowStart + windowMs.
    const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs;

    let blocked = false;
    let retryAfter = 0;
    try {
      const result = await c.env.DB.prepare(UPSERT_SQL)
        .bind(opts.name, key, windowStart, opts.maxRequests)
        .run();
      if (result.meta?.changes === 0) {
        // The WHERE clause blocked the upsert — current window is at cap.
        blocked = true;
        retryAfter = Math.max(1, Math.ceil((windowStart + opts.windowMs - now) / 1000));
      }
    } catch (e) {
      // D1 failure — fail open. Don't block legitimate traffic on
      // infrastructure failure. The auth path (login/register/change-password)
      // also writes D1 in its happy path (insertSession), so a D1 outage
      // severe enough to fail-open the limiter also blocks login — there is
      // no unbounded brute-force window. Rate limiting is not a security
      // boundary (the per-link D1 caps are); it's availability protection.
      logErrorNoCtx('Rate limiter D1 failure — failing open', e, { name: opts.name });
    }

    if (blocked) {
      c.header('Retry-After', String(retryAfter));
      throw new RateLimitError('Too many requests');
    }

    return next();
  });
}
