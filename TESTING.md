# Testing Guide

This document explains OmniDrive's testing strategy and how to write tests.

## Quick start

```bash
# Run all tests (worker + web)
npm test

# Run worker tests only
npm run test --prefix packages/worker

# Run web tests only
npm run test --prefix packages/web

# Run a single test file
npm run test --prefix packages/worker -- tests/s3-api.test.ts

# Run in watch mode
npm run test:watch --prefix packages/worker
npm run test:watch --prefix packages/web

# Run with coverage report
npm run test:coverage --prefix packages/worker
npm run test:coverage --prefix packages/web
```

## Test structure

```
packages/worker/
  tests/              ← integration & unit tests
    *.test.ts
  src/tests/          ← unit tests for lib functions
    *.test.ts
  vitest.config.ts

packages/web/
  src/**/*.test.tsx   ← component & store tests (co-located)
  vite.config.ts      ← test config (jsdom environment)
```

## Current state

- **Worker**: 49 test files covering routes, middleware, services, and lib functions
- **Web**: 10 test files covering stores, lib utilities, and components
- **Environment**: Vitest with jsdom (web) / Node (worker)
- **Mocks**: Hand-rolled D1/KV mocks (no Miniflare yet)

## Writing tests

### Unit test (pure function)

```typescript
import { describe, it, expect } from 'vitest';
import { mapFileRow } from '../../src/types';

describe('mapFileRow', () => {
  it('maps snake_case row to camelCase FileEntry', () => {
    const row = { id: '1', is_starred: 1, is_trashed: 0, ... };
    const result = mapFileRow(row);
    expect(result.isStarred).toBe(true);
    expect(result.isTrashed).toBe(false);
  });
});
```

### Route test (with mock D1)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { filesRouter } from '../../src/routes/files';

// Create a mock D1
const mockDb = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      run: vi.fn(() => ({ success: true, meta: { changes: 1 } })),
      first: vi.fn(() => null),
    })),
  })),
};

describe('POST /api/files/:id/star', () => {
  it('returns 404 for non-existent file', async () => {
    // ... test setup
  });
});
```

### Component test (web)

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileGrid } from '../FileGrid';

describe('FileGrid', () => {
  it('renders empty state when no files', () => {
    render(<FileGrid files={[]} subfolders={[]} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });
});
```

## Future: @cloudflare/vitest-pool-workers

The current tests use hand-rolled D1 mocks. The plan is to migrate to
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
which runs tests in the real `workerd` runtime with real D1/KV bindings.

This migration will:
- Eliminate 50+ lines of mock boilerplate per test
- Catch D1 polyfill bugs (like the `meta.changes` bug fixed in PR 1)
- Enable true integration tests (route → service → real D1)

**Why not done yet**: The migration requires updating all 49 existing tests
to use the new test harness. This is planned for after Phase 6 (refactor)
to avoid churn.

### When we do migrate, the config will be:

```typescript
// vitest.config.ts (future)
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          kvNamespaces: ['KV'],
        },
      },
    },
  },
});
```

### Example integration test (future)

```typescript
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

describe('POST /api/files/:id/star', () => {
  beforeAll(async () => {
    // Seed real D1
    await env.DB.prepare('INSERT INTO users ...').run();
  });

  it('stars a file', async () => {
    const res = await SELF.fetch('https://example.com/api/files/123/star', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });
});
```

## Test quality guidelines

- **Don't write smoke-only tests** — tests that only check `router.routes.includes('GET /path')` provide false confidence. Test actual behavior.
- **Test behavior, not implementation** — don't assert on internal function calls; assert on observable outcomes (HTTP response, DB state).
- **Use descriptive names** — `it('returns 404 for non-existent file')` not `it('works')`.
- **One assertion per test** when possible — makes failures easier to diagnose.
- **Seed before each test** — don't share state between tests.

## Coverage

Run coverage with:

```bash
npm run test:coverage --prefix packages/worker
npm run test:coverage --prefix packages/web
```

Coverage reports are in `packages/worker/coverage/` and `packages/web/coverage/`.

Coverage thresholds are currently set to 0 (don't fail builds). After Phase 6
refactor, we'll set minimum thresholds and enforce them in CI.
