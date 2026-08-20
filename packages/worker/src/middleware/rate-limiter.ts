import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppContext } from '../types/context';
import { FIVE_MINUTES_MS } from '../constants';
import { RateLimitError } from '../lib/errors';

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitStore {
  map: Map<string, RateLimitEntry>;
  lastCleanup: number;
}

const CLEANUP_INTERVAL = FIVE_MINUTES_MS;

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
  /**
   * Async-capable key function. When omitted, the key defaults to the client IP.
   * Awaited by the middleware so callers can read the request body (e.g. the
   * login email for per-(IP, email) rate limiting).
   */
  keyFn?: (c: Context) => string | Promise<string>;
  /**
   * When true, use Cloudflare KV for cross-isolate rate limiting instead of
   * the per-isolate in-memory Map. Adds ~50ms latency per request but ensures
   * the limit is enforced globally across all Workers isolates.
   */
  useKV?: boolean;
}

export function rateLimiter(opts: RateLimitOptions) {
  // Each limiter instance gets its own store so that overlapping route
  // matchers (e.g. '/api/auth/login' and the catch-all '/api/*') don't
  // share a bucket and double-count a single request. Previously a shared
  // module-level Map meant one POST /api/auth/login incremented both the
  // login bucket and the global bucket under the same key — exhausting the
  // login budget in as few as 5 attempts (5 × 2 = 10).
  const store: RateLimitStore = { map: new Map(), lastCleanup: Date.now() };
  allStores.push(store);

  return createMiddleware<AppContext>(async (c, next) => {
    const key = opts.keyFn
      ? await opts.keyFn(c)
      : (c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown');

    const now = Date.now();

    if (opts.useKV && c.env.KV) {
      // Cross-isolate rate limiting via KV (eventual consistency — may allow
      // 1-2 extra requests during propagation, but better than per-isolate
      // which allows N × maxRequests across N isolates).
      const kvKey = `ratelimit:${key}`;
      const raw = await c.env.KV.get(kvKey);
      let timestamps: number[];
      try {
        timestamps = raw ? JSON.parse(raw) : [];
      } catch {
        timestamps = []; // corrupted KV data — treat as empty (reset the window)
      }
      const valid = timestamps.filter((t) => now - t < opts.windowMs);

      if (valid.length >= opts.maxRequests) {
        const retryAfter = Math.ceil((valid[0] + opts.windowMs - now) / 1000);
        c.header('Retry-After', String(retryAfter));
        throw new RateLimitError('Too many requests');
      }

      valid.push(now);
      await c.env.KV.put(kvKey, JSON.stringify(valid), {
        expirationTtl: Math.ceil(opts.windowMs / 1000),
      });

      return next();
    }

    // Per-isolate in-memory fallback (no KV available or useKV not set)
    cleanup(store, opts.windowMs);

    const entry = store.map.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);

    if (entry.timestamps.length >= opts.maxRequests) {
      const retryAfter = Math.ceil((entry.timestamps[0] + opts.windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new RateLimitError('Too many requests');
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
