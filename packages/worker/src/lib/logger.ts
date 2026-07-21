import type { Context } from 'hono';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  requestId?: string;
  path?: string;
  err?: string;
  stack?: string;
  errorClass?: string;
  [key: string]: unknown;
}

/**
 * Structured JSON logger. Workers Logs ingests JSON lines and lets you
 * filter by requestId in the Cloudflare dashboard.
 *
 * Two entry points:
 * - log(c, level, msg, ctx, err) — inside routes/middleware (has Context)
 * - logNoCtx(level, msg, ctx, err) — inside services/libs (no Context)
 *
 * Boot-time logs (node-server.ts, lib/env.ts) stay as raw console — no
 * request context exists at boot.
 */
function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  // Only use console.error (for error/warn) and console.warn (for info/debug)
  // to satisfy the no-console lint rule (only warn+error allowed).
  if (entry.level === 'error' || entry.level === 'warn') {
    console.error(line);
  } else {
    console.warn(line);
  }
}

/** Log with request context (use inside routes, middleware, onError). */
export function log(
  c: Context,
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>,
  err?: unknown,
): void {
  emit({
    ts: new Date().toISOString(),
    level,
    msg,
    requestId: c.get('requestId'),
    path: c.req.path,
    err: err instanceof Error ? err.message : undefined,
    stack: err instanceof Error ? err.stack?.split('\n')[1]?.trim() : undefined,
    errorClass: err instanceof Error ? err.constructor.name : undefined,
    ...ctx,
  });
}

/** Log without request context (use inside services, libs, boot). */
export function logNoCtx(
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>,
  err?: unknown,
): void {
  emit({
    ts: new Date().toISOString(),
    level,
    msg,
    err: err instanceof Error ? err.message : undefined,
    stack: err instanceof Error ? err.stack?.split('\n')[1]?.trim() : undefined,
    errorClass: err instanceof Error ? err.constructor.name : undefined,
    ...ctx,
  });
}

/** Convenience: log error with request context. err before ctx (err is more common). */
export function logError(
  c: Context,
  msg: string,
  err?: unknown,
  ctx?: Record<string, unknown>,
): void {
  log(c, 'error', msg, ctx, err);
}

/** Convenience: log error without request context. */
export function logErrorNoCtx(
  msg: string,
  err?: unknown,
  ctx?: Record<string, unknown>,
): void {
  logNoCtx('error', msg, ctx, err);
}
