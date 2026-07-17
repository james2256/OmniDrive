import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitStore {
  map: Map<string, RateLimitEntry>;
  lastCleanup: number;
}

const CLEANUP_INTERVAL = 5 * 60 * 1000;

// Track every store so _resetStoreForTesting() can clear them all.
const allStores: RateLimitStore[] = [];

function cleanup(store: RateLimitStore, windowMs: number) {
  const now = Date.now();
  if (now - store.lastCleanup < CLEANUP_INTERVAL) return;
  store.lastCleanup = now;
  for (const [key, entry] of store.map) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
    if (entry.timestamps.length === 0) store.map.delete(key);
  }
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyFn?: (c: Context) => string;
}

export function rateLimiter(opts: RateLimitOptions) {
  // Each limiter instance gets its own store so that overlapping route
  // matchers (e.g. '/api/auth/login' and the catch-all '/api/*') don't
  // share a bucket and double-count a single request. Previously a shared
  // module-level Map meant one POST /api/auth/login incremented both the
  // login bucket and the global bucket under the same key — exhausting the
  // login budget in as few as 5 attempts (5 × 2 = 10).
  // ponytail: per-isolate limit — upgrade to Durable Object/KV if brute-force becomes a real problem
  const store: RateLimitStore = { map: new Map(), lastCleanup: Date.now() };
  allStores.push(store);

  return createMiddleware(async (c, next) => {
    cleanup(store, opts.windowMs);

    const key = opts.keyFn
      ? opts.keyFn(c)
      : c.req.header('CF-Connecting-IP') ??
        c.req.header('X-Real-IP') ??
        'unknown';

    const now = Date.now();
    const entry = store.map.get(key) ?? { timestamps: [] };

    entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);

    if (entry.timestamps.length >= opts.maxRequests) {
      const retryAfter = Math.ceil(
        (entry.timestamps[0] + opts.windowMs - now) / 1000
      );
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests' }, 429);
    }

    entry.timestamps.push(now);
    store.map.set(key, entry);

    return next();
  });
}

/** Only for testing — clears all rate limit state across every instance */
export function _resetStoreForTesting() {
  for (const store of allStores) {
    store.map.clear();
  }
}
