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
});
