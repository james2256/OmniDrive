import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { adminRouter } from '../src/routes/admin';

describe('Admin Invitations', () => {
  it('GET /api/admin/invitations returns 401 without auth', async () => {
    const app = new Hono();
    app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
    app.route('/api/admin', adminRouter);

    const res = await app.request('/api/admin/invitations');
    expect(res.status).toBe(401);
  });
});
