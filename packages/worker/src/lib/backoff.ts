import { UpstreamError } from '../middleware/error-handler';

interface DriveApiError {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string }>;
  };
}

const RETRYABLE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'internalError',
]);

const NON_RETRYABLE_REASONS = new Set([
  'dailyLimitExceeded',
  'usageLimits',
  'quotaExceeded',
  'invalidCredentials',
  'authError',
]);

export async function parseDriveError(response: Response): Promise<{ status: number; reason: string | null; message: string }> {
  const status = response.status;
  let body: string;
  try {
    body = await response.text();
  } catch {
    return { status, reason: null, message: `HTTP ${status}` };
  }
  try {
    const parsed = JSON.parse(body) as DriveApiError;
    const reason = parsed.error?.errors?.[0]?.reason ?? null;
    const message = parsed.error?.message || `HTTP ${status}`;
    return { status, reason, message };
  } catch {
    return { status, reason: null, message: body || `HTTP ${status}` };
  }
}

export function isRetryable(status: number, reason: string | null): boolean {
  if (status >= 500 && status < 600) return true;
  if (status === 429) return true;
  if (status === 403 && reason && RETRYABLE_REASONS.has(reason)) return true;
  if (reason && NON_RETRYABLE_REASONS.has(reason)) return false;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fetch with exponential backoff + jitter.
 *
 * - Retries on 429, 5xx, and 403 rateLimitExceeded (transient Google errors).
 * - Does NOT retry 401 (handled by getValidToken token refresh) or 403
 *   dailyLimitExceeded (exhausted quota — retrying won't help).
 * - Truncated backoff: 2^n * 1000 + jitter(0..1000), capped at maxBackoffMs.
 *
 * @param opts.isSuccess - Custom success predicate (default: response.ok).
 *   Use for endpoints where a non-ok status is expected success (e.g. deleteFile
 *   treats 404 "already deleted" as success).
 * @returns The successful Response (body intact for caller to read).
 * @throws UpstreamError when all retries are exhausted or the error is non-retryable.
 */
export async function withBackoff(
  fn: () => Promise<Response>,
  opts: { maxRetries?: number; maxBackoffMs?: number; isSuccess?: (response: Response) => boolean } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const maxBackoffMs = opts.maxBackoffMs ?? 32000;
  const isSuccess = opts.isSuccess ?? ((r) => r.ok);

  let lastMessage = 'Google Drive API request failed';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fn();

    if (isSuccess(response)) return response;

    const { status, reason, message } = await parseDriveError(response);
    lastMessage = message;

    if (attempt === maxRetries) break;
    if (!isRetryable(status, reason)) break;

    const backoffMs = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 1000, maxBackoffMs);
    await sleep(backoffMs);
  }

  throw new UpstreamError(lastMessage);
}
