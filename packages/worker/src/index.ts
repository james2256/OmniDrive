import { Hono } from 'hono';
import type { AppContext, Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { runScheduledSync } from './services/sync';

import { authRouter } from './routes/auth';
import { drivesRouter } from './routes/drives';
import { foldersRouter } from './routes/folders';
import { filesRouter } from './routes/files';
import { sharedRouter } from './routes/shared';
import { automationsRouter } from './routes/automations';
import { AutomationEngine } from './services/automation.service';

const app = new Hono<AppContext>({ strict: false });

// Global middleware
app.use('*', corsMiddleware());
app.use('*', errorHandler);

app.route('/api/auth', authRouter);
app.route('/api/drives', drivesRouter);
app.route('/api/folders', foldersRouter);
app.route('/api/files', filesRouter);
app.route('/api/shared', sharedRouter);
app.route('/api/automations', automationsRouter);

// Health check (public)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('Cron triggered:', event.cron);
    ctx.waitUntil(runScheduledSync(env));
    const engine = new AutomationEngine(env);
    ctx.waitUntil(engine.processCronTrigger(ctx));
  },
} satisfies ExportedHandler<Env>;

// Re-export for Hono's type inference
export type { Env } from './types/env';
