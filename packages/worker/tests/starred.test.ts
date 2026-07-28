import { describe, it, expect } from 'vitest';
import { filesRouter } from '../src/routes/files';
import { foldersRouter } from '../src/routes/folders';

describe('Starred Endpoints', () => {
  it('registers starred endpoints for files', () => {
    const routes = filesRouter.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain('GET /starred');
    expect(routes).toContain('POST /:id/star');
    expect(routes).toContain('POST /:id/unstar');
  });

  it('registers starred endpoints for folders', () => {
    const routes = foldersRouter.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain('POST /:id/star');
    expect(routes).toContain('POST /:id/unstar');
  });
});
