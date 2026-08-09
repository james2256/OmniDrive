import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../src/index';

// app.onError logs 4xx AppErrors at `warn` level and 5xx errors at `error`
// level. Both use console.error (per logger.ts emit routing), so spying on
// console.error captures both. These tests verify the onError handler's
// decision logic — the logger itself is tested in logger.test.ts.
//
// The test route `/api/auth/callback` (no ?code) throws AppError(400,
// 'Authorization code missing') before touching D1/KV — no mock bindings
// required. GET is a CSRF-safe method, so csrfGuard passes without checking
// env. The catch-all /api/* rate limiter uses in-memory fallback (no useKV),
// so KV is not accessed.

describe('app.onError — 4xx logging', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockEnv = {
    FRONTEND_URL: 'http://localhost:5173',
    WORKER_URL: 'http://localhost:8888',
  };

  it('logs 4xx AppError at warn level with message, stack, status, errorClass', async () => {
    const res = await app.request('/api/auth/callback', {}, mockEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Authorization code missing' });

    // warn level uses console.error (per logger.ts:32 emit routing)
    expect(errorSpy).toHaveBeenCalled();

    const logLine = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logLine);

    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('Client error');
    expect(parsed.err).toBe('Authorization code missing');
    expect(parsed.status).toBe(400);
    expect(parsed.errorClass).toBe('AppError');
    expect(parsed.path).toBe('/api/auth/callback');
    expect(parsed.requestId).toBeDefined();
    expect(parsed.stack).toContain('auth.ts');
  });

  it('does NOT log at error level for 4xx (warn only)', async () => {
    await app.request('/api/auth/callback', {}, mockEnv);

    const errorLevelEntries = errorSpy.mock.calls
      .map((call) => call[0] as string)
      .filter((line) => {
        try {
          return JSON.parse(line).level === 'error';
        } catch {
          return false;
        }
      });

    expect(errorLevelEntries).toHaveLength(0);
  });

  it('returns the same JSON response as before (no behavior change)', async () => {
    const res = await app.request('/api/auth/callback', {}, mockEnv);

    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Authorization code missing' });
  });
});

describe('app.onError — 5xx logging', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockEnv = {
    FRONTEND_URL: 'http://localhost:5173',
    WORKER_URL: 'http://localhost:8888',
    DB: {
      prepare: vi.fn(() => {
        throw new TypeError('D1 prepare is not a function');
      }),
    },
  };

  it('logs uncaught errors at error level (not warn)', async () => {
    // GET /api/drives/ requires auth. authGuard checks the omnidrive_sid cookie
    // first (throws 401 if missing). With a cookie present, it constructs
    // AuthRepository(DB) and calls findSession() → DB.prepare(). The malformed
    // DB binding throws TypeError — an uncaught Error that becomes 500 via
    // onError.
    await app.request(
      '/api/drives/',
      {
        headers: { Cookie: 'omnidrive_sid=fake-session-id' },
      },
      mockEnv,
    );

    const errorLevelEntries = errorSpy.mock.calls
      .map((call) => call[0] as string)
      .filter((line) => {
        try {
          return JSON.parse(line).level === 'error';
        } catch {
          return false;
        }
      });

    expect(errorLevelEntries.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(errorLevelEntries[0] as string);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('Unhandled server error');
    // errorClass is auto-extracted by log() — NOT passed redundantly in ctx
    expect(parsed.errorClass).toBeDefined();
  });
});
