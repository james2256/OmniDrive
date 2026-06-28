# ARCHITECTURE.md — System Architecture

Dokumen arsitektur OmniDrive — gateway penyimpanan multi-Google Drive di Cloudflare Edge.

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
                                    │ SQLite  │ │ Session │
                                    └─────────┘ └────┬────┘
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ▼                ▼                ▼
                              Google Drive     Google OAuth      Cron (30min)
                              API v3           2.0 + PKCE        Sync + Automation
```

## Monorepo Structure

| Package | Nama npm | Runtime | Entry |
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
securityHeaders          ← X-Content-Type-Options, CSP, dll.
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

| Prefix | Router | Auth | Fungsi |
|--------|--------|------|--------|
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

| Service | File | Tanggung jawab |
|---------|------|---------------|
| `GoogleDriveService` | `services/google-drive.ts` | Google Drive API v3 wrapper |
| `DriveService` | `services/drive.service.ts` | Drive account management |
| `sync` | `services/sync.ts` | Full + incremental sync via Changes API |
| `AuthService` | `services/auth.service.ts` | Login, register, session, OAuth |
| `AutomationEngine` | `services/automation.service.ts` | Rule evaluation & execution |
| `AuditService` | `services/audit.service.ts` | Workspace audit logging |
| `PolicyService` | `services/policy.service.ts` | Quota & data retention |
| `UploadRouter` | `services/upload-router.ts` | Smart drive selection for uploads |

### Middleware

| Middleware | File | Fungsi |
|------------|------|--------|
| `authGuard` | `middleware/auth-guard.ts` | Cookie `omnidrive_sid` → KV session |
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
    → AuthService validates bcrypt hash
    → Create session in KV (session:{uuid})
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

- **Storage**: Cloudflare KV
- **Cookie**: `omnidrive_sid` (httpOnly)
- **TTL**: 7-day sliding window per request
- **Max age**: 30-day absolute (`auth-guard.ts`)
- **Data**: `SessionData` — userId, username, role, createdAt

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
- Per folder: `POST /api/folders/:id/sync` atau `force-sync`

## S3 Compatibility Layer

Workspace = S3 Bucket. File path dalam workspace = Object key.

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

**Multipart upload**: parts buffered as temp files in Google Drive folder → stream-concatenated on complete.

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

Vite dev server proxies `/api/*` ke Worker (`packages/web/vite.config.ts`), sehingga frontend dan backend bisa di port berbeda tanpa CORS issue.

## Scheduled Jobs (Cron)

Trigger: `*/30 * * * *` (setiap 30 menit)

| Job | Service | Fungsi |
|-----|---------|--------|
| Drive sync | `runScheduledSync()` | Incremental sync semua drives |
| Automation | `AutomationEngine.processCronTrigger()` | Evaluasi rules |
| Audit cleanup | `AuditService.cleanupOldLogs(30)` | Hapus log > 30 hari |
| Data retention | `PolicyService.processAutoDeleteRetentionPolicies()` | Auto-delete per policy |

## Security Model

| Threat | Mitigasi |
|--------|----------|
| CSRF | Origin/Referer guard pada mutasi |
| Brute force | Rate limiter pada login/register/verify |
| IDOR | Ownership scoping di shared links, files, workspaces |
| Token theft | AES-256-GCM encryption at rest in KV |
| Role escalation | RBAC middleware, role hierarchy enforcement |
| SSRF | Webhook URL validation |
| Session hijack | httpOnly cookie, 30-day max session |
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

| Config | Lokasi | Scope |
|--------|--------|-------|
| `.env` | Root | Dev shared (web + worker) |
| `.dev.vars` | `packages/worker/` | Wrangler local secrets |
| `wrangler.toml` | `packages/worker/` | D1/KV bindings, cron, vars |
| `.env.production` | `packages/web/` | `VITE_API_URL` for build |

## Testing Strategy

| Area | Lokasi | Framework |
|------|--------|-----------|
| Worker unit tests | `packages/worker/tests/` | Vitest |
| Worker src tests | `packages/worker/src/tests/` | Vitest |
| Web component tests | `packages/web/src/**/*.test.tsx` | Vitest + Testing Library |

**High-value test suites**: S3 API (33 tests), SigV4 auth, sync, validation, workspaces.

## Extension Points

| Mau tambah... | Mulai dari |
|---------------|-----------|
| REST endpoint | `packages/worker/src/routes/` + register di `index.ts` |
| Background job | `scheduled()` handler di `index.ts` |
| UI page | `packages/web/src/pages/` + route di `App.tsx` |
| DB table | `schema.sql` + migration file |
| Middleware | `packages/worker/src/middleware/` |
| Google API call | `GoogleDriveService` methods |

## Upstream & Fork

| Remote | Repo | Arah data |
|--------|------|-----------|
| `origin` | `asmaraputra/OmniDrive` | Push development |
| `upstream` | `abilfida/OmniDrive` | Fetch updates (opsional) |

Lisensi MIT mengizinkan modifikasi independen. Lihat `AGENTS.md` untuk workflow development.