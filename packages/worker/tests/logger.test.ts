import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, logNoCtx, logError, logErrorNoCtx } from '../src/lib/logger';
import type { Context } from 'hono';

function makeContext(overrides?: { requestId?: string; path?: string }): Context {
  const requestId = overrides?.requestId ?? 'req-123';
  const path = overrides?.path ?? '/api/test';
  return {
    get: (key: string) => (key === 'requestId' ? requestId : undefined),
    req: { path } as unknown as Context['req'],
  } as unknown as Context;
}

describe('logger — console routing', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log(level=error) writes to console.error as JSON line', () => {
    const c = makeContext();
    log(c, 'error', 'boom');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('boom');
    expect(parsed.requestId).toBe('req-123');
    expect(parsed.path).toBe('/api/test');
  });

  it('log(level=warn) writes to console.error (only error+warn use console.error)', () => {
    log(makeContext(), 'warn', 'careful');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('log(level=info) writes to console.warn', () => {
    log(makeContext(), 'info', 'hi');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('log(level=debug) writes to console.warn', () => {
    log(makeContext(), 'debug', 'trace');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('log — request context fields', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes requestId and path from Context', () => {
    const c = makeContext({ requestId: 'req-abc', path: '/api/v1/files' });
    log(c, 'info', 'msg');
    const line = warnSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.requestId).toBe('req-abc');
    expect(parsed.path).toBe('/api/v1/files');
  });

  it('includes a top-level ts ISO-8601 string', () => {
    log(makeContext(), 'info', 'msg');
    const line = warnSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(typeof parsed.ts).toBe('string');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('merges extra ctx fields into the entry (after reserved fields)', () => {
    log(makeContext(), 'info', 'msg', { userId: 'u1', route: 'list' });
    const line = warnSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.userId).toBe('u1');
    expect(parsed.route).toBe('list');
  });

  it('serializes err as { err, stack, errorClass } when err is an Error', () => {
    const err = new Error('disk full');
    log(makeContext(), 'error', 'fail', undefined, err);
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.err).toBe('disk full');
    expect(parsed.errorClass).toBe('Error');
    expect(typeof parsed.stack).toBe('string');
  });

  it('serializes a custom error class name into errorClass', () => {
    class MyTimeoutError extends Error {
      constructor(m: string) {
        super(m);
        this.name = 'MyTimeoutError';
      }
    }
    log(makeContext(), 'error', 'timeout', undefined, new MyTimeoutError('slow'));
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.errorClass).toBe('MyTimeoutError');
    expect(parsed.err).toBe('slow');
  });

  it('does NOT set err/stack/errorClass when err is undefined', () => {
    log(makeContext(), 'info', 'no-err');
    const line = warnSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.err).toBeUndefined();
    expect(parsed.stack).toBeUndefined();
    expect(parsed.errorClass).toBeUndefined();
  });

  it('does NOT set err/stack/errorClass when err is a non-Error value', () => {
    log(makeContext(), 'error', 'str-err', undefined, 'just a string');
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.err).toBeUndefined();
    expect(parsed.errorClass).toBeUndefined();
    expect(parsed.stack).toBeUndefined();
  });
});

describe('logNoCtx — no request context', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits requestId and path fields entirely', () => {
    logNoCtx('info', 'boot-done');
    const line = warnSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.requestId).toBeUndefined();
    expect(parsed.path).toBeUndefined();
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('boot-done');
  });

  it('still includes ts, level, msg', () => {
    logNoCtx('warn', 'careful');
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('careful');
    expect(typeof parsed.ts).toBe('string');
  });

  it('serializes err when provided', () => {
    const err = new TypeError('bad arg');
    logNoCtx('error', 'fail', undefined, err);
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.err).toBe('bad arg');
    expect(parsed.errorClass).toBe('TypeError');
  });

  it('merges extra ctx fields', () => {
    logNoCtx('info', 'msg', { phase: 'init' });
    const line = warnSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.phase).toBe('init');
  });
});

describe('logError / logErrorNoCtx — convenience wrappers', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logError emits level=error with the given message', () => {
    const c = makeContext();
    logError(c, 'route-failed');
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('route-failed');
    expect(parsed.requestId).toBe('req-123');
  });

  it('logError serializes err and merges ctx', () => {
    const c = makeContext();
    const err = new Error('db gone');
    logError(c, 'db-fail', err, { retry: 3 });
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.err).toBe('db gone');
    expect(parsed.errorClass).toBe('Error');
    expect(parsed.retry).toBe(3);
  });

  it('logError works without err or ctx', () => {
    logError(makeContext(), 'simple');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(parsed.msg).toBe('simple');
  });

  it('logErrorNoCtx emits level=error without requestId/path', () => {
    logErrorNoCtx('boot-fail', new Error('env bad'));
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('boot-fail');
    expect(parsed.err).toBe('env bad');
    expect(parsed.errorClass).toBe('Error');
    expect(parsed.requestId).toBeUndefined();
    expect(parsed.path).toBeUndefined();
  });

  it('logErrorNoCtx merges ctx when provided', () => {
    logErrorNoCtx('cron-fail', new Error('timeout'), { job: 'cleanup' });
    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.job).toBe('cleanup');
  });
});
