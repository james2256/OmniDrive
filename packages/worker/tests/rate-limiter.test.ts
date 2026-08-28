import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimiter } from '../src/middleware/rate-limiter';
import { AppError } from '../src/lib/errors';
import type { RateLimitOptions } from '../src/middleware/rate-limiter';

/**
 * Mock D1 that simulates the hybrid UPSERT semantics validated by the probe
 * suite (P1–P11). The limiter only reads result.meta.changes (0 = blocked,
 * 1 = allowed). The SQL itself is tested end-to-end by the integration suite
 * (auth-flow) against real Miniflare D1; this unit test covers the limiter's
 * logic: key computation, Retry-After, blocked→429, allowed→200, fail-open.
 */
function createMockD1() {
  const store = new Map<string, { window_start: number; hits: number }>();
  let writes = 0;
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          const [name, key, windowStart, max] = args as [string, string, number, number];
          const id = `${name}:${key}`;
          const existing = store.get(id);
          if (existing && existing.window_start === windowStart) {
            if (existing.hits >= max) {
              return { meta: { changes: 0 } }; // blocked — zero writes
            }
            existing.hits++;
            writes++;
            return { meta: { changes: 1 } }; // allowed (increment)
          }
          store.set(id, { window_start: windowStart, hits: 1 });
          writes++;
          return { meta: { changes: 1 } }; // allowed (insert / rollover reset)
        },
      }),
    }),
    _writes: () => writes,
    _reset: () => {
      store.clear();
      writes = 0;
    },
  };
  return db;
}

function createApp(mockD1: ReturnType<typeof createMockD1>, opts: RateLimitOptions) {
  const app = new Hono();
  // Inject the mock D1 binding before the limiter reads c.env.DB.
  app.use('*', async (c, next) => {
    (c as unknown as { env: unknown }).env = { DB: mockD1 };
    await next();
  });
  app.onError((err, c) => {
    const isAppError = err instanceof AppError || err.name === 'AppError';
    const status = isAppError ? (err as AppError).status : 500;
    const message = isAppError ? err.message : 'Internal server error';
    return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 429 | 500);
  });
  app.use('*', rateLimiter(opts)); // limiter registered BEFORE the route
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimiter (D1 hybrid UPSERT)', () => {
  let mockD1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    mockD1 = createMockD1();
  });

  it('allows requests under the limit', async () => {
    const app = createApp(mockD1, { name: 'test', windowMs: 60_000, maxRequests: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test', {
        headers: { 'X-Real-IP': '1.2.3.4' },
      });
      expect(res.status).toBe(200);
    }
  });

  it('blocks requests over the limit with 429', async () => {
    const app = createApp(mockD1, { name: 'test', windowMs: 60_000, maxRequests: 2 });
    await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } });
    await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } });
    const res = await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('Too many requests');
  });

  it('includes Retry-After header on 429', async () => {
    const app = createApp(mockD1, { name: 'test', windowMs: 60_000, maxRequests: 1 });
    await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } });
    const res = await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
  });

  it('tracks different IPs independently', async () => {
    const app = createApp(mockD1, { name: 'test', windowMs: 60_000, maxRequests: 1 });
    const res1 = await app.request('/test', { headers: { 'X-Real-IP': '1.1.1.1' } });
    const res2 = await app.request('/test', { headers: { 'X-Real-IP': '2.2.2.2' } });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('isolates limiters by name (overlapping routes do not double-count)', async () => {
    // Reproduces the production setup: a specific limiter on '/api/auth/login'
    // plus the catch-all '/api/*' limiter. Both match the same request, but
    // the `name` field isolates their buckets so a single request isn't
    // counted twice against either budget.
    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { env: unknown }).env = { DB: mockD1 };
      await next();
    });
    app.use('/api/auth/login', rateLimiter({ name: 'login', windowMs: 60_000, maxRequests: 5 }));
    app.use('/api/*', rateLimiter({ name: 'api', windowMs: 60_000, maxRequests: 100 }));
    app.post('/api/auth/login', (c) => c.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Real-IP': '1.2.3.4', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    }
  });

  it('costs ZERO D1 writes on blocked requests', async () => {
    const app = createApp(mockD1, { name: 'test', windowMs: 60_000, maxRequests: 1 });
    await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } }); // allowed (1 write)
    const writesBefore = mockD1._writes();
    for (let i = 0; i < 10; i++) {
      await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } }); // all blocked
    }
    expect(mockD1._writes()).toBe(writesBefore); // no writes on blocked
  });

  it('fails open when D1 throws (does not 500)', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { env: unknown }).env = {
        DB: {
          prepare: () => ({
            bind: () => ({
              run: async () => {
                throw new Error('D1 is down');
              },
            }),
          }),
        },
      };
      await next();
    });
    app.onError((err, c) => {
      const isAppError = err instanceof AppError || err.name === 'AppError';
      const status = isAppError ? (err as AppError).status : 500;
      return c.json({ error: isAppError ? err.message : 'Internal server error' }, status as never);
    });
    app.use('*', rateLimiter({ name: 'test', windowMs: 60_000, maxRequests: 1 }));
    app.get('/test', (c) => c.json({ ok: true }));

    // Suppress the expected error log from the fail-open path
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('/test', { headers: { 'X-Real-IP': '1.2.3.4' } });
    spy.mockRestore();
    expect(res.status).toBe(200); // fail-open — request allowed
  });
});
