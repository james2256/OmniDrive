/**
 * Shared constants for OmniDrive.
 *
 * Use these in NEW code instead of magic numbers. Existing code may still
 * use inline values — they'll be migrated incrementally during refactoring.
 *
 * Reference: CONTRIBUTING.md "The One Way" — extract magic numbers to constants.
 */

// ─── Session Management ───

/** Session TTL: 7 days (in milliseconds). Reference: session-cookie.ts */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Session TTL: 7 days (in seconds, for cookie maxAge). */
export const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

/** Throttle: only extend session TTL if untouched for 1 hour. Reference: auth-guard.ts */
export const SESSION_TOUCH_THROTTLE_MS = 60 * 60 * 1000;

/** Absolute session max age: 30 days (in milliseconds). */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Rate Limiting ───

/** Global API rate limit: 100 requests per minute. */
export const RATE_LIMIT_GLOBAL_MAX = 100;
export const RATE_LIMIT_GLOBAL_WINDOW_MS = 60 * 1000;

/** Login rate limit: 10 attempts per minute. */
export const RATE_LIMIT_LOGIN_MAX = 10;
export const RATE_LIMIT_LOGIN_WINDOW_MS = 60 * 1000;

/** Registration rate limit: 10 per 10 minutes. */
export const RATE_LIMIT_REGISTER_MAX = 10;
export const RATE_LIMIT_REGISTER_WINDOW_MS = 10 * 60 * 1000;

/** Shared link verify rate limit: 5 per minute per IP+linkId. */
export const RATE_LIMIT_SHARED_VERIFY_MAX = 5;
export const RATE_LIMIT_SHARED_VERIFY_WINDOW_MS = 60 * 1000;

// ─── Shared Link Security ───

/** Shared link password lockout: 20 failed attempts triggers 15-min lockout. */
export const SHARED_LINK_LOCKOUT_THRESHOLD = 20;
export const SHARED_LINK_LOCKOUT_DURATION_SEC = 15 * 60;

/** Shared link session cookie TTL: 24 hours (in seconds). */
export const SHARED_LINK_SESSION_TTL_SEC = 60 * 60 * 24;

// ─── S3 API ───

/** S3 SigV4 clock skew tolerance: ±15 minutes. Reference: s3-auth.ts */
export const S3_CLOCK_SKEW_MS = 15 * 60 * 1000;

/** S3 presigned URL max expiry: 7 days (604800 seconds). Reference: s3-auth.ts */
export const S3_MAX_PRESIGN_SEC = 604_800;

// ─── Sync ───

/** D1 batch size for bulk upserts. Reference: sync.ts */
export const D1_BATCH_SIZE = 100;

/** Drive sync TTL: folders stale after 5 minutes (default). Reference: schema.sql workspaces.sync_ttl_minutes */
export const SYNC_TTL_MINUTES_DEFAULT = 5;

// ─── Password Hashing ───

/** PBKDF2 iterations: 10,000 (Workers CPU-safe; OWASP recommends 600k for non-Workers). */
export const PBKDF2_ITERATIONS = 10_000;

/** PBKDF2 salt length: 16 bytes (128 bits). */
export const PBKDF2_SALT_BYTES = 16;

/** PBKDF2 output length: 256 bits (32 bytes). */
export const PBKDF2_KEY_BITS = 256;

// ─── File Listing ───

/** Maximum files/folders returned per listing (cursor pagination). */
export const FOLDER_LIST_LIMIT_DEFAULT = 50;
export const FOLDER_LIST_LIMIT_MAX = 100;
