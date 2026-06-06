import { Hono } from 'hono';
import type { AppContext, Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';

import { authRouter } from './routes/auth';

const app = new Hono<AppContext>();

// Global middleware
app.use('*', corsMiddleware());
app.use('*', errorHandler);

app.route('/api/auth', authRouter);

// Health check (public)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    console.log('Cron triggered:', event.cron);
  },
} satisfies ExportedHandler<Env>;

// Re-export for Hono's type inference
export type { Env } from './types/env';
