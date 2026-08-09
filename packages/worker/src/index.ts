import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Env } from './types/env';
import type { AppContext } from './types/context';
import { corsMiddleware } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { csrfGuard } from './middleware/csrf-guard';
import { rateLimiter } from './middleware/rate-limiter';
import { AppError } from './lib/errors';
import { requestId } from './middleware/request-id';
import { sharedServices } from './middleware/shared-services';
import { validateEnv } from './lib/env';
import { xmlError } from './lib/s3-xml';
import { log, logError, logErrorNoCtx } from './lib/logger';
import { syncDriveAccount } from './services/sync';
import { runLifecycleExpiration, cleanupOrphanMultipartUploads } from './services/s3-lifecycle';
import { AuditRepository } from './repositories/audit.repository';
import { AuthRepository } from './repositories/auth.repository';
import { DriveRepository } from './repositories/drive.repository';
import { PolicyService } from './services/policy.service';
import { createDriveService } from './lib/drive-factory';
import { mapDriveRow } from './types/db';
import type { SyncJobMessage } from './types/env';

import { authRouter } from './routes/auth';
import { drivesRouter } from './routes/drives';
import { foldersRouter } from './routes/folders';
import { filesRouter } from './routes/files';
import { sharedRouter } from './routes/shared';
import { automationsRouter } from './routes/automations';
import { workspacesRouter } from './routes/workspaces';
import { adminRouter } from './routes/admin';
import { s3CredentialsRouter } from './routes/s3-credentials';
import { s3Router } from './routes/s3';
import { AutomationEngine } from './services/automation.service';

export const app = new Hono<AppContext>({ strict: false });

// Global middleware (order matters): request ID → security → CORS → CSRF → rate limits (below)
app.use('*', requestId);
app.use('*', securityHeaders);
app.use('*', corsMiddleware());
app.use('/api/*', csrfGuard);

app.onError((err, c) => {
  const isAppError = err instanceof AppError || err.name === 'AppError';
  const status = isAppError ? (err as AppError).status : 500;
  const message = isAppError ? err.message : 'Internal server error';

  if (status >= 500) {
    logError(c, 'Unhandled server error', err);
  } else if (status >= 400) {
    // 4xx AppErrors are application-thrown (generic 404s don't reach onError —
    // Hono returns them before this handler). Log at warn to distinguish from
    // 5xx bugs while keeping them diagnosable. The stack trace identifies which
    // of the 115 throw sites fired. errorClass is auto-extracted by log().
    log(c, 'warn', 'Client error', { status }, err);
  }

  if (c.req.path.startsWith('/s3')) {
    let s3Code = 'InternalError';
    if (status === 400) s3Code = 'InvalidRequest';
    else if (status === 401 || status === 403) s3Code = 'AccessDenied';
    else if (status === 404) s3Code = 'NoSuchKey';
    else if (status === 405) s3Code = 'MethodNotAllowed';
    else if (status === 409) s3Code = 'Conflict';

    if (
      typeof (err as unknown as Record<string, unknown>).code === 'string' &&
      (err as unknown as Record<string, unknown>).code
    ) {
      s3Code = (err as unknown as Record<string, unknown>).code as string;
    }

    return xmlError(c, s3Code, message, status);
  }

  return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 500);
});

// Rate limiters — applied before auth to protect login/register
app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, maxRequests: 10, useKV: true }));
app.use('/api/auth/register', rateLimiter({ windowMs: 600_000, maxRequests: 10, useKV: true }));
app.use(
  '/api/shared/:id/verify',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 5,
    keyFn: (c: Context) => {
      const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
      const id = c.req.param('id') ?? 'unknown';
      return `${ip}:${id}`;
    },
  }),
);
app.use(
  '/api/shared/:id/download',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    keyFn: (c: Context) => {
      const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
      const id = c.req.param('id') ?? 'unknown';
      return `${ip}:${id}`;
    },
  }),
);
app.use('/api/*', rateLimiter({ windowMs: 60_000, maxRequests: 100 }));
// ponytail: S3 rate limit — /s3 bypasses /api/* catch-all, needs its own limiter
app.use('/s3/*', rateLimiter({ windowMs: 60_000, maxRequests: 100 }));

app.route('/api/auth', authRouter);
app.route('/api/drives', drivesRouter);
app.route('/api/folders', foldersRouter);
app.route('/api/files', filesRouter);
app.use('/api/shared/*', sharedServices);
app.route('/api/shared', sharedRouter);
app.route('/api/automations', automationsRouter);
app.route('/api/workspaces', workspacesRouter);
app.route('/api/admin', adminRouter);
app.route('/api/s3-credentials', s3CredentialsRouter);
app.route('/s3', s3Router);

// Health check (public)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default {
  // Validate env bindings on every request (Workers has no boot hook; env is
  // only available inside fetch/scheduled). Fail-fast on misconfigured deploys
  // rather than throwing deep inside sign()/verify() at runtime.
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    validateEnv(env as unknown as Record<string, unknown>);
    return app.fetch(req, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    validateEnv(env as unknown as Record<string, unknown>);

    // 1. Query D1 for all drives (0 external subrequests)
    const driveRepo = new DriveRepository(env.DB);
    const { results: driveRows } = await driveRepo.findAllByType(['oauth', 'service_account']);
    const driveAccounts = (driveRows ?? []).map(mapDriveRow);

    // 2. Enqueue per-drive sync + maintenance in a single Queues API call
    //    (1 external subrequest regardless of drive count — avoids the
    //    N-subrequest ceiling of send()-in-a-loop on the Free tier).
    const messages: MessageSendRequest<SyncJobMessage>[] = [
      ...driveAccounts.map((drive) => ({ body: { type: 'sync' as const, driveId: drive.id } })),
      { body: { type: 'maintenance' as const } },
    ];
    await env.SYNC_QUEUE.sendBatch(messages);

    // 3. D1-only tasks (0 external subrequests — safe in cron invocation)
    await new AuditRepository(env.DB).cleanupOldLogs(30);

    const now = Date.now();
    const authRepo = new AuthRepository(env.DB);
    await authRepo.deleteExpiredSessions(now);
    await authRepo.deleteExpiredOAuthStates(now - 10 * 60 * 1000);
    await new DriveRepository(env.DB).deleteExpiredQuotaCache(now - 60 * 60 * 1000);
  },
  // Queue consumer — each message gets a fresh Worker invocation with its own
  // 50-subrequest budget. max_batch_size=1 ensures 1 drive per invocation.
  async queue(batch: MessageBatch<SyncJobMessage>, env: Env, ctx: ExecutionContext) {
    const driveService = createDriveService(env);

    for (const message of batch.messages) {
      try {
        if (message.body.type === 'sync' && message.body.driveId) {
          // Queue messages are generated by the cron handler (trusted internal
          // source). driveId is NOT user-supplied — safe to use findById
          // without user scoping.
          const driveRow = await new DriveRepository(env.DB).findById(message.body.driveId);
          if (driveRow) {
            const drive = mapDriveRow(driveRow);
            await syncDriveAccount(drive, env.DB, driveService);
          }
        } else if (message.body.type === 'maintenance') {
          await runLifecycleExpiration(env);
          await cleanupOrphanMultipartUploads(env);
          const engine = new AutomationEngine(env, driveService);
          await engine.processCronTrigger(ctx);
          const policyService = new PolicyService(env.DB, driveService);
          await policyService.processAutoDeleteRetentionPolicies();
        }
        message.ack();
      } catch (err) {
        logErrorNoCtx('Queue consumer error', err, {
          messageType: message.body.type,
          driveId: message.body.driveId,
        });
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, SyncJobMessage>;

// Re-export for Hono's type inference
export type { Env } from './types/env';
