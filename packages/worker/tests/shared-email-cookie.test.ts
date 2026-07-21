import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import type { AppContext } from '../src/types/env';
import { sharedRouter } from '../src/routes/shared';
import { sharedServices } from '../src/middleware/shared-services';

const LINK_ID = 'link-email-1';
const JWT_SECRET = 'test-jwt-secret';

const sharedLinkRow = {
  id: LINK_ID,
  user_id: 'owner-1',
  target_type: 'folder',
  target_id: 'folder-1',
  password_hash: null,
  expires_at: null,
  allow_downloads: 1,
  allow_uploads: 0,
  max_downloads: null,
  require_email: 1,
  webhook_url: null,
  view_count: 0,
  download_count: 0,
};

function makeDb() {
  return {
    prepare(sql: string) {
      const stmt = {
        bind(..._args: unknown[]) {
          return stmt;
        },
        async first() {
          if (sql.includes('FROM shared_links')) return sharedLinkRow;
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

function makeApp() {
  const app = new Hono<AppContext>();
  app.use('/shared/*', sharedServices);
  app.route('/shared', sharedRouter);
  return app;
}

const env = {
  DB: makeDb(),
  KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  JWT_SECRET,
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  FRONTEND_URL: 'http://localhost',
  WORKER_URL: 'http://localhost',
} as unknown as AppContext['Bindings'];

const executionCtx = { waitUntil: vi.fn() };

describe('shared_email cookie signing', () => {
  it('rejects forged raw email cookie without JWT signature', async () => {
    const app = makeApp();
    const res = await app.request(
      `/shared/${LINK_ID}/meta`,
      { headers: { Cookie: `shared_email_${LINK_ID}=attacker@evil.com` } },
      env,
      executionCtx,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiresEmail).toBe(true);
  });

  it('accepts signed email JWT cookie for requireEmail links', async () => {
    const token = await sign(
      { id: LINK_ID, email: 'visitor@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET,
      'HS256',
    );

    const app = makeApp();
    const res = await app.request(
      `/shared/${LINK_ID}/meta`,
      { headers: { Cookie: `shared_email_${LINK_ID}=${token}` } },
      env,
      executionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('folder');
  });

  it('POST /:id/email sets a signed JWT cookie, not raw email', async () => {
    const app = makeApp();
    const res = await app.request(
      `/shared/${LINK_ID}/email`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'visitor@example.com' }),
      },
      env,
      executionCtx,
    );

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`shared_email_${LINK_ID}=`);
    expect(setCookie).not.toContain('visitor@example.com');
  });
});