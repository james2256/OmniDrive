import { logErrorNoCtx } from './logger';

/**
 * Parse a JSON string from persisted data (D1 rows, cache payloads) with a
 * safe fallback. Returns `fallback` if the string is null, empty, or invalid
 * JSON, and logs the failure so corrupt rows are visible to admins.
 *
 * Prefer this over bare `JSON.parse` for any value read from D1 or KV — a
 * corrupt row should degrade gracefully, not crash the request with a 500.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logErrorNoCtx('safeJsonParse: failed to parse persisted JSON', error, {
      valuePreview: value.slice(0, 100),
    });
    return fallback;
  }
}
