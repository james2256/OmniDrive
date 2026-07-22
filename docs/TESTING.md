# TESTING.md — Testing Guide

OmniDrive has 3 test suites: worker unit tests, worker integration tests, and web component tests.

---

## Test counts

| Suite | Files | Tests | Runner | D1 |
|-------|-------|-------|--------|----|
| Worker unit | 48 | 246 | Vitest | Mocked |
| Worker integration | 9 | 65 | Vitest + `@cloudflare/vitest-pool-workers` | Real (Miniflare) |
| Web component | 16 | 59 | Vitest + jsdom | N/A |
| **Total** | **73** | **370** | | |

---

## Commands

```bash
# All tests
npm run test

# Worker unit tests only (mocked D1)
npm run test:worker

# Web component tests only
npm run test:web

# Worker integration tests (real D1 via Miniflare)
cd packages/worker
npm run test:integration

# Watch mode (re-runs on file change)
cd packages/worker && npm run test:watch
cd packages/web && npm run test:watch

# Single test file
cd packages/worker
npx vitest run tests/s3-api.test.ts

# Single integration test
cd packages/worker
npx vitest run --config vitest.integration.config.mts tests/integration/auth-flow.test.ts
```

---

## Worker unit tests

**Location:** `packages/worker/tests/*.test.ts`

**D1 handling:** Mocked at the SQL-string level. Each test creates a fake `D1Database` that intercepts `prepare()` calls and returns hardcoded rows based on the SQL string:

```typescript
function makeDb() {
  return {
    prepare(sql: string) {
      const stmt = {
        bind(...args: unknown[]) { return stmt; },
        async first() {
          if (sql.includes('FROM shared_links')) return sharedLinkRow;
          return null;
        },
        async run() { return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
  };
}
```

**What they test:**
- S3 SigV4 authentication, XML responses, multipart upload protocol
- PKCE flow, password hashing (PBKDF2), session cookie handling
- CSRF guard, rate limiter, security headers
- Zod schema validation
- Google Drive API client (mocked `fetch`)
- Drive quota computation
- File move logic, breadcrumb generation

---

## Worker integration tests

**Location:** `packages/worker/tests/integration/*.test.ts`

**D1 handling:** Real D1 via Miniflare (Cloudflare's local Workers runtime). SQL actually executes against SQLite.

**Config:** `packages/worker/vitest.integration.config.mts`

**Shared helpers:** `packages/worker/tests/integration/helpers.ts`
- `ensureSchema(db)` — creates all tables (inline DDL matching `schema.sql`)
- `clearAllTables(db)` — deletes all rows between tests for isolation

**What they test:**
- Auth flow: register → login → /me → change-password → logout → session revoke
- Workspace RBAC: add member, role escalation prevention, audit log, self-removal, last-owner
- Shared links: create, download quota enforcement (atomic RETURNING)
- File SQL: recent (EXISTS subquery), search (dynamic SQL + json_extract), starred, trash
- Folder browsing: tree, workspace contents, folder contents, cursor pagination
- OAuth callback: PKCE state lookup, invalid/expired state
- S3 protocol: ListBuckets, PutObject, DeleteObject, multipart
- Repositories: admin, S3 credentials, automations, drive listing, shared-with-me

**Test isolation:** Each test file gets a fresh Miniflare D1 instance. Within a file, `beforeEach` calls `clearAllTables` to reset between tests.

---

## Web component tests

**Location:** `packages/web/src/**/*.test.tsx` and `packages/web/tests/**/*.test.tsx`

**Environment:** jsdom (simulated DOM)

**What they test:**
- Component rendering (Sidebar, Header, AdminUsersPage, DashboardPage, FilesPage)
- Form submission (SettingsAccountTab, ShareModal, SettingsS3Tab, SettingsDrivesTab)
- Store logic (useSelectionStore, useUIStore)
- Utility functions (sort-items, API client)

**Mocking pattern:**
```typescript
vi.mock('../../lib/api', () => ({
  api: { changePassword: vi.fn() },
}));
vi.mock('../../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));
```

---

## Integration test helpers

### `insertUserAndSession(username, password?)`

Creates a user + session directly via D1 (bypasses the register route's rate limiter). Returns `{ userId, cookie }`.

```typescript
const user = await insertUserAndSession('alice');
// user.cookie = 'omnidrive_sid=session-alice-...'
```

### `createWorkspace(ownerUserId, wsId)`

Creates a workspace + adds the owner as 'owner' role.

### `addMember(workspaceId, userId, role)`

Adds a user to a workspace with a specific role.

### `createDrive(userId, driveId)`

Creates a drive_accounts row.

### `createFile(params)`

Creates a files row with optional workspace/folder assignment.

---

## CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR and push to `main`:

1. `npm ci` — install deps
2. `npm run lint` — ESLint
3. `npm run typecheck` — TypeScript (both packages)
4. `npm run test` — worker unit + web tests

Integration tests are NOT in CI (they require Miniflare + `wrangler.toml`). Run them locally before deploying.

---

## Writing new tests

### Unit test (worker)

1. Create `packages/worker/tests/my-feature.test.ts`
2. Mock `D1Database` at the SQL-string level
3. Mock external APIs (`fetch`, `GoogleDriveService`)
4. Test the function directly

### Integration test (worker)

1. Create `packages/worker/tests/integration/my-feature.test.ts`
2. Import `ensureSchema` + `clearAllTables` from `./helpers`
3. Use `app.request(path, init, env)` to test the full HTTP stack
4. Assert on response status + body + D1 state

### Component test (web)

1. Create `packages/web/src/components/MyComponent.test.tsx`
2. Mock stores + API + icons + UI primitives
3. Use `render()` + `screen.getByText()` / `fireEvent` / `waitFor`
4. Assert on rendered output + mock call arguments
