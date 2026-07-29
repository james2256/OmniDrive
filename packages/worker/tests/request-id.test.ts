import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../src/middleware/request-id';

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.get('/test', (c) => c.json({ requestId: c.get('requestId') as string }));
  return app;
}

describe('requestId', () => {
  let app: Hono;
  beforeEach(() => {
    app = createApp();
  });

  it('generates a new request ID when no X-Request-Id header is provided', async () => {
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBeTruthy();
    expect(typeof body.requestId).toBe('string');
  });

  it('preserves an existing X-Request-Id header value', async () => {
    const res = await app.request('/test', { headers: { 'X-Request-Id': 'provided-id-123' } });
    const body = await res.json();
    expect(body.requestId).toBe('provided-id-123');
  });

  it('sets the generated ID on the response headers', async () => {
    const res = await app.request('/test');
    const headerId = res.headers.get('x-request-id');
    expect(headerId).toBeTruthy();
    expect(typeof headerId).toBe('string');
  });

  it('sets the preserved X-Request-Id on the response headers', async () => {
    const res = await app.request('/test', { headers: { 'X-Request-Id': 'response-id-456' } });
    expect(res.headers.get('x-request-id')).toBe('response-id-456');
  });

  it('response header matches the value stored on the context', async () => {
    const res = await app.request('/test');
    const body = await res.json();
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('generated IDs are in UUID v4 format', async () => {
    const res = await app.request('/test');
    const body = await res.json();
    // UUID v4: 8-4-4-4-12 hex, version nibble is 4, variant is 8/9/a/b
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a different ID on each request', async () => {
    const res1 = await app.request('/test');
    const res2 = await app.request('/test');
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.requestId).not.toBe(body2.requestId);
  });

  it('makes the ID accessible via c.get("requestId")', async () => {
    const localApp = new Hono();
    localApp.use('*', requestId);
    localApp.get('/test', (c) => {
      const id = c.get('requestId') as string;
      return c.json({ id });
    });
    const res = await localApp.request('/test', { headers: { 'X-Request-Id': 'ctx-id-789' } });
    const body = await res.json();
    expect(body.id).toBe('ctx-id-789');
  });

  it('does not overwrite the X-Request-Id when the header is absent (uses UUIDv4)', async () => {
    const res = await app.request('/test');
    const headerId = res.headers.get('x-request-id');
    expect(headerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
