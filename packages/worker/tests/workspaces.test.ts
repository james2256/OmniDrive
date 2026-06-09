import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { workspacesRouter } from '../src/routes/workspaces';

describe('Workspaces API', () => {
  it('should list workspaces', async () => {
    const app = new Hono();
    app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
    app.route('/workspaces', workspacesRouter);
    
    const res = await app.request('/workspaces');
    expect(res.status).toBe(401);
  });

  it('should have members endpoints', async () => {
    const app = new Hono().route('/workspaces', workspacesRouter);
    const req = new Request('http://localhost/workspaces/123/members', { method: 'POST' });
    const res = await app.request(req);
    expect(res.status).not.toBe(404);
  });
});
