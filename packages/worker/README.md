# Name
### @omnidrive/worker

# Synopsis
Hono backend for OmniDrive. Runs as a Cloudflare Worker (production) or via `node-server.ts` (Docker self-host). Exposes the REST API at `/api/*` and the S3-compatible protocol at `/s3`.

# Description
- **Entry**: `src/index.ts` (Hono app + `fetch`/`scheduled` handlers), `src/node-server.ts` (Node runtime for Docker).
- **Routes** (`src/routes/`): auth, drives, folders, files, shared, automations, workspaces, admin, s3-credentials, s3.
- **Services** (`src/services/`): business logic + RBAC (no SQL).
- **Repositories** (`src/repositories/`): all SQL lives here.
- **Middleware** (`src/middleware/`): request-id, security-headers, cors, csrf-guard, rate-limiter, auth-guard, s3-auth, shared-services.
- **Lib** (`src/lib/`): crypto, validation, env, logger, schemas, password, PKCE, RBAC, cursor, backoff, etc.
- **DB** (`src/db/schema.sql`) + `migrations/` (0001–0009).
- **Tests**: `tests/*.test.ts` (46 unit) + `tests/integration/*.test.ts` (9 integration, real D1 via Miniflare).
- **Build**: `wrangler deploy` (Cloudflare) or `esbuild src/node-server.ts` (Docker, see `Dockerfile.unified`).

# Example
```bash
npm run dev           # wrangler dev --port 8888
npm test              # vitest run (unit tests)
npm run test:integration   # vitest run --config vitest.integration.config.mts
npm run db:migrate:local   # wrangler d1 migrations apply omnidrive --local
npm run deploy        # wrangler deploy
```

# Install:
`npm install @omnidrive/worker`

# Test:
`npm test`

# License:
MIT — see [../../LICENSE](../../LICENSE)
