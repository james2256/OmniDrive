# ARCHITECTURE.md — System Architecture

OmniDrive architecture document — a multi-Google Drive storage gateway on the Cloudflare Edge.

## Overview

```
┌─────────────┐     REST/JSON      ┌──────────────────────────────────┐
│  React SPA  │ ◄────────────────► │  Cloudflare Worker (Hono API)    │
│  (Vite)     │   cookie session   │                                  │
│  Port 8999  │                    │  /api/*  → REST endpoints        │
└─────────────┘                    │  /s3/*   → S3-compatible API     │
       │                           └──────┬───────────┬───────────────┘
       │ dev proxy                        │           │
       ▼                                  ▼           ▼
  VITE_API_URL                      ┌─────────┐ ┌─────────┐
  → Worker :8888                    │ D1 (DB) │ │ KV      │
                                    │ SQLite  │ │ Tokens  │
                                    │ Session │ │ OAuth   │
                                    └─────────┘ └────┬────┘
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ▼                ▼                ▼
                              Google Drive     Google OAuth      Cron (30min)
                              API v3           2.0 + PKCE        Sync + Automation
```

## Monorepo Structure

| Package | npm name | Runtime | Entry |
|---------|----------|---------|-------|
| Root | `omnidrive` | — | npm workspaces orchestrator |
| Worker | `@omnidrive/worker` | Cloudflare Workers / Node (Docker) | `src/index.ts` |
| Web | `@omnidrive/web` | Browser (static via Pages) | `src/main.tsx` |

## Backend Architecture

### Request Pipeline

```
Incoming Request
    │
    ▼
securityHeaders          ← X-Content-Type-Options, CSP, etc.
    │
    ▼
corsMiddleware           ← Origin whitelist (FRONTEND_URL)
    │
    ▼
csrfGuard (/api/*)       ← Origin/Referer validation on mutations
    │
    ▼
rateLimiter              ← Per-route + global 100 req/min
    │
    ▼
Route Handler
    ├── authGuard        ← Cookie session (most /api routes)
    ├── rbac middleware  ← Workspace role checks
    └── s3-auth          ← AWS SigV4 (/s3 routes)
    │
    ▼
Service Layer            ← Business logic
    │
    ▼
D1 / KV / Google API
```

### Route Modules

| Prefix | Router | Auth | Purpose |
|--------|--------|------|---------|
| `/api/auth` | `routes/auth.ts` | Partial | Setup, login, register, OAuth, logout |
| `/api/drives` | `routes/drives.ts` | Required | Connect/disconnect drives, sync, browse |
| `/api/folders` | `routes/folders.ts` | Required | Workspace folder CRUD, tree |
| `/api/files` | `routes/files.ts` | Required | Search, upload, move, trash, metadata |
| `/api/workspaces` | `routes/workspaces.ts` | Required | Workspace CRUD, members, policies |
| `/api/shared` | `routes/shared.ts` | Mixed | Shared links (public + auth) |
| `/api/automations` | `routes/automations.ts` | Required | Automation rules |
| `/api/admin` | `routes/admin.ts` | Super admin | Users, invitations, audit |
| `/api/s3-credentials` | `routes/s3-credentials.ts` | Required | S3 API key management |
| `/s3` | `routes/s3.ts` | SigV4 | S3-compatible object storage |
| `/api/health` | inline | Public | Health check |

### Service Layer

| Service | File | Responsibility |
|---------|------|----------------|
| `GoogleDriveService` | `services/google-drive.ts` | Google Drive API v3 wrapper |
| `sync` | `services/sync.ts` | Full + incremental sync via Changes API |
| `AuthService` | `services/auth.service.ts` | Login, register, session, OAuth |
| `AutomationEngine` | `services/automation.service.ts` | Rule evaluation & execution |
| `AuditService` | `services/audit.service.ts` | Workspace audit logging |
| `PolicyService` | `services/policy.service.ts` | Quota & data retention |
| `UploadRouter` | `services/upload-router.ts` | Pick the drive with most free space for upload; spillover if preferred drive is full |
| `computeDriveQuota` | `lib/storage-quota.ts` | Compute total/used/free/percent + fallback chain & override |

### Middleware

| Middleware | File | Purpose |
|------------|------|---------|
| `authGuard` | `middleware/auth-guard.ts` | Cookie `omnidrive_sid` → D1 session |
| `csrfGuard` | `middleware/csrf-guard.ts` | CSRF protection |
| `rateLimiter` | `middleware/rate-limiter.ts` | Sliding window in-memory |
| `rbac` | `middleware/rbac.ts` | Workspace role authorization |
| `s3-auth` | `middleware/s3-auth.ts` | AWS Signature V4 verification |
| `cors` | `middleware/cors.ts` | CORS headers |
| `securityHeaders` | `middleware/security-headers.ts` | Security response headers |

## Authentication Flow

### Local Auth

```
Client POST /api/auth/login { username, password }
    → AuthService validates PBKDF2 hash (Web Crypto)
    → Create session in D1 (sessions table)
    → Set cookie omnidrive_sid
    → Return user JSON
```

### Google OAuth (Drive Connect)

```
Client GET /api/auth/google
    → Generate PKCE challenge (S256)
    → Store state in KV
    → Redirect to Google consent

Google GET /api/auth/callback?code=...&state=...
    → Verify state + exchange code (with PKCE verifier)
    → Encrypt tokens → KV (tokens:{driveId})
    → Link/create drive_account in D1
```

### Session Model

- **Storage**: Cloudflare D1 (`sessions` table) — migrated from KV (free tier 1k writes/day was exhausted by per-request extension)
- **Cookie**: `omnidrive_sid` (httpOnly)
- **TTL**: 7-day sliding window, throttled to extend at most once per hour (`touched_at`)
- **Cleanup**: expired rows removed by scheduled cron (`*/30`, `index.ts`)
- **Data**: `SessionData` (JSON in `data` column) — userId, username, role, createdAt

## Data Sync Architecture

### Initial Sync

```
syncDriveAccount()
    → iterateAllFilesAndFolders() [generator, OOM-safe]
    → Checkpoint via next_page_token in sync_state
    → Atomic upsert files/folders to D1
    → Respect getIsShuttingDown() for graceful stop
```

### Incremental Sync

```
Cron */30 * * * *
    → runScheduledSync()
    → Google Drive Changes API (change_token)
    → Process changes → upsert/delete in D1
```

### Manual Sync

- Per drive: `POST /api/drives/:id/sync`
- Per folder: `POST /api/folders/:id/sync` or `force-sync`

### Storage Quota & Capacity

Each drive's capacity is computed in `computeDriveQuota()` (`lib/storage-quota.ts`) with the following priority:

1. `drive_accounts.quota_override` (manual) — **deprecated, no endpoint/UI writes to it anymore** (the manual capacity editor feature was removed). The branch is kept read-only so no drop-column migration is needed.
2. `storageQuota.limit` from the Google API (if present — "if applicable")
3. `drive_accounts.total_quota` (cached)
4. `UNLIMITED_DRIVE_QUOTA_BYTES` (1 TiB fallback)

**Important note:** The Google Drive API does **not** return `storageQuota.limit` for:
- Google Workspace pooled storage (5 TB+ accounts)
- Service accounts

Those accounts fall back to 1 TiB. (Previously users could set `quota_override` manually via the Settings UI, but that feature was removed because it triggered an upload bug on service-account/shared drives.) `getQuota()` exposes `hasLimit` so routes don't overwrite the DB `total_quota` with the fallback value when Google omits the limit.

Usage (`used`) uses `storageQuota.usageInDrive` (Drive-only), not `usage` (account-wide: Drive+Gmail+Photos).

The quota cache in KV (`quota:{driveId}`, 5-minute TTL) is tagged with `QUOTA_CACHE_VERSION` so old entries auto-invalidate when the schema changes.

## S3 Compatibility Layer

Workspace = S3 Bucket. File path within a workspace = Object key.

```
Client (rclone/aws-cli)
    │
    ▼ SigV4 Authorization header
/s3/:bucket/:key
    │
    ▼ s3-auth middleware
    → Verify signature (with Accept-Encoding fallbacks)
    → Resolve workspace from bucket name
    → Enforce workspace_id scope if key is workspace-scoped
    │
    ▼
Google Drive API (stream read/write)
```

**Multipart upload**: parts buffered as temp files in a Google Drive folder → stream-concatenated on complete.

**Bucket lifecycle** (`?lifecycle` subresource on `/s3/:bucket`): `PutBucketLifecycleConfiguration` / `GetBucketLifecycleConfiguration` / `DeleteBucketLifecycleConfiguration`. Rule `Expiration/Days` per prefix is stored in `s3_lifecycle_rules`. Cron `*/30` **trashes** objects older than the window (recoverable ~30 days via Google, not a hard delete). The XML parser is regex-based (`services/s3-lifecycle.ts`), no XML dependency.

## Frontend Architecture

### Routing & Guards

```
App
 ├── SetupGuard     → redirect /setup if no admin exists
 ├── AuthGuard      → redirect /login if no session
 └── AppLayout      → authenticated shell
      └── Pages (Dashboard, Files, Workspaces, ...)
```

### Data Flow

```
Page Component
    → Zustand Store (optional cache)
    → api.ts request()
    → fetch(API_BASE + path, { credentials: 'include' })
    → Worker REST endpoint
    → JSON response
```

### Dev Proxy

The Vite dev server proxies `/api/*` to the Worker (`packages/web/vite.config.ts`), so frontend and backend can run on different ports without CORS issues.

## Scheduled Jobs (Cron)

Trigger: `*/30 * * * *` (every 30 minutes)

| Job | Service | Purpose |
|-----|---------|---------|
| Drive sync | `runScheduledSync()` | Incremental sync for all drives |
| Automation | `AutomationEngine.processCronTrigger()` | Evaluate rules |
| Audit cleanup | `AuditService.cleanupOldLogs(30)` | Delete logs older than 30 days |
| Data retention | `PolicyService.processAutoDeleteRetentionPolicies()` | Auto-delete per policy |
| S3 lifecycle | `runLifecycleExpiration()` | Trash S3 objects past `expiration_days` per rule (Option A, recoverable) |

## Security Model

| Threat | Mitigation |
|--------|------------|
| CSRF | Origin/Referer guard on mutations |
| Brute force | Rate limiter on login/register/verify |
| IDOR | Ownership scoping on shared links, files, workspaces |
| Token theft | AES-256-GCM encryption at rest in KV |
| Role escalation | RBAC middleware, role hierarchy enforcement |
| SSRF | Webhook URL validation |
| Session hijack | httpOnly cookie, 7-day sliding TTL, server-side revocable (D1) |
| S3 signature bypass | Timing-safe comparison, clock skew ±15min |

## Deployment Topology

### Cloudflare (Production)

```
Cloudflare Pages          Cloudflare Worker
(React static build)   →  (Hono API)
     │                         │
     │                         ├── D1 binding (DB)
     │                         ├── KV binding (KV)
     │                         └── Cron triggers
     │
VITE_API_URL points to Worker URL
```

### Docker (Self-hosted)

```
docker-compose.yml
    └── omnidrive-unified image
         ├── Node server (node-server.ts)
         ├── SQLite (better-sqlite3)
         └── KV polyfill (kv.ts)
```

## Environment & Configuration

| Config | Location | Scope |
|--------|----------|-------|
| `.env` | Root | Dev shared (web + worker) |
| `.dev.vars` | `packages/worker/` | Wrangler local secrets |
| `wrangler.toml` | `packages/worker/` | D1/KV bindings, cron, vars |
| `.env.production` | `packages/web/` | `VITE_API_URL` for build |

## Testing Strategy

| Area | Location | Framework |
|------|----------|-----------|
| Worker unit tests | `packages/worker/tests/` | Vitest |
| Worker src tests | `packages/worker/src/tests/` | Vitest |
| Web component tests | `packages/web/src/**/*.test.tsx` | Vitest + Testing Library |

**High-value test suites**: S3 API (33 tests), SigV4 auth, sync, validation, workspaces.

## Extension Points

| Want to add... | Start from |
|----------------|------------|
| REST endpoint | `packages/worker/src/routes/` + register in `index.ts` |
| Background job | `scheduled()` handler in `index.ts` |
| UI page | `packages/web/src/pages/` + route in `App.tsx` |
| DB table | `schema.sql` + migration file |
| Middleware | `packages/worker/src/middleware/` |
| Google API call | `GoogleDriveService` methods |

## Upstream & Fork

| Remote | Repo | Data direction |
|--------|------|----------------|
| `origin` | `asmaraputra/OmniDrive` | Push development |
| `upstream` | `abilfida/OmniDrive` | Fetch updates (optional) |

The MIT license permits independent modification. See `docs/AGENTS.md` for the development workflow.
