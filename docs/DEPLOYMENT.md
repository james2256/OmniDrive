# OmniDrive Deployment Guide

OmniDrive can be deployed three ways:

1. **Local development** — Vite dev server + Wrangler dev (hot reload, recommended for contributing).
2. **Docker self-hosted** — single unified container (`Dockerfile.unified` + `docker-compose.yml`), runs the Node.js server build with a local SQLite + KV shim.
3. **Cloudflare production** — Worker on the edge + Pages for the SPA + D1 (SQLite) + KV.

All three targets share the same source tree (`packages/worker` + `packages/web`) and the same Zod-validated environment (`packages/worker/src/lib/env.ts`).

---

## 1. Prerequisites

| Requirement                | Local dev | Docker | Cloudflare |
|----------------------------|:---------:|:------:|:----------:|
| **Node.js 24+** & npm      | ✅         | ✅¹     | ✅²         |
| **Docker** + Docker Compose| —         | ✅      | —          |
| **Cloudflare account** + Wrangler | —   | —      | ✅          |
| **Google OAuth 2.0 credentials** | Optional³ | Optional³ | Optional³ |

¹ Used by the build stage of `Dockerfile.unified` only; the runtime image is `node:24-slim`.
² Needed only to run `wrangler` for deploys and `npm` for the monorepo scripts.
³ OmniDrive can run without OAuth if you connect Drives via Service Account JSON instead. OAuth credentials are required only for the per-user "Connect Drive" button.

### 1.1 Install Node.js 24

```bash
# NodeSource (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS (Homebrew)
brew install node@24

# nvm
nvm install 24 && nvm use 24
```

Verify: `node --version` → `v24.x.x`.

### 1.2 Get Google OAuth credentials

1. Open the [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**.
2. Create or select a project. Enable the **Google Drive API** and **Google+ API** (or just Drive API for newer projects).
3. **Create Credentials → OAuth client ID → Web application**.
4. Under **Authorized redirect URIs**, add:
   - Local dev: `http://localhost:8888/api/auth/callback`
   - Docker: `http://localhost:8080/api/auth/callback` (or your exposed port)
   - Production: `https://<worker-host>/api/auth/callback`
5. Copy the **Client ID** and **Client Secret** — you'll paste them into the deploy wizard or `wrangler secret put`.

You can skip this step entirely if you'll only connect Drives via Service Account JSON (Settings → Drives → Add via Service Account).

---

## 2. Local Development Setup

The dev environment runs two processes concurrently via `concurrently`:

- **Worker** (`packages/worker`): `wrangler dev --port 8888` — emulates Cloudflare Workers locally with local D1 and KV state stored under `packages/worker/.wrangler/`.
- **Web** (`packages/web`): `vite` on port `5173` (or `WEB_PORT` from `.env`) — proxies `/api/*` to the Worker.

### 2.1 Clone & install

```bash
git clone https://github.com/abilfida/omnidrive.git
cd omnidrive
npm install
```

The root `package.json` declares the workspace; `npm install` from the root installs both `packages/worker` and `packages/web`. Native modules (`better-sqlite3`, `workerd`, `esbuild`, `sharp`) are gated by the `allowScripts` map (`package.json:47-52`).

### 2.2 Configure `.env`

Copy `.env.example` to `.env` at the repo root:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
# Ports
WEB_PORT=8999
WORKER_PORT=8888

# URLs (must match the ports above)
FRONTEND_URL=http://localhost:8999
WORKER_URL=http://localhost:8888

# Frontend API base URL — leave EMPTY to use same-origin /api
# (Vite proxy in dev, Pages rewrite in production).
VITE_API_URL=

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Secrets — generate each with:
# node -e "console.log(crypto.randomUUID().replace(/-/g,''))"
JWT_SECRET=<32+ chars random hex>
TOKEN_ENCRYPTION_KEY=<exactly 32 chars>
```

> ⚠️ `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` are validated at boot by
> `packages/worker/src/lib/env.ts` — `JWT_SECRET` must be ≥32 chars,
> `TOKEN_ENCRYPTION_KEY` must be ≥32 chars. If either fails validation,
> the Worker throws on the first request and you'll see
> `❌ Environment validation failed:` in the logs.

### 2.3 Apply local D1 migrations

The Worker uses Cloudflare D1 in production; locally, Wrangler emulates D1 in
SQLite under `packages/worker/.wrangler/state/v3/d1/`. The Makefile wires this
up:

```bash
# Symlink .env to packages/worker/.dev.vars so Wrangler picks it up
make check-env

# Apply all migrations to the local D1
make db-migrate-local
# equivalent to:
#   cd packages/worker && wrangler d1 migrations apply omnidrive --local
```

If `packages/worker/wrangler.toml` doesn't exist yet, copy it from the example:

```bash
cp packages/worker/wrangler.example.toml packages/worker/wrangler.toml
```

(The local `database_id` doesn't need to be real — `--local` uses the file in `.wrangler/`.)

### 2.4 Start dev servers

Two options:

```bash
# Option A — interactive wizard (recommended first time)
curl -fsSL https://raw.githubusercontent.com/abilfida/omnidrive/main/deploy.sh | bash
# then choose "💻 Local Development"

# Option B — manual
npm run dev           # runs worker + web concurrently
```

Or in the background via `make`:

```bash
make dev        # starts in background, logs to dev.log
make logs       # tail dev.log
make stop       # kill processes on WEB_PORT and WORKER_PORT
```

Visit `http://localhost:8999`. The first user you register becomes the super admin (no invitation code required for the very first registration).

### 2.5 Type-check, lint, test

```bash
npm run typecheck    # tsc --noEmit for both packages
npm run lint         # eslint . (flat config + eslint-plugin-security)
npm test             # vitest run for worker + web
npm run test:worker  # vitest run for worker only (233 tests)
npm run test:web     # vitest run for web only
```

---

## 3. Docker Self-Hosted Setup

The unified Docker image (`Dockerfile.unified`) bundles the Node.js server
build of the Worker plus the built static SPA into a single container. It
emulates Cloudflare D1 + KV locally with `better-sqlite3` and a custom KV
shim (`packages/worker/src/polyfills/{d1,kv}.ts`), so no Cloudflare account is
required.

### 3.1 Files involved

| File                  | Purpose                                                |
|-----------------------|--------------------------------------------------------|
| `Dockerfile.unified`  | Multi-stage build: builds web + worker, runs `node-server.cjs` |
| `docker-compose.yml`  | Single `omnidrive` service; maps port 8080, mounts `omnidrive-data` volume |
| `packages/worker/src/node-server.ts` | Node entrypoint: dotenv, `serve()` from `@hono/node-server`, `node-cron`, graceful SIGTERM/SIGINT shutdown |
| `packages/worker/src/polyfills/d1.ts` | `D1DatabaseWrapper` backed by `better-sqlite3` |
| `packages/worker/src/polyfills/kv.ts` | `KVNamespaceWrapper` backed by a SQLite file |

### 3.2 Quick start via the deploy wizard

```bash
curl -fsSL https://raw.githubusercontent.com/abilfida/omnidrive/main/deploy.sh | bash
# Choose "🐳 Docker Compose (Self-hosted)"
```

The wizard (in `scripts/onboard-deploy.mjs:105-168`):

1. Verifies Docker is installed and running.
2. Asks whether to use the prebuilt image (`ghcr.io/abilfida/omnidrive-unified:latest`) or build from source.
3. Prompts for port, `FRONTEND_URL`, `WORKER_URL`, and (optional) Google OAuth credentials.
4. Generates `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` (32-char hex).
5. Writes `.env`, then runs `docker compose up -d` (or `--build` for source).

### 3.3 Manual Docker setup

```bash
# 1. Create .env (see §2.2) — omit WEB_PORT/WORKER_PORT; add PORT instead:
cat > .env <<'EOF'
PORT=8080
FRONTEND_URL=http://localhost:8080
WORKER_URL=http://localhost:8080
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=$(node -e "console.log(crypto.randomUUID().replace(/-/g,''))")
TOKEN_ENCRYPTION_KEY=$(node -e "console.log(crypto.randomUUID().replace(/-/g,''))")
EOF

# 2. Pull the prebuilt image and start
docker compose up -d

# OR build from source
docker compose up -d --build
```

### 3.4 What the unified image does at runtime

`Dockerfile.unified`:

1. **Builder stage** (`node:24-slim`): `npm ci`, then `npm run build:web` (Vite) and `npm --workspace=@omnidrive/worker run build:node` (esbuild bundles `src/node-server.ts` → `dist/node-server.cjs`, externalizing `better-sqlite3`).
2. **Runtime stage** (`node:24-slim`): copies `node-server.cjs`, `src/db/schema.sql`, and `packages/web/dist`. Installs only `better-sqlite3`. Sets `NODE_ENV=production`, `STATIC_DIR=./web/dist`, `DATA_DIR=/app/data`, exposes 8080, and runs `node node-server.cjs`.

`node-server.ts` at boot (`packages/worker/src/node-server.ts`):

1. `dotenv.config()` — reads `.env` (or env vars from `docker-compose.yml`).
2. Creates `DATA_DIR` (default `/app/data`).
3. Opens `better-sqlite3` at `$DATA_DIR/omnidrive.sqlite`. **If new**, executes `src/db/schema.sql`. **If existing**, runs `ALTER TABLE sync_state ADD COLUMN next_page_token TEXT` (best-effort, ignored if column exists).
4. Resets any `sync_state` rows stuck in `syncing` (interrupted by a previous crash/restart).
5. Opens the KV shim SQLite at `$DATA_DIR/kv.sqlite`.
6. Validates env via `validateEnv()` (throws on missing/malformed).
7. Mounts static SPA + SPA fallback for non-`/api` paths.
8. Schedules the `*/30 * * * *` cron job (mirror of the Worker's `scheduled` handler) — runs Drive sync, S3 lifecycle, automations, audit cleanup, retention policies, and D1 cleanup.
9. Listens on `PORT` (default 8080).
10. Graceful shutdown on `SIGTERM`/`SIGINT` — calls `setShuttingDown()` (interrupts in-flight syncs) then closes the HTTP server.

### 3.5 Data persistence

The compose file mounts a named volume `omnidrive-data` at `/app/data`. This holds both `omnidrive.sqlite` (your DB) and `kv.sqlite` (KV state). **Do not delete this volume** — that's a factory reset.

```bash
# Inspect
docker compose exec omnidrive ls -la /app/data

# Backup
docker compose exec omnidrive cp /app/data/omnidrive.sqlite /tmp/backup.sqlite
docker cp omnidrive-omnidrive-1:/tmp/backup.sqlite ./backup-$(date +%F).sqlite

# Restore (stop first, replace file, restart)
docker compose down
docker cp ./backup-2026-06-25.sqlite omnidrive-omnidrive-1:/app/data/omnidrive.sqlite
docker compose up -d
```

### 3.6 Updating

```bash
git pull
docker compose pull          # refresh base image
docker compose up -d         # recreate container with new image
```

The `node-server.ts:33-39` migration block runs on every boot, so the
`next_page_token` column is added idempotently. **For schema changes beyond
that, apply wrangler migrations against the local SQLite** (see §5).

---

## 4. Cloudflare Production Deployment

Production runs OmniDrive across four Cloudflare primitives:

| Primitive | Holds                                              |
|-----------|----------------------------------------------------|
| **Workers** | The Hono API (`packages/worker/src/index.ts`) + scheduled cron |
| **Pages**  | The built React SPA (`packages/web/dist`)          |
| **D1**     | The OmniDrive database (`schema.sql` + 4 migrations) |
| **KV**     | OAuth state, shared-link lockouts, quota cache     |

### 4.1 One-shot deploy via the wizard

```bash
curl -fsSL https://raw.githubusercontent.com/abilfida/omnidrive/main/deploy.sh | bash
# Choose "☁️ Cloudflare (Production)"
```

The wizard (`scripts/onboard-deploy.mjs:169-312`):

1. Verifies `wrangler whoami` (or prompts `wrangler login`).
2. Detects existing Pages project (`omnidrive`) and Worker (`omnidrive-api`).
3. Copies `wrangler.example.toml` → `wrangler.toml` if missing.
4. Lists existing D1 databases and KV namespaces; lets you pick one or create new (`omnidrive-prod` D1, `KV_PROD` KV).
5. Rewrites `database_id` and KV `id` in `wrangler.toml`.
6. Optionally pushes secrets via `wrangler secret put` (generates JWT + encryption keys for you).
7. Runs `npm run deploy:full` — applies remote migrations, deploys Worker, builds and deploys Pages.

### 4.2 Manual Cloudflare deployment

#### Step 1 — Log in to Cloudflare

```bash
npx wrangler login
```

#### Step 2 — Create D1 database and KV namespace

```bash
# D1
npx wrangler d1 create omnidrive
# Output: database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# KV
npx wrangler kv namespace create KV
# Output: id = "yyyyyyyy..."
```

#### Step 3 — Wire IDs into `wrangler.toml`

```bash
cp packages/worker/wrangler.example.toml packages/worker/wrangler.toml
```

Edit `packages/worker/wrangler.toml`:

```toml
name = "omnidrive-api"
main = "src/index.ts"
compatibility_date = "2025-06-01"

[triggers]
crons = ["*/30 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "omnidrive"
database_id = "<your-d1-database-id>"

[[kv_namespaces]]
binding = "KV"
id = "<your-kv-namespace-id>"

[vars]
# Non-secret config goes here. Secrets go via `wrangler secret put`.

[observability.logs]
enabled = true
head_sampling_rate = 1
persist = true
invocation_logs = true
```

#### Step 4 — Apply remote DB migrations

```bash
cd packages/worker
npm run db:migrate:remote
# equivalent to: wrangler d1 migrations apply omnidrive --remote
```

The migrations live in `packages/worker/migrations/`:

| File                                          | Adds                                                |
|-----------------------------------------------|-----------------------------------------------------|
| `0001_initial_schema.sql`                     | All core tables (users, sessions, drive_accounts, files, workspaces, shared_links, automations, s3_credentials, audit_logs, …) |
| `0002_add_owned_by_me.sql`                    | `files.owned_by_me` / `drive_folders.owned_by_me`   |
| `0003_add_drive_folders_is_trashed.sql`       | `drive_folders.is_trashed`                          |
| `0004_add_drive_folders_is_starred.sql`       | `drive_folders.is_starred`                          |

#### Step 5 — Set secrets

```bash
# Generate strong random secrets first
node -e "console.log(crypto.randomUUID().replace(/-/g,''))"   # → use as JWT_SECRET
node -e "console.log(crypto.randomUUID().replace(/-/g,''))"   # → use as TOKEN_ENCRYPTION_KEY

# Push each secret (prompts for value)
npx wrangler secret put GOOGLE_CLIENT_ID     -c packages/worker/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET -c packages/worker/wrangler.toml
npx wrangler secret put JWT_SECRET           -c packages/worker/wrangler.toml
npx wrangler secret put TOKEN_ENCRYPTION_KEY -c packages/worker/wrangler.toml

# Non-secret config (URLs) — these can be vars or secrets
npx wrangler secret put FRONTEND_URL         -c packages/worker/wrangler.toml
npx wrangler secret put WORKER_URL           -c packages/worker/wrangler.toml
```

#### Step 6 — Deploy the Worker

```bash
npm run deploy -w packages/worker
# or: cd packages/worker && npx wrangler deploy
```

Note the Worker URL (e.g. `https://omnidrive-api.<your-subdomain>.workers.dev`).

#### Step 7 — Configure the frontend and deploy Pages

Edit `packages/web/.env.production`:

```dotenv
# Leave EMPTY to use same-origin /api (recommended — requires a Pages rewrite).
# Set to your Worker URL only if you want cross-site API calls.
VITE_API_URL=
```

Build and deploy:

```bash
npm run build -w packages/web
npx wrangler pages deploy packages/web/dist --project-name=omnidrive-web
```

> **Same-origin recommendation**: For cookies to survive tab close on modern
> browsers, keep `VITE_API_URL=` and route `/api/*` through the Pages host.
> The repo includes `packages/web/functions/api/[[path]].ts` and
> `packages/web/functions/s3/[[path]].ts` Pages Functions that proxy to the
> Worker — see `docs/adr/0006-pages-functions-proxy.md`. If your Worker and
> Pages share a registrable domain (or you use a custom domain), the
> `omnidrive_sid` cookie is first-party and `SameSite=Lax` is enough.

### 4.3 Custom domain

To run both Pages and Worker under one host (e.g. `omnidrive.example.com`):

1. In the Cloudflare dashboard → **Workers & Pages → omnidrive-api → Custom Domains** → add `api.omnidrive.example.com`.
2. In **Workers & Pages → omnidrive-web → Custom domains** → add `omnidrive.example.com`.
3. Update `wrangler.toml` and Pages env: `FRONTEND_URL=https://omnidrive.example.com`, `WORKER_URL=https://api.omnidrive.example.com`.
4. Re-push the two secrets that changed (`FRONTEND_URL`, `WORKER_URL`).
5. Update Google OAuth redirect URI to `https://api.omnidrive.example.com/api/auth/callback`.

### 4.4 Cron triggers

The Worker's `scheduled` handler is wired to fire every 30 minutes via
`[triggers] crons = ["*/30 * * * *"]` in `wrangler.toml`. Each invocation runs:

- `runScheduledSync(env)` — incremental Drive sync via Google Changes API
- `runLifecycleExpiration(env)` — S3 lifecycle expiration
- `cleanupOrphanMultipartUploads(env)` — multipart cleanup
- `AutomationEngine.processCronTrigger(ctx)` — cron-triggered automation rules
- `AuditService.cleanupOldLogs(30)` — 30-day audit retention
- `PolicyService.processAutoDeleteRetentionPolicies(...)` — data-retention policies
- D1 cleanup: `sessions` (expired), `oauth_states` (>10 min), `quota_cache` (>1 h)

You can also invoke it manually for debugging:

```bash
npx wrangler trigger cron '*/30 * * * *' --name omnidrive-api
```

### 4.5 One-shot deploy script

The root `package.json` exposes:

```bash
npm run deploy:full
# = npm run db:migrate:remote (worker)
#   + npm run build (worker)
#   + npm run deploy (worker)
#   + npm run build (web)
#   + npm run deploy (web)
```

Use this after every code change once `wrangler.toml` and secrets are in place.

---

## 5. Environment Variables Reference

The canonical validator is `packages/worker/src/lib/env.ts`. The full set, with
where each var is consumed:

| Variable                | Required | Validation                          | Used by                                          |
|-------------------------|:--------:|-------------------------------------|--------------------------------------------------|
| `DB`                    | ✅        | Binding present                     | D1 binding (`wrangler.toml`) / `better-sqlite3` (`node-server.ts`) |
| `KV`                    | ✅        | Binding present                     | KV binding / KV shim                              |
| `FRONTEND_URL`          | ✅        | Valid URL                           | CORS, CSRF allow-list, shared-link base URL (`shared.ts:90`), session cookie `Secure` flag (`session-cookie.ts:31`) |
| `WORKER_URL`            | ✅        | Valid URL                           | Google OAuth redirect URI (`auth.ts:115`, `drives.ts:62`), CSRF allow-list |
| `JWT_SECRET`            | ✅        | ≥32 chars                           | Signing shared-link session/email JWTs (`shared.ts:37,54,170,189`) |
| `TOKEN_ENCRYPTION_KEY`  | ✅        | ≥32 chars                           | AES-256-GCM encryption of Google OAuth tokens (`auth.ts:194`), S3 secret keys (`s3-credentials.ts:30`) |
| `GOOGLE_CLIENT_ID`      | ⚪        | Optional string                     | Google OAuth + Drive API (`auth.ts`, `drives.ts`, `files.ts`, `s3.ts`) |
| `GOOGLE_CLIENT_SECRET`  | ⚪        | Optional string                     | Same as above                                     |
| `BOOTSTRAP_TOKEN`       | ⚪        | Optional string                     | If set, first user registration requires this token instead of being open (`auth.ts:55-60`) |

### 5.1 Where each var is set in each target

| Variable                | Local dev                | Docker                  | Cloudflare             |
|-------------------------|--------------------------|-------------------------|------------------------|
| `DB`                    | Wrangler local D1        | `better-sqlite3` shim   | D1 binding             |
| `KV`                    | Wrangler local KV        | `KVNamespaceWrapper`    | KV binding             |
| `FRONTEND_URL`          | `.env`                   | `.env` (read by compose) | `wrangler secret put` |
| `WORKER_URL`            | `.env`                   | `.env`                  | `wrangler secret put` |
| `JWT_SECRET`            | `.env` → `.dev.vars`     | `.env`                  | `wrangler secret put` |
| `TOKEN_ENCRYPTION_KEY`  | `.env` → `.dev.vars`     | `.env`                  | `wrangler secret put` |
| `GOOGLE_CLIENT_ID`      | `.env` → `.dev.vars`     | `.env`                  | `wrangler secret put` |
| `GOOGLE_CLIENT_SECRET`  | `.env` → `.dev.vars`     | `.env`                  | `wrangler secret put` |
| `BOOTSTRAP_TOKEN`       | `.env` → `.dev.vars`     | `.env`                  | `wrangler secret put` |
| `WEB_PORT`              | `.env` (default 8999)    | — (uses `PORT`)         | —                      |
| `WORKER_PORT`           | `.env` (default 8888)    | —                       | —                      |
| `PORT`                  | —                        | `.env` (default 8080)   | —                      |
| `DATA_DIR`              | —                        | `/app/data` (compose)   | —                      |
| `STATIC_DIR`            | —                        | `./web/dist` (image)    | —                      |
| `VITE_API_URL`          | `packages/web/.env`      | baked into web build    | `packages/web/.env.production` |

### 5.2 Generating secrets

```bash
# 32-char hex (64 hex chars actually = 32 bytes of entropy)
node -e "console.log(crypto.randomUUID().replace(/-/g,''))"

# Or with openssl
openssl rand -hex 32
```

### 5.3 Boot-time validation

`packages/worker/src/lib/env.ts:7-17` defines a Zod schema. On the Worker,
`index.ts:112-115` calls `validateEnv(env)` on every `fetch` (Workers has no
boot hook). On the Node.js server, `node-server.ts:48-57` validates once at
startup. Failures print:

```
❌ Environment validation failed:
  JWT_SECRET: JWT_SECRET must be ≥32 characters
  TOKEN_ENCRYPTION_KEY: TOKEN_ENCRYPTION_KEY must be ≥32 characters
```

and the Worker throws on the next request.

---

## 6. Database Migrations

All migrations live in `packages/worker/migrations/` and are applied with
Wrangler. The migration filenames are zero-padded and applied in order.

### 6.1 Commands

```bash
# Local (writes to packages/worker/.wrangler/state/v3/d1/...)
npm run db:migrate:local -w packages/worker
# = wrangler d1 migrations apply omnidrive --local

# Remote (against Cloudflare D1)
npm run db:migrate:remote -w packages/worker
# = wrangler d1 migrations apply omnidrive --remote

# Or via the root Makefile
make db-migrate-local
make db-migrate-remote
```

### 6.2 Listing / inspecting the DB

```bash
# Local
npx wrangler d1 execute omnidrive --local --command "SELECT name FROM sqlite_master WHERE type='table';"

# Remote
npx wrangler d1 execute omnidrive --remote --command "SELECT COUNT(*) FROM users;"

# Dump full schema
npx wrangler d1 execute omnidrive --remote --command ".schema"
```

### 6.3 Factory reset

⚠️ **Destructive.** The reset script (`packages/worker/scripts/reset.mjs`) drops
all tables and re-applies `src/db/schema.sql`, then deletes every KV key. Remote
reset prompts `"YES"` on stdin.

```bash
# Local
npm run db:reset:local -w packages/worker
# = node scripts/reset.mjs --local

# Remote (prompts for confirmation)
npm run db:reset:remote -w packages/worker
# = node scripts/reset.mjs --remote
```

The Docker equivalent: stop the container, delete the `omnidrive-data` volume,
restart.

```bash
docker compose down -v   # -v deletes the named volume
```

### 6.4 Adding a new migration

```bash
# 1. Create the file with the next number
echo "-- description" > packages/worker/migrations/0005_your_change.sql

# 2. Apply locally to test
npm run db:migrate:local -w packages/worker

# 3. Apply remotely on next deploy
npm run db:migrate:remote -w packages/worker
```

The Docker build does **not** automatically run wrangler migrations on the
local SQLite (only the idempotent `next_page_token` ALTER in
`node-server.ts:33-39`). To apply new migrations to a Docker deployment, exec
into the container:

```bash
docker compose exec omnidrive node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('/app/data/omnidrive.sqlite');
db.exec(fs.readFileSync('/app/src/db/schema.sql', 'utf-8'));
console.log('OK');
"
```

…or apply the new SQL file directly via `better-sqlite3`. The unified image
ships `src/db/schema.sql` for this purpose.

---

## 7. S3 API Client Setup

OmniDrive exposes an S3-compatible endpoint at `https://<your-worker-url>/s3`
(path-style). Each **workspace** is a **bucket**. Generate per-user or
per-workspace credentials at **Settings → S3 Credentials** (or via
`POST /api/s3-credentials`). The secret key is shown **only once**.

### 7.1 rclone

Create `~/.config/rclone/rclone.conf`:

```ini
[omnidrive]
type = s3
provider = Other
access_key_id = OMNI<16-hex-upper>
secret_access_key = <64-char-hex>
endpoint = https://omnidrive-api.your-subdomain.workers.dev/s3
force_path_style = true
# Optional: tune for large uploads
chunk_size = 64M
upload_concurrency = 4
```

Then:

```bash
rclone lsd omnidrive:                       # list buckets (= workspaces)
rclone ls omnidrive:Marketing               # list objects in Marketing workspace
rclone copy ./report.pdf omnidrive:Marketing/reports/
rclone sync ./local-dir omnidrive:Marketing/folder/ --progress
```

### 7.2 AWS CLI

Configure a profile (`~/.aws/credentials`):

```ini
[omnidrive]
aws_access_key_id = OMNI<16-hex-upper>
aws_secret_access_key = <64-char-hex>
```

And `~/.aws/config`:

```ini
[profile omnidrive]
region = us-east-1
s3 =
    addressing_style = path
    max_concurrent_requests = 4
```

Use `--endpoint-url`:

```bash
aws --profile omnidrive \
    --endpoint-url https://omnidrive-api.your-subdomain.workers.dev/s3 \
    s3 ls

aws --profile omnidrive \
    --endpoint-url https://omnidrive-api.your-subdomain.workers.dev/s3 \
    s3 cp ./report.pdf s3://Marketing/reports/

# Multipart upload is supported (≥5 MB parts)
aws --profile omnidrive \
    --endpoint-url https://omnidrive-api.your-subdomain.workers.dev/s3 \
    s3 cp ./big.tar.gz s3://Marketing/archives/ --expected-size 1073741824
```

### 7.3 boto3 (Python)

```python
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="https://omnidrive-api.your-subdomain.workers.dev/s3",
    aws_access_key_id="OMNI...",
    aws_secret_access_key="...",
    region_name="us-east-1",
    config=boto3.session.Config(s3={"addressing_style": "path"}),
)

# List buckets
print([b["Name"] for b in s3.list_buckets()["Buckets"]])

# Upload (multipart auto for >8 MB)
s3.upload_file("report.pdf", "Marketing", "reports/report.pdf")

# Download
s3.download_file("Marketing", "reports/report.pdf", "./downloaded.pdf")
```

### 7.4 Supported operations

| Operation                                | Status |
|------------------------------------------|:------:|
| `ListBuckets`                            | ✅      |
| `ListObjectsV2` (with prefix/delimiter)  | ✅      |
| `HeadBucket` / `HeadObject`              | ✅      |
| `GetObject`                              | ✅      |
| `PutObject` (single-part)                | ✅      |
| `DeleteObject`                           | ✅      |
| `InitiateMultipartUpload`                | ✅      |
| `UploadPart`                             | ✅      |
| `CompleteMultipartUpload`                | ✅      |
| `AbortMultipartUpload`                   | ✅      |
| `GetBucketLifecycleConfiguration`        | ✅      |
| `PutBucketLifecycleConfiguration`        | ✅      |
| `DeleteBucketLifecycleConfiguration`     | ✅      |
| `CreateBucket` / `DeleteBucket`          | ❌      |
| `ListMultipartUploads` / `ListParts`     | ❌      |
| Object ACLs / tagging                    | ❌      |

See `docs/API.md#10-s3-object-storage-api` for the wire details and
`packages/worker/tests/s3-api.test.ts` (33 tests) for the contract.

### 7.5 Auth & RBAC

- SigV4 (`AWS4-HMAC-SHA256`) is validated by `middleware/s3-auth.ts`. Both
  `Authorization` header and presigned URLs (query-string signing) are supported.
- Request time must be within ±15 minutes of server time, otherwise
  `RequestTimeTooSkewed`.
- For PUT/POST, the `x-amz-content-sha256` header is **required** (prevents
  body substitution attacks).
- Read ops require `viewer` role; write ops require `editor` role
  (`requireS3Role`, `routes/s3.ts:28-34`).
- A credential with `workspaceId` set is scoped to that workspace only
  (S3 calls will see only that bucket).

---

## 8. Troubleshooting

### 8.1 "❌ Environment validation failed" on Worker boot

The Worker throws on the first request. Run `npx wrangler tail omnidrive-api`
to see the printed field errors. Fix `wrangler secret put <VAR>` (or `.env` /
`.dev.vars` for local) and redeploy. The most common causes:

- `JWT_SECRET` or `TOKEN_ENCRYPTION_KEY` shorter than 32 chars.
- `FRONTEND_URL` or `WORKER_URL` not a valid URL (missing `http://` or `https://`).
- Forgetting to push a secret to Cloudflare after rotating locally.

### 8.2 401 "Not authenticated" on every request

Likely causes (in order of frequency):

1. **Cookie not sent** — verify the SPA is loaded from `FRONTEND_URL` (or a same-registrable-domain host) and the API is called same-origin via `/api/*`. Cross-site `fetch()` from a Pages host (`*.pages.dev`) to a Worker (`*.workers.dev`) drops the `omnidrive_sid` cookie after tab close in modern browsers. Fix: use the Pages Functions proxy (`packages/web/functions/api/[[path]].ts`) and keep `VITE_API_URL=` empty.
2. **Session expired** — the cookie has a 7-day sliding TTL. Logging in again fixes it.
3. **Clock skew** — `Date.now()` on D1 vs. client. Sessions use `expires_at` in ms epoch; if your client clock is far off, the guard may think the session is expired.

### 8.3 403 "CSRF validation failed"

Non-safe methods (`POST`/`PUT`/`PATCH`/`DELETE`) must send an `Origin` or
`Referer` header matching `FRONTEND_URL` or `WORKER_URL`. Common causes:

- Calling the API from a different origin (e.g. a script). Either route through the same origin or hit one of the CSRF-exempt paths (`/api/auth/login`, `/api/auth/register`, `/api/auth/google/callback`, public shared-link verify/download).
- Forgetting to set `FRONTEND_URL`/`WORKER_URL` correctly after a domain change.

### 8.4 429 "Too many requests"

You hit a rate-limit bucket (see `docs/API.md#rate-limits`). Wait `Retry-After`
seconds. If you legitimately need more, raise the limit in `index.ts:67-89`
(ponytail: per-isolate limiter; upgrade to a Durable Object or KV-backed limiter
if brute-force becomes a real problem).

### 8.5 "Google Drive session expired. Disconnect and reconnect…"

The OAuth refresh token in `drive_tokens` is no longer valid (revoked by user,
or Google deleted the consent after 6 months of inactivity). Fix:
**Settings → Drives → Disconnect**, then reconnect.

### 8.6 "Failed to start resumable upload" (502) on file upload

The Worker couldn't initiate a Google Drive resumable session. Check the Worker
logs (`npx wrangler tail`) for the underlying message. Common causes:

- All Drive tokens expired → reconnect the Drive.
- Google API quota exceeded (rare on free tier).
- The chosen Drive is out of storage (`UploadRouter.selectDriveForUpload` skips
  full Drives, but if **all** are full it returns the first one and Google
  rejects the upload).

### 8.7 S3 "SignatureDoesNotMatch"

`middleware/s3-auth.ts:297-311` logs the calculated vs. provided signature
(plus the canonical request) to Workers Logs but **does not** echo them to the
client. To debug:

```bash
npx wrangler tail omnidrive-api | grep -A 20 "S3 Signature Mismatch"
```

Common causes:

- Wrong `secret_access_key` (re-issue at **Settings → S3 Credentials**).
- Wrong endpoint URL — must end with `/s3` and use path-style addressing.
- Proxy/CDN rewriting `Accept-Encoding` (the middleware tries several
  permutations, but exotic ones can fail).
- System clock on the client is more than 15 minutes off →
  `RequestTimeTooSkewed`.

### 8.8 Docker container restarts in a loop

Inspect: `docker compose logs omnidrive`. The most common cause is
`Environment validation failed` (§8.1). Also check:

- `JWT_SECRET` / `TOKEN_ENCRYPTION_KEY` are present in `.env` (compose injects them).
- `DATA_DIR=/app/data` is writable by the `node` user in the image.
- The volume `omnidrive-data` isn't corrupt (try mounting a fresh path).

### 8.9 D1 "no such table" after a fresh deploy

You skipped the remote migration step. Run:

```bash
npm run db:migrate:remote -w packages/worker
```

To verify:

```bash
npx wrangler d1 execute omnidrive --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"
```

### 8.10 Cron isn't running

Verify the trigger exists:

```bash
npx wrangler triggers list --name omnidrive-api
```

If missing, ensure `wrangler.toml` has `[triggers] crons = ["*/30 * * * *"]` and redeploy. You can also fire it manually for testing:

```bash
npx wrangler trigger cron '*/30 * * * *' --name omnidrive-api
```

### 8.11 Pages Functions proxy returns 502

The Pages Function at `packages/web/functions/api/[[path]].ts` forwards to the
Worker. If it returns 502:

- Confirm the Worker is deployed and reachable (`curl https://<worker-url>/api/health` → `{"status":"ok"}`).
- Confirm the Pages project's `API_URL` environment variable (set in the
  Cloudflare dashboard → Pages → Settings → Environment variables) points to
  the correct Worker URL.

### 8.12 Shared-link download returns 502

The Worker hit Google Drive and it failed. Check `wrangler tail` for the
underlying error. If the link was created when the Drive had valid tokens and
the tokens have since expired, the file owner needs to reconnect their Drive.

### 8.13 `npm install` fails on `better-sqlite3`

`better-sqlite3` ships prebuilt binaries for most platforms but occasionally
needs to compile from source. On Linux you'll need `build-essential`, `python3`,
and the right `node-gyp` toolchain. The repo's `allowScripts` map
(`package.json:47-52`) permits `better-sqlite3`'s install script. If it still
fails:

```bash
# Rebuild native modules for the installed Node version
npm rebuild better-sqlite3

# Or force a fresh build
rm -rf node_modules packages/*/node_modules
npm install
```

### 8.14 Forgetting `wrangler.toml`

`packages/worker/wrangler.toml` is git-ignored. If `npm run dev` complains
"wrangler.toml not found":

```bash
cp packages/worker/wrangler.example.toml packages/worker/wrangler.toml
```

Then fill in `database_id` and KV `id` (real for production, dummy/blank OK for local with `--local`).

### 8.15 Lost the S3 secret key

Secrets are stored AES-encrypted (`secret_key_enc`); they cannot be recovered.
Delete the key (`DELETE /api/s3-credentials/:id`) and create a new one. Update
your rclone/aws-cli/boto3 config with the new pair.
