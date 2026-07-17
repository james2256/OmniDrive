# AGENTS.md — AI Agent Guide

This document explains how to work in the **OmniDrive** repo (forked from [`abilfida/OmniDrive`](https://github.com/abilfida/OmniDrive)).

## Safety Rules — MUST FOLLOW

**NEVER read the contents of `.env` (local), `packages/worker/.dev.vars`, or any file containing secrets** (`read`, `cat`, `grep`, `ctx_execute_file`, or any tool that returns file contents to the context). Production secrets are stored in Cloudflare Workers Secrets — verify via `wrangler secret list` or `.env.example`, never by reading the actual values.

**NEVER run deploy or dev servers** — the agent **must not** execute the following commands (including variations via `npm`, `npx wrangler`, `make`, or scripts in `scripts/`):

| Forbidden | Example commands |
|-----------|------------------|
| Dev server | `npm run dev`, `npm run dev:worker`, `npm run dev:web`, `wrangler dev`, `vite`, `vite preview` |
| Deploy | `npm run deploy:code`, `npm run deploy:full`, `npm run deploy --prefix packages/worker`, `npm run deploy --prefix packages/web`, `node scripts/onboard-deploy.mjs`, `wrangler deploy`, `wrangler pages deploy` |

Reason: deploy and dev servers affect the maintainer's production/local environment. The agent should only modify code, run **tests** (`npm test`), and give the user deploy/dev instructions when needed.

## Project Summary

| Item | Value |
|------|-------|
| Name | OmniDrive |
| Version | `0.9.7` (see `package.json`) |
| License | MIT — preserve `abilfida` copyright in `LICENSE` |
| Maintainer | `asmaraputra` |
| Upstream | `abilfida/OmniDrive` (optional, `git fetch upstream`) |
| Stack | Hono + Cloudflare Workers, D1, KV, React 19, Vite, Zustand |

**OmniDrive** is a multi-Google Drive storage gateway with team workspaces, shared links, automations, and an S3-compatible API.

## Cost Principle — $0 Cost, Maximize Free Tier

**Operational target:** keep this project at **$0 cost** for as long as possible. Every architectural decision must prioritize the **Cloudflare free tier** (Workers Free + Pages Free + D1 + KV) and avoid paid features or patterns that easily trigger overage.

Before raising crypto iterations, adding new bindings (DO/R2/Queues), or changing observability, read this section. Do not upgrade to paid services without the maintainer's explicit approval.

### PBKDF2 & password hashing (`packages/worker/src/lib/password.ts`)

| Context | Decision | Reason |
|---------|----------|--------|
| User auth (register/login) | **10,000 iterations** PBKDF2-SHA256 | Workers Free limits CPU to ~10 ms/request; 100k often triggers Error 1102 |
| Shared-link password (new) | **10,000 iterations**, format `shared:10000:salt:hash` via `hashSharedPassword` | Same — CPU-safe; combined with rate limit + per-link KV lockout |
| Shared-link password (legacy) | Still verify old format `salt:hash` (implicit 100k) | Backward compat; do not remove without data migration |

**Do not** raise new shared-link iterations to 100k "for OWASP" — on Workers that is counterproductive (CPU timeout). The primary brute-force defense is the rate limiter (`index.ts`) and KV lockout in `shared.ts` (`shared_verify_fail` / `shared_verify_lock`), not high iterations.

### Rate limiter (`packages/worker/src/middleware/rate-limiter.ts`)

Current implementation: **per-isolate `Map`** (in-memory). Sufficient for casual abuse; weak against distributed brute-force because the effective limit can be ×N isolates.

| Option | Cost | When to consider |
|--------|------|------------------|
| **In-memory (current)** | $0 | Default — keep + `ponytail` comment |
| **KV counter** | Free: 100k read + 1k write/day; overage ~$0.50/million read (Paid) | Only on a real brute-force incident; KV is **already** in the project |
| **Durable Objects** | Free: 100k request/day; Paid can be expensive (duration billing) | **Avoid** — overkill & cost risk for this app |
| **WAF Rate Limiting** (dashboard) | 1 free rule on CF Free plan | Alternative at $0 without code changes; maintainer sets it in the dashboard |

**Do not** refactor the rate limiter to DO/KV just for "best practice" — wait for evidence of a real problem. A KV upgrade is cheaper than DO if genuinely needed.

### Observability (`packages/worker/wrangler.toml`)

Intentional config — **logs on, traces off**:

```toml
[observability]
enabled = false          # master observability switch (non-traces)

[observability.logs]
enabled = true           # Workers Logs — invocation + console.log
persist = true
invocation_logs = true

[observability.traces]
enabled = false          # disable tracing (save noise & cost)
```

| Item | Free tier | Agent note |
|------|-----------|------------|
| Workers Logs | 200,000 events/day | `head_sampling_rate = 1` = 100% of requests logged; high traffic → overage risk on Paid |
| Traces | — | Keep `enabled = false` |

**Do not** change `wrangler.toml` observability without a clear reason. If the maintainer asks to save logs: lower `head_sampling_rate` (e.g. `0.1`), do not enable traces.

### Quick agent summary

1. **Do not** introduce new bindings/services that trigger cost (DO, Queues, R2, Workers Paid-only) without approval.
2. **Prefer** the D1 + KV free tier already in use; OAuth tokens are in D1, KV is only for shared-link rate/lockout.
3. **Avoid** CPU-heavy patterns (bcrypt, PBKDF2 100k for new paths, `arrayBuffer()` on large files).
4. **Document** cost trade-offs in `// ponytail:` comments when intentionally deferring an upgrade.

## Project Documentation — Read Before Developing

The four documents below are the **source of truth** for the project's domain, data, UI, and history. Read the relevant one **before** writing/changing code so you don't struggle to find components and waste tokens. Each document has a list of sections (anchors) — jump directly with `read` + `offset`/`limit` rather than reading the whole file.

### `ARCHITECTURE.md` — System Architecture (301 lines)

**Read when:** touching backend/frontend flow, auth, sync, S3, deploy, or needing the big picture.

| Section (anchor) | Content |
|------------------|---------|
| `#overview` | System overview & data flow diagram |
| `#monorepo-structure` | `packages/worker` vs `packages/web` layout |
| `#backend-architecture` | Route table, service table, middleware |
| `#authentication-flow` | Google OAuth + PKCE + session cookie |
| `#data-sync-architecture` | Initial/incremental sync, **Storage Quota & Capacity** (override + fallback chain) |
| `#s3-compatibility-layer` | SigV4, multipart upload, `/s3` endpoint |
| `#frontend-architecture` | Routing, Zustand stores, API client |
| `#scheduled-jobs-cron` | `*/30` sync cron |
| `#security-model` | CSRF, RBAC, token encryption |
| `#deployment-topology` | Worker + Pages + D1 + KV |
| `#environment-configuration` | Required env vars |
| `#testing-strategy` | Vitest, high-value test areas |

### `SCHEMA.md` — D1 Database Schema (413 lines)

**Read when:** changing tables, adding columns, writing a migration, or querying D1.

| Section (anchor) | Content |
|------------------|---------|
| `#relationship-diagram` | Mermaid ERD of all tables |
| `#tables` | Column + type details per table (drive_accounts, files, workspaces, …) — including `quota_override` |
| `#incremental-migrations` | List of `0001`–`0007` + changes |
| `#database-commands` | `make db-migrate-local/remote`, factory reset |
| `#kv-store-not-d1` | KV keys (`tokens:`, `quota:`, `oauth_state:`) |

### `DESIGN.md` — UI & Design System (229 lines)

**Read when:** creating/changing UI components, pages, styling, or color tokens.

| Section (anchor) | Content |
|------------------|---------|
| `#design-philosophy` | OmniDrive design principles |
| `#ui-tech-stack` | React 19, Vite, Tailwind, Radix, Zustand |
| `#design-tokens` | `--drive-*` color tokens, spacing, radius |
| `#layout` | `AppLayout` → Sidebar + Header + MainContent |
| `#pages` | Route → page table (incl. bento Dashboard, capacity editor in Settings) |
| `#reusable-ui-components` | Primitives & business components |
| `#interaction-patterns` | Modal, toast, dropdown patterns |
| `#responsive-accessibility` | Breakpoints + a11y |
| `#guide-to-adding-new-ui` | New UI checklist |
| `#anti-patterns-do-not` | What to avoid |

### `CHANGELOG.md` — Change History (366 lines)

**Read when:** starting a session (check `[Unreleased]`), finishing a task (record under `[Unreleased]`), or finding when a feature/bug was introduced. Uses Keep a Changelog format. Latest entries this session: Home redesign to bento grid (Concept 3) + brand palette recalibration (Option B — cobalt accent `#2563EB`) + drive identity color tokens (`--drive-1`..`--drive-5`).

> **Rule:** every task that changes behavior/UI library must add an entry under `[Unreleased]` in `CHANGELOG.md`. See "Adding a New Feature" step 5.

## Monorepo Structure

```
omnidrive/
├── packages/worker/     # Backend API (Cloudflare Worker)
├── packages/web/        # Frontend SPA (React + Vite)
├── docs/                # All project documentation
│   ├── AGENTS.md        # This guide
│   ├── ARCHITECTURE.md  # System architecture
│   ├── SCHEMA.md        # D1 database schema
│   ├── DESIGN.md        # UI/UX guide
│   └── CHANGELOG.md     # Change history
├── README.md            # User-facing readme
├── Makefile             # Dev & deploy shortcuts
└── .env.example         # Environment variables template
```

## Important Commands

> **Agent note:** The dev and deploy commands below are for the **maintainer (human)** only. The agent is forbidden from running them — see "Safety Rules".

```bash
# Install dependencies (from root) — agent MAY run
npm install

# Development (web + worker simultaneously) — agent FORBIDDEN
npm run dev
npm run dev:worker    # worker only
npm run dev:web       # web only

# Test backend — agent MAY run
npm test

# Migrate database — agent FORBIDDEN unless user explicitly asks
npm run migrate:remote                              # production D1 migration (from root)
npm run db:migrate:local --prefix packages/worker   # local D1 migration

# Deploy — agent FORBIDDEN (run yourself as maintainer)
npm run deploy --prefix packages/worker   # Worker only
npm run deploy --prefix packages/web      # build + Pages (frontend) only
npm run deploy:code     # worker + web (without migration)
npm run deploy:full     # remote migration + worker + web
node scripts/onboard-deploy.mjs   # initial setup/deploy wizard
```

**Default ports** (from `.env.example`): Web `8999`, Worker `8888`.

## Code Rules

### Backend (`packages/worker`)

- Framework: **Hono** — per-domain routers in `src/routes/`
- Business logic: `src/services/` — don't put heavy logic in route handlers
- Global middleware in `src/index.ts` (order matters): security headers → CORS → CSRF → rate limiter
- Auth: `omnidrive_sid` cookie + D1 session (`sessions` table, `middleware/auth-guard.ts`)
- S3: separate route at `/s3/*` with SigV4 (`middleware/s3-auth.ts`)
- Errors: use `AppError` from `middleware/error-handler.ts`
- Database: D1 (SQLite) — schema in `src/db/schema.sql`, incremental migrations `0001`–`0007`
- Types: `src/types/env.ts` for `Env`, `SessionData`, `AppContext`

### Frontend (`packages/web`)

- Routing: `App.tsx` (React Router v7)
- State: **Zustand** in `src/stores/` — avoid prop drilling for global state
- API client: `src/lib/api.ts` — all fetches to backend go through here
- UI components: Radix primitives in `src/components/ui/`
- Layout: `AppLayout` → `Sidebar` + `Header` + `MainContent`
- Styling: Tailwind CSS — follow tokens in `tailwind.config.js` (see `DESIGN.md`)

### General Conventions

- Code & comment language: **English**
- TypeScript strict — avoid `any` unless there's an existing legacy pattern
- IDs: `generateId()` from `packages/worker/src/lib/id.ts`
- Input validation: `packages/worker/src/lib/validation.ts`
- Do not commit: `wrangler.toml` secrets, `.env`, local database files (`*.sqlite`)

## Git Workflow (Path A — Fork)

```bash
# Push to your own fork
git push origin main

# Pull upstream updates (optional)
git fetch upstream
git merge upstream/main
```

- **origin** → `asmaraputra/OmniDrive` (push here)
- **upstream** → `abilfida/OmniDrive` (fetch only)

## Sensitive Areas — Be Careful When Changing

| Area | Key files | Note |
|------|-----------|------|
| Auth & session | `routes/auth.ts`, `services/auth.service.ts` | PKCE, JWT, AES-256-GCM token encryption |
| RBAC | `middleware/rbac.ts` | Workspace roles: viewer → owner |
| S3 SigV4 | `middleware/s3-auth.ts`, `lib/crypto-s3.ts` | Signature mismatch is very sensitive |
| Sync | `services/sync.ts`, `services/google-drive.ts` | OOM-safe generator, `next_page_token` checkpoint |
| CSRF | `middleware/csrf-guard.ts` | All `/api/*` mutations |
| Shared links | `routes/shared.ts` | IDOR prevention, rate-limited verify |

## Adding a New Feature

1. **Read first** the relevant docs (see "Project Documentation — Read Before Developing" above): `ARCHITECTURE.md` (flow), `SCHEMA.md` (tables), `DESIGN.md` (UI), and `CHANGELOG.md` `[Unreleased]` (current context)
2. **Backend**: route → service → D1 query; add tests in `packages/worker/tests/`
3. **Frontend**: method in `api.ts` → store (if needed) → component/page
4. **Schema change**: update `schema.sql` + create new migration `000N_*.sql` + update table in `SCHEMA.md` `#tables` section + list in `#incremental-migrations`
5. **Documentation**: update `CHANGELOG.md` under `[Unreleased]` (required); update `ARCHITECTURE.md`/`SCHEMA.md`/`DESIGN.md` if flow/table/UI changed
6. **UI**: follow `DESIGN.md` — do not introduce a new design system

## Testing

```bash
# All worker tests
npm test

# Specific test
npm test -- tests/s3-api.test.ts

# Frontend (vitest available in web package)
cd packages/web && npx vitest run
```

Test priority for changes in: auth, S3, sync, RBAC, shared links.

## Environment Variables

Copy `.env.example` → `.env` at the root. Required variables:

| Variable | Package | Purpose |
|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | worker | Google Drive OAuth |
| `GOOGLE_CLIENT_SECRET` | worker | Google Drive OAuth |
| `JWT_SECRET` | worker | Signing session token |
| `TOKEN_ENCRYPTION_KEY` | worker | Encrypt OAuth token in KV |
| `FRONTEND_URL` | worker | CORS origin |
| `WORKER_URL` | worker | OAuth callback redirect |
| `VITE_API_URL` | web | API base URL at build time |

The worker reads secrets via `.dev.vars` (symlinked from `.env` during `make dev`).

## Deploy Checklist

1. `wrangler.toml` configured (D1 `database_id`, KV `id`)
2. Secrets set: `npx wrangler secret put JWT_SECRET` (and others)
3. `npm run migrate:remote` for production schema
4. `packages/web/.env.production` contains production `VITE_API_URL`
5. `npm run deploy:full` (or `npm run deploy:code` if schema is already up-to-date)

## Related Documentation

The full navigation map (when to read + section anchors) is in the **"Project Documentation — Read Before Developing"** section at the top of this document. Summary:

| File | Content | Last updated |
|------|---------|--------------|
| `docs/ARCHITECTURE.md` | Diagrams, data flow, system components, quota/capacity | This session (capacity editor ref moved to Settings) |
| `docs/SCHEMA.md` | D1 tables, relations, indexes, migrations `0001`–`0007` | Previous session (`quota_override` + migration `0007`) |
| `docs/DESIGN.md` | Cobalt color tokens, bento layout, component patterns | This session (bento dashboard + Option B palette) |
| `docs/CHANGELOG.md` | Version history (`[Unreleased]` + `0.9.7` downward) | This session (bento redesign + cobalt palette + drive tokens) |
| `README.md` | User guide & setup | Unchanged (already rebranded to OmniDrive) |

## What Not to Do

- **Do not run dev servers or deploys** — `npm run dev`, `npm run dev:worker`, `npm run dev:web`, `npm run deploy:code`, `npm run deploy:full`, `npm run deploy --prefix packages/worker`, `npm run deploy --prefix packages/web`, `node scripts/onboard-deploy.mjs`, `wrangler dev`, `wrangler deploy`, `wrangler pages deploy` (see "Safety Rules")
- Do not push to `upstream` — no write access
- Do not remove the original MIT copyright
- Do not bypass `authGuard` / `csrfGuard` on mutation endpoints
- Do not load the entire Google Drive tree into memory — use generators/iterators
- Do not hardcode production URLs in code — use env vars
- Do not create new markdown files unless asked (except updating the docs above)
- **Do not read `.env`, `.dev.vars`, or any secret-containing file** — see "Safety Rules" at the top
- **Do not upgrade to paid services** (DO, R2, Workers Paid-only features) or raise crypto/observability iterations without approval — see "Cost Principle — $0 Cost, Maximize Free Tier"

## Rebrand Context (Future)

This project is planned to become a standalone application. When rebranding:

1. Update `package.json` names (`omnidrive` → new name)
2. Replace UI strings in `LoginPage`, `Header`, `SetupPage`
3. Update `docker-compose.yml`, `wrangler.toml` worker name
4. Add copyright in `LICENSE`, do not remove the old one
5. Update all documents in the `docs/` folder
