/**
 * Fetch a single file with exponential backoff, mirroring the worker-side
 * withBackoff pattern (packages/worker/src/lib/backoff.ts:71) and the
 * client-side uploadChunkWithRetry pattern (packages/web/src/lib/api/core.ts:160).
 *
 * Retries ONLY on transient errors:
 *   - 429 (rate limit) — respects Retry-After header (set by rate-limiter.ts:81)
 *   - 5xx (server errors)
 *   - Network errors (TypeError: Failed to fetch)
 *
 * Does NOT retry permanent client errors:
 *   - 404 (file deleted) — retrying won't bring it back
 *   - 403 (permission revoked) — retrying won't help
 *   - 410 (link expired) — retrying won't help
 *
 * @returns The successful Response, or null if all retries exhausted or
 *          the error is non-retryable. null = "skip this file, don't abort
 *          the whole ZIP" — the caller (asyncPool) yields nothing for it and
 *          continues with the next file.
 */
export async function fetchDownloadWithRetry(
  url: string,
  opts: RequestInit,
  maxRetries = 3,
): Promise<Response | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      // 429 and 5xx are retryable; 4xx (except 429) is non-retryable.
      if (res.status !== 429 && res.status < 500) return null;
      // Retryable: fall through to backoff (unless this was the last attempt)
      if (attempt < maxRetries) {
        await sleep(backoffMs(res, attempt));
      }
    } catch (err) {
      // Network error (TypeError: Failed to fetch) — retryable.
      // AbortError is NOT retryable — re-throw so the caller can stop the pool.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (attempt === maxRetries) return null;
      await sleep(Math.pow(2, attempt) * 1000); // 1s, 2s, 4s
    }
  }
  return null; // all retries exhausted
}

/**
 * Compute backoff delay in ms. Respects the server's Retry-After header
 * (set by packages/worker/src/middleware/rate-limiter.ts:81 on 429 responses)
 * when present; otherwise uses exponential backoff 1s, 2s, 4s mirroring
 * packages/web/src/lib/api/core.ts:177 (uploadChunkWithRetry).
 *
 * Capped at 32s (matches worker's withBackoff maxBackoffMs, backoff.ts:80).
 */
function backoffMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 32_000);
  }
  return Math.min(Math.pow(2, attempt) * 1000, 32_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
