import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from '../src/middleware/cors';

function createApp(frontendUrl = 'https://app.example.com') {
  const app = new Hono<{ Bindings: { FRONTEND_URL: string } }>();
  app.use('*', corsMiddleware());
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));
  return { app, env: { FRONTEND_URL: frontendUrl } };
}

describe('corsMiddleware', () => {
  it('sets Access-Control-Allow-Origin for an allowed origin', async () => {
    const { app, env } = createApp('https://app.example.com');
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });

  it('sets Access-Control-Allow-Methods on OPTIONS preflight', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    );
  });

  it('sets Access-Control-Allow-Headers on OPTIONS preflight', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type,Content-Range,X-Upload-Url',
    );
  });

  it('handles OPTIONS preflight with 204 and no body', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('allows credentials (sets Access-Control-Allow-Credentials: true)', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('rejects disallowed origins (no Access-Control-Allow-Origin header)', async () => {
    const { app, env } = createApp('https://app.example.com');
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://evil.com' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('still sets Access-Control-Allow-Credentials for disallowed origins', async () => {
    const { app, env } = createApp('https://app.example.com');
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://evil.com' } },
      env,
    );
    // Hono's cors middleware sets credentials unconditionally when opts.credentials is true
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('omits Access-Control-Allow-Origin when no Origin header is sent', async () => {
    const { app, env } = createApp('https://app.example.com');
    const res = await app.request('/test', { method: 'GET' }, env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows localhost origins in development (FRONTEND_URL contains localhost)', async () => {
    const { app, env } = createApp('http://localhost:5173');
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'http://localhost:3000' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('rejects localhost origins when FRONTEND_URL is not localhost', async () => {
    const { app, env } = createApp('https://app.example.com');
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'http://localhost:3000' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects localhost origins with non-http protocol in dev mode', async () => {
    const { app, env } = createApp('http://localhost:5173');
    // isLocalhostOrigin requires protocol === 'http:' — https://localhost is rejected
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://localhost:3000' } },
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sets Vary: Origin on OPTIONS preflight', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('sets Access-Control-Max-Age on OPTIONS preflight', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('appends Vary: Origin on non-preflight responses', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('reflects the actual request Origin (not a wildcard) when allowed', async () => {
    const { app, env } = createApp('https://app.example.com');
    const res = await app.request(
      '/test',
      { method: 'GET', headers: { Origin: 'https://app.example.com' } },
      env,
    );
    // The middleware echoes the specific origin back rather than '*'
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });
});
