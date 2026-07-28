import { describe, it, expect } from 'vitest';
import { authRouter } from '../src/routes/auth';

describe('Auth Setup & Register', () => {
  it('registers setup-status endpoint', () => {
    const routes = authRouter.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain('GET /setup-status');
  });
});
