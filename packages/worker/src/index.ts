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
import { logError } from './lib/logger';
import { runScheduledSync } from './services/sync';
import { runLifecycleExpiration, cleanupOrphanMultipartUploads } from './services/s3-lifecycle';
import { AuditRepository } from './repositories/audit.repository';
import { AuthRepository } from './repositories/auth.repository';
import { DriveRepository } from './repositories/drive.repository';
import { PolicyService } from './services/policy.service';
import { createDriveService } from './lib/drive-factory';

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
    logError(c, 'Unhandled server error', err, { errorClass: err.constructor.name });
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
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Heavy tasks run first (Google API + D1), sequentially to avoid D1 subrequest
    // budget contention on Free tier (50/invocation). Cron has no HTTP response to
    // return quickly, so blocking is fine — the Worker stays alive until all finish.
    await runScheduledSync(env);
    await runLifecycleExpiration(env);
    await cleanupOrphanMultipartUploads(env);
    const engine = new AutomationEngine(env, createDriveService(env));
    await engine.processCronTrigger(ctx);

    // Audit log cleanup
    await new AuditRepository(env.DB).cleanupOldLogs(30);

    // Data retention policies
    const driveService = createDriveService(env);
    const policyService = new PolicyService(env.DB, driveService);
    await policyService.processAutoDeleteRetentionPolicies();

    // Light cleanup — cheap D1 DELETEs, safe to run after heavy tasks
    const now = Date.now();
    const authRepo = new AuthRepository(env.DB);
    await authRepo.deleteExpiredSessions(now);

    // Cleanup expired OAuth states (10-min TTL) + stale quota cache (>1h old)
    await authRepo.deleteExpiredOAuthStates(now - 10 * 60 * 1000);
    await new DriveRepository(env.DB).deleteExpiredQuotaCache(now - 60 * 60 * 1000);
  },
} satisfies ExportedHandler<Env>;

// Re-export for Hono's type inference
export type { Env } from './types/env';
