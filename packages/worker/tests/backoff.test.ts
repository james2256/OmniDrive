import { describe, it, expect, vi } from 'vitest';
import { isRetryable, parseDriveError, withBackoff } from '../src/lib/backoff';
import { UpstreamError } from '../src/lib/errors';

describe('isRetryable', () => {
  it('429 → true', () => expect(isRetryable(429, null)).toBe(true));
  it('500 → true', () => expect(isRetryable(500, null)).toBe(true));
  it('503 → true', () => expect(isRetryable(503, null)).toBe(true));
  it('403 rateLimitExceeded → true', () => expect(isRetryable(403, 'rateLimitExceeded')).toBe(true));
  it('403 dailyLimitExceeded → false', () => expect(isRetryable(403, 'dailyLimitExceeded')).toBe(false));
  it('401 → false (token refresh handles this, not backoff)', () => expect(isRetryable(401, null)).toBe(false));
  it('404 → false', () => expect(isRetryable(404, null)).toBe(false));
  it('400 → false', () => expect(isRetryable(400, null)).toBe(false));
});

describe('parseDriveError', () => {
  it('parses JSON error with reason', async () => {
    const response = new Response(JSON.stringify({
      error: { message: 'Rate limit exceeded', errors: [{ reason: 'rateLimitExceeded' }] },
    }), { status: 429 });
    const result = await parseDriveError(response);
    expect(result.status).toBe(429);
    expect(result.reason).toBe('rateLimitExceeded');
    expect(result.message).toBe('Rate limit exceeded');
  });

  it('returns null reason for non-JSON body', async () => {
    const response = new Response('Internal Server Error', { status: 500 });
    const result = await parseDriveError(response);
    expect(result.status).toBe(500);
    expect(result.reason).toBeNull();
    expect(result.message).toBe('Internal Server Error');
  });

  it('returns fallback message when response.text() fails', async () => {
    const response = new Response('', { status: 503 });
    // Simulate text() failure by making body null
    Object.defineProperty(response, 'text', { value: () => Promise.reject(new Error('stream consumed')) });
    const result = await parseDriveError(response);
    expect(result.status).toBe(503);
    expect(result.reason).toBeNull();
    expect(result.message).toBe('HTTP 503');
  });
});

describe('withBackoff', () => {
  it('returns response on first success (no retry)', async () => {
    const fn = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const response = await withBackoff(fn);
    expect(response.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    // Deterministic backoff: 2^0 * 1000 + 0 = 1000ms
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    vi.useFakeTimers();
    // Attach handler before advancing timers to avoid unhandled rejection
    let result: Response | undefined;
    const promise = withBackoff(fn).then(r => { result = r; });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();
    vi.mocked(Math.random).mockRestore();

    expect(result?.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 403 dailyLimitExceeded (throws immediately)', async () => {
    const fn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Daily limit exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } }), { status: 403 })
    );

    await expect(withBackoff(fn)).rejects.toThrow(UpstreamError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects maxRetries — throws after maxRetries+1 attempts', async () => {
    // Deterministic backoff: attempt 0 = 1000ms, attempt 1 = 2000ms
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Server error' } }), { status: 500 })
    );

    vi.useFakeTimers();
    // Attach catch before advancing timers to avoid unhandled rejection
    let error: unknown;
    const promise = withBackoff(fn, { maxRetries: 2 }).catch(e => { error = e; });
    // Advance through both backoff sleeps: 1000 + 2000 = 3000ms
    await vi.advanceTimersByTimeAsync(3000);
    await promise;
    vi.useRealTimers();
    vi.mocked(Math.random).mockRestore();

    expect(error).toBeInstanceOf(UpstreamError);
    // maxRetries=2 → attempts 0, 1, 2 = 3 fetches total (no 4th)
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
