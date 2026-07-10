/**
 * Structured JSON logger for Cloudflare Workers.
 *
 * Emits one JSON object per log line with consistent fields:
 *   { ts, level, requestId, userId?, message, ...meta }
 *
 * Usage:
 *   import { log, error, warn, info, debug } from '../lib/logger';
 *   log(c, 'File uploaded', { fileId, size });
 *
 * Or create a scoped logger:
 *   const logger = createLogger(c);
 *   logger.info('Sync complete', { driveId, fileCount });
 *
 * Reference: https://developers.cloudflare.com/workers/best-practices/workers-best-practices
 * "use structured JSON logging"
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface LoggerContext {
  requestId?: string;
  userId?: string;
}

/**
 * Core log function — emits a structured JSON line.
 * Uses console.log for all levels so Cloudflare Workers Logs captures it.
 * The `level` field allows filtering in the dashboard.
 */
function emit(level: LogLevel, ctx: LoggerContext, message: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    requestId: ctx.requestId ?? 'unknown',
    message,
  };
  if (ctx.userId) {
    entry.userId = ctx.userId;
  }
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      // Don't overwrite reserved fields
      if (key !== 'ts' && key !== 'level' && key !== 'requestId' && key !== 'message') {
        entry[key] = value;
      }
    }
  }
  // Use console.log for all levels — Workers Logs captures it.
  // The `level` field is used for filtering in the dashboard.
  console.log(JSON.stringify(entry));
}

/**
 * Create a scoped logger bound to a request context.
 * Usage: const logger = createLogger({ requestId, userId }); logger.info('...');
 */
export function createLogger(ctx: LoggerContext): Logger {
  return {
    debug: (message, meta) => emit('debug', ctx, message, meta),
    info: (message, meta) => emit('info', ctx, message, meta),
    warn: (message, meta) => emit('warn', ctx, message, meta),
    error: (message, meta) => emit('error', ctx, message, meta),
  };
}

/**
 * Ad-hoc logging from a Hono context.
 * Usage: log(c, 'File uploaded', { fileId });
 *
 * Reads requestId and userId from Hono context variables (set by requestId middleware).
 */
interface HonoContext {
  get(key: string): unknown;
  req: { path: string; method: string };
}

function ctxToLoggerContext(c: HonoContext): LoggerContext {
  return {
    requestId: c.get('requestId') as string | undefined,
    userId: c.get('userId') as string | undefined,
  };
}

export function log(c: HonoContext, message: string, meta?: Record<string, unknown>): void {
  emit('info', ctxToLoggerContext(c), message, meta);
}

export function info(c: HonoContext, message: string, meta?: Record<string, unknown>): void {
  emit('info', ctxToLoggerContext(c), message, meta);
}

export function warn(c: HonoContext, message: string, meta?: Record<string, unknown>): void {
  emit('warn', ctxToLoggerContext(c), message, meta);
}

export function error(c: HonoContext, message: string, meta?: Record<string, unknown>): void {
  emit('error', ctxToLoggerContext(c), message, meta);
}

export function debug(c: HonoContext, message: string, meta?: Record<string, unknown>): void {
  emit('debug', ctxToLoggerContext(c), message, meta);
}

/**
 * Logger for background tasks (waitUntil) where Hono context is not available.
 * Capture requestId before entering waitUntil:
 *   const requestId = c.get('requestId');
 *   const userId = c.get('userId');
 *   c.executionCtx.waitUntil(
 *     (async () => {
 *       const logger = createBackgroundLogger({ requestId, userId });
 *       logger.info('Sync started', { driveId });
 *     })()
 *   );
 */
export function createBackgroundLogger(ctx: LoggerContext): Logger {
  return createLogger(ctx);
}
