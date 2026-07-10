import { describe, it, expect } from 'vitest';
import { filesRouter } from '../src/routes/files';

describe('Files Router', () => {
  it('registers trash endpoints', () => {
    const routes = filesRouter.routes.map(r => `${r.method} ${r.path}`);
    expect(routes).toContain('GET /trash');
    expect(routes).toContain('POST /:id/restore');
    expect(routes).toContain('DELETE /:id/permanent');
    expect(routes).toContain('GET /:id/preview');
    expect(routes).toContain('GET /:id/download');
  });
});
