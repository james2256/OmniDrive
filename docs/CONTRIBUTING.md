# Contributing to OmniDrive

## Quick Start (10 min)

### Prerequisites

- [Node.js](https://nodejs.org/) 24+ (`node --version`)
- npm (comes with Node.js)
- [Git](https://git-scm.com/)

### Setup

```bash
# 1. Clone
git clone https://github.com/james2256/OmniDrive.git
cd OmniDrive

# 2. Install dependencies
npm install

# 3. Create local D1 database + run migrations
cd packages/worker
npx wrangler d1 create omnidrive   # skip if "already exists" — use existing database_id in wrangler.toml
npm run db:migrate:local

# 4. Generate secrets (Wrangler reads .dev.vars for local dev)
node -e "
const jwt = crypto.randomUUID().replace(/-/g,'');
const key = crypto.randomUUID().replace(/-/g,'');
require('fs').writeFileSync('.dev.vars',
  'JWT_SECRET=' + jwt + '\n' +
  'TOKEN_ENCRYPTION_KEY=' + key + '\n' +
  'WORKER_URL=http://localhost:8888\n' +
  'FRONTEND_URL=http://localhost:8999\n' +
  'GOOGLE_CLIENT_ID=\n' +
  'GOOGLE_CLIENT_SECRET=\n'
);
"

# 5. Start dev server (worker on :8888 + web on :8999)
cd ~/OmniDrive
npm run dev
```

Open **http://localhost:8999** — redirects to `/setup` to create your first admin account.

> **Google OAuth is optional** for local dev. Username/password auth works without it. Add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to `.dev.vars` only if you want to test the "Connect Google Drive" button.

### Running tests

```bash
npm run test              # all tests (worker unit + web)
npm run test:worker       # worker unit tests only (48 files)
npm run test:web          # web tests only (16 files)
cd packages/worker && npm run test:integration   # integration tests (9 files, real D1 via Miniflare)
npm run lint              # ESLint
npm run typecheck         # TypeScript (both packages)
```

---

## Architecture

OmniDrive is a monorepo with two packages:

```
packages/worker/          # Backend (Cloudflare Worker / Hono)
  src/
    routes/               # 10 route files — thin HTTP orchestrators (no SQL)
    services/             # 14 service files — business logic + RBAC (no SQL)
    repositories/         # 9 repository files — all SQL lives here
    middleware/           # 11 middleware — auth, CORS, CSRF, rate limit, request ID, RBAC, S3 auth
    lib/                  # 16 utility files — crypto, validation, env, logger, schemas, password, PKCE
    db/                   # D1 schema (schema.sql)
  migrations/             # 4 numbered SQL migrations
  tests/                  # 48 unit test files
  tests/integration/      # 9 integration test files (real D1 via Miniflare)

packages/web/             # Frontend (React 19 + Vite)
  src/
    components/           # 6 directories: files, layout, legal, settings, ui, workspaces
    pages/                # 19 page components (Dashboard, Files, Settings, Admin, Search, etc.)
    stores/               # 6 Zustand stores (auth, UI, upload, toast, selection, automation)
    hooks/                # 5 TanStack Query hooks (drives, file mutations, folder mutations, shared links, merged drive)
    lib/                  # API client, query keys, invalidation helpers
    types/                # TypeScript types
```

### Request flow

```
Browser (:8999)
  → Vite dev proxy → Worker (:8888)
    → requestId middleware (generates UUID, sets x-request-id header)
    → securityHeaders → CORS → CSRF → rateLimiter
    → authGuard (validates session cookie, sets userId + services on context)
    → route handler (thin: parse → validate → call service → return JSON)
    → service (RBAC + business logic)
    → repository (SQL)
    → D1 (local SQLite in dev, Cloudflare D1 in prod)
```

### Repository pattern

All SQL lives in `repositories/`. The pattern is:

- **Routes** (`routes/*.ts`): HTTP parsing + Zod validation + call service. **No SQL.**
- **Services** (`services/*.ts`): Business logic + RBAC + Google API calls. **No SQL strings.**
- **Repositories** (`repositories/*.ts`): All SQL. Named by intent (`findById`, `findAllByUser`, `insertWithUniqueSlug`).

6 of 10 routes have zero inline SQL. The remaining 4 (`s3.ts` with 37, `auth.ts` with 9, `drives.ts` with 3, `files.ts` with 1) are deferred with `ponytail:` comments — grep for `ponytail:` to find intentional deferrals.

### Error handling

Use typed domain errors — not raw `throw new Error()`:

```typescript
throw new NotFoundError('File not found');     // 404
throw new ForbiddenError('Forbidden');          // 403
throw new AppError(400, 'Invalid input');       // 400
throw new UpstreamError('Google API failed');   // 502
```

All errors flow through `onError` in `index.ts` which logs them as structured JSON with `requestId`, `path`, `errorClass`, and `stack`.

### Structured logging

Use the logger, not `console.error`:

```typescript
import { logError, logErrorNoCtx } from '../lib/logger';

// Inside a route (has request context):
logError(c, 'Failed to trash file', err, { fileId });

// Inside a service (no request context):
logErrorNoCtx('Sync failed for drive', err, { driveId: drive.id, driveEmail: drive.email });
```

Every log line is JSON with `ts`, `level`, `msg`, `requestId` (if available), `path`, `errorClass`, and `stack`.

### Frontend state management

- **Server state** (drives, files, folders, shared links): TanStack Query. Query keys in `lib/queryKeys.ts`. Invalidation in `lib/invalidate.ts`.
- **Client state** (UI, selection, toasts, uploads, auth): Zustand stores in `stores/use*Store.ts`.

### Validation

Use Zod schemas in `lib/schemas.ts` + `zValidator` middleware:

```typescript
import { zValidator } from '@hono/zod-validator';
import { createFileSchema, zodErrorHook } from '../lib/schemas';

filesRouter.post('/', zValidator('json', createFileSchema, zodErrorHook), async (c) => {
  const body = c.req.valid('json');
  // ...
});
```

---

## Conventions

### Commits

Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`

### Code style

- TypeScript strict mode (`strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`)
- Prettier for formatting (`.prettierrc`)
- ESLint for linting (`eslint.config.mjs`)
- No `@ts-ignore` / `@ts-nocheck` in source
- Stores named `use*Store.ts` (Zustand convention)

### Deferred decisions

Use `// ponytail:` comments to mark intentional deferrals. These are grep-able:

```typescript
// ponytail: extract @omnidrive/shared-types workspace when a 3rd type drifts
// ponytail: migrate to S3Repository when extending S3 protocol support
```

---

## Where to look when debugging

| Issue | Where to look |
|-------|---------------|
| **500 errors** | `wrangler tail` → filter by `requestId` from the `x-request-id` response header |
| **Auth issues** | Check `packages/worker/.dev.vars` has `JWT_SECRET` + `TOKEN_ENCRYPTION_KEY` (min 32 chars each) |
| **"no such table"** | Run `cd packages/worker && npm run db:migrate:local` |
| **RBAC denied (403)** | Search for `assertCanMutate` or `assertCanShare` in `services/` — check the role + permission |
| **Rate limited (429)** | `packages/worker/src/middleware/rate-limiter.ts` — in-memory sliding window |
| **Quota/cost concerns** | `docs/AGENTS.md` → "Cost Principle" section |
| **S3 API errors** | `packages/worker/src/routes/s3.ts` — 853 lines, uses `ponytail:` deferral |
| **Session expired** | `packages/worker/src/middleware/auth-guard.ts` — 7-day sliding TTL, refreshed if untouched >1hr |
| **Google Drive sync** | `packages/worker/src/services/sync.ts` — cron every 30 min, resume via `next_page_token` |

## Common pitfalls

- **D1 doesn't support `RETURNING` in all contexts** — test with integration tests
- **Workers have a 50-subrequest limit** on the free plan (external `fetch()` calls)
- **KV is eventually consistent** — don't use it for reads that must be fresh
- **PBKDF2 iterations: 10k (not 100k)** — Workers CPU limit is ~10ms/request
- **`.env` vs `.dev.vars`**: `.env` is for the web (Vite), `.dev.vars` is for the worker (Wrangler). Both are needed for local dev.

---

## PR Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] No `console.log` in production code (use `logError` / `logErrorNoCtx` from `lib/logger.ts`)
- [ ] No inline SQL in routes/services (put it in a repository)
- [ ] No `@ts-ignore` / `@ts-nocheck`
- [ ] If adding a new env var, add it to `.env.example` and `lib/env.ts` Zod schema
