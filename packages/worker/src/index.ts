import { Hono } from 'hono';
import type { AppContext, Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { csrfGuard } from './middleware/csrf-guard';
import { rateLimiter } from './middleware/rate-limiter';
import { runScheduledSync } from './services/sync';
import { runLifecycleExpiration, cleanupOrphanMultipartUploads } from './services/s3-lifecycle';
import { AuditService } from './services/audit.service';
import { PolicyService } from './services/policy.service';

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

// Global middleware (order matters)
app.use('*', securityHeaders);
app.use('*', corsMiddleware());
app.use('/api/*', csrfGuard);

import { AppError } from './middleware/error-handler';

function escapeXml(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

app.onError((err, c) => {
  const isAppError = err instanceof AppError || err.name === 'AppError';
  const status = isAppError ? (err as any).status : 500;
  const message = isAppError ? err.message : 'Internal server error';
  
  if (status >= 500) {
    console.error('Unhandled server error:', err);
  }
  
  if (c.req.path.startsWith('/s3')) {
    let s3Code = 'InternalError';
    if (status === 400) s3Code = 'InvalidRequest';
    else if (status === 401 || status === 403) s3Code = 'AccessDenied';
    else if (status === 404) s3Code = 'NoSuchKey';
    else if (status === 405) s3Code = 'MethodNotAllowed';
    else if (status === 409) s3Code = 'Conflict';

    if (typeof (err as any).code === 'string' && (err as any).code) {
      s3Code = (err as any).code;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${escapeXml(s3Code)}</Code>
  <Message>${escapeXml(message)}</Message>
</Error>`;
    c.header('Content-Type', 'application/xml');
    return c.text(xml, status as any);
  }
  
  return c.json({ error: message }, status as any);
});

// Rate limiters — applied before auth to protect login/register
app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, maxRequests: 10 }));
app.use('/api/auth/register', rateLimiter({ windowMs: 600_000, maxRequests: 10 }));
app.use('/api/shared/:id/verify', rateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  keyFn: (c: any) => {
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
    const id = c.req.param('id') ?? 'unknown';
    return `${ip}:${id}`;
  },
}));
app.use('/api/shared/:id/download', rateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  keyFn: (c: any) => {
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
    const id = c.req.param('id') ?? 'unknown';
    return `${ip}:${id}`;
  },
}));
app.use('/api/*', rateLimiter({ windowMs: 60_000, maxRequests: 100 }));
// ponytail: S3 rate limit — /s3 bypasses /api/* catch-all, needs its own limiter
app.use('/s3/*', rateLimiter({ windowMs: 60_000, maxRequests: 100 }));

app.route('/api/auth', authRouter);
app.route('/api/drives', drivesRouter);
app.route('/api/folders', foldersRouter);
app.route('/api/files', filesRouter);
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
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledSync(env));
    ctx.waitUntil(runLifecycleExpiration(env));
    ctx.waitUntil(cleanupOrphanMultipartUploads(env));
    const engine = new AutomationEngine(env);
    ctx.waitUntil(engine.processCronTrigger(ctx));

    // Audit log cleanup
    const auditService = new AuditService(env.DB);
    ctx.waitUntil(auditService.cleanupOldLogs(30));

    // Data retention policies
    const policyService = new PolicyService(env.DB);
    ctx.waitUntil(policyService.processAutoDeleteRetentionPolicies(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET));

    // Expired session cleanup (D1 has no auto-expiry unlike KV TTL)
    ctx.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run());

    // Cleanup expired OAuth states (10-min TTL) + stale quota cache (>1h old)
    ctx.waitUntil(env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(Date.now() - 10 * 60 * 1000).run());
    ctx.waitUntil(env.DB.prepare('DELETE FROM quota_cache WHERE updated_at < ?').bind(Date.now() - 60 * 60 * 1000).run());
  },
} satisfies ExportedHandler<Env>;

// Re-export for Hono's type inference
export type { Env } from './types/env';
