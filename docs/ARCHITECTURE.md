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

## Tech Stack

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| Runtime | Node.js | 24 LTS | Required for local dev / Docker self-host |
| Language | TypeScript | 6.0.3 | Strict mode (`strict`, `noImplicitAny`, `noUnusedLocals`, …) in `tsconfig.base.json` |
| Backend framework | Hono | 4.12.x | Edge-first HTTP framework, runs on Workers and Node |
| Backend runtime | Cloudflare Workers | wrangler 4.112.0 | `wrangler.toml` declares D1/KV bindings + cron |
| Validation | Zod | 4.4.x | `zValidator` on every route; centralised schemas in `lib/schemas.ts` |
| Database | Cloudflare D1 (SQLite) | — | 23 tables, see `docs/SCHEMA.md` |
| Cache / tokens | Cloudflare KV | — | OAuth tokens (AES-256-GCM), quota cache |
| Frontend framework | React | 19.2.7 | Functional components + hooks only |
| Build tool | Vite | 8.1.5 | Dev server proxies `/api/*` to Worker |
| CSS | Tailwind CSS | 4.3.3 | CSS-first config with `@theme` in `app.css`; `tw-animate-css` 1.4.0 replaces `tailwindcss-animate` |
| UI primitives | Radix UI | latest | `@radix-ui/react-{dialog,dropdown-menu,context-menu,slot}` |
| Icons | lucide-react | 1.25.0 | — |
| Upload | react-dropzone | 19.1.1 | — |
| Server state | TanStack Query | 5.101.x | Query keys centralised in `lib/queryKeys.ts` |
| Client state | Zustand | 5.0.x | Stores: UI, auth, upload, selection, toast |
| Charts | Recharts | 3.10.x | Dashboard bento grid |
| Lint | ESLint | 10.7.0 | Flat config (`eslint.config.mjs`); `eslint-plugin-react` removed, `eslint-plugin-react-hooks` + `eslint-plugin-security` kept |
| Test runner | Vitest | 4.1.10 | Both worker and web packages |
| Integration test pool | `@cloudflare/vitest-pool-workers` | 0.18.6 | Real D1 via Miniflare (see Testing Strategy) |

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
| `FileService` | `services/file.service.ts` | Trash / restore / permanent-delete / rename / move / copy with workspace RBAC. Injects `FileRepository` + `FolderRepository` + `DriveRepository` + `GoogleDriveService` + `PolicyService`. The `DriveRepository` was added so `FileService` can power global search across the user's drives without going through `routes/drives.ts`. |
| `computeDriveQuota` | `lib/storage-quota.ts` | Compute total/used/free/percent + fallback chain & override |

### Repository Pattern

ADR-0003 (`docs/adr/0003-repository-pattern.md`) introduced a data-access layer between services and D1. **All SQL lives in repository classes; routes and services never write inline `db.prepare(...)` SQL** (with one deferred exception, see below).

Nine repositories exist today, one per logical domain:

| Repository | File | Owns |
|------------|------|------|
| `AdminRepository` | `repositories/admin.repository.ts` | Users, invitations, audit (read-only admin views) |
| `AuthRepository` | `repositories/auth.repository.ts` | `users`, `sessions`, setup state |
| `AutomationRepository` | `repositories/automation.repository.ts` | `automations` CRUD |
| `DriveRepository` | `repositories/drive.repository.ts` | `drive_accounts`, quota cache helpers |
| `FileRepository` | `repositories/file.repository.ts` | `files` UPSERT (sync engine), search, recent, trash |
| `FolderRepository` | `repositories/folder.repository.ts` | `folders` + `workspace_folders` |
| `S3CredentialsRepository` | `repositories/s3-credentials.repository.ts` | `s3_credentials` API keys |
| `SharedRepository` | `repositories/shared.repository.ts` | `shared_links` + password-hash + verify helpers |
| `WorkspaceRepository` | `repositories/workspace.repository.ts` | `workspaces`, `workspace_members`, RBAC role lookups |

**Rule:** routes are thin orchestrators — they validate input (Zod), call a service, and return JSON. Services own business logic and RBAC (`assertCanMutate`). Repositories own SQL.

**Deferred:** `routes/s3.ts` (854 lines, 37 inline `db.prepare(...)` calls) is intentionally **not** migrated to a repository yet — the S3 XML / SigV4 / multipart logic is interleaved with SQL inside the `PUT`/`POST` handlers, and extracting it safely requires the integration-test coverage that now exists (see Testing Strategy). A `// ponytail:` marker at the top of the file records the deferral and the trigger condition.

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

**Multipart upload**: S3 clients (rclone, aws-cli, …) split large objects into parts and upload them in parallel. OmniDrive buffers each part as a separate file inside a **per-upload temp folder in Google Drive** (`.omnidrive_multipart_<uploadId>`), tracking parts in the `s3_multipart_uploads` + `s3_multipart_parts` tables. On `CompleteMultipartUpload` the parts are stream-concatenated into the final object and the temp folder is deleted; on `AbortMultipartUpload` the temp folder is trashed. This avoids buffering any part in Worker memory and stays within the Cloudflare 128 MB / subrequest limits.

**Bucket lifecycle** (`?lifecycle` subresource on `/s3/:bucket`): `PutBucketLifecycleConfiguration` / `GetBucketLifecycleConfiguration` / `DeleteBucketLifecycleConfiguration`. Rule `Expiration/Days` per prefix is stored in `s3_lifecycle_rules`. Cron `*/30` **trashes** objects older than the window (recoverable ~30 days via Google, not a hard delete). The XML parser is regex-based (`services/s3-lifecycle.ts`), no XML dependency.

## Frontend Architecture

### Pages

17 page components under `packages/web/src/pages/`, wired in `App.tsx`:

| Page | Route | Auth | Purpose |
|------|-------|------|---------|
| `LandingPage` | `/home` | Public | Marketing landing |
| `PrivacyPolicyPage` | `/privacy` | Public | Privacy policy |
| `TermsOfServicePage` | `/terms` | Public | Terms of service |
| `SetupPage` | `/setup` | Public | First-run admin setup |
| `LoginPage` | `/login` | Public | Login form |
| `PublicSharedPage` | `/shared/:id` | Public | Public shared-link download (password-gated) |
| `DashboardPage` | `/` | Auth | Bento-grid dashboard (storage hero, category donut, recent files, quick access) |
| `SearchPage` | `/search` | Auth | Omnibar-driven global search results |
| `FilesPage` | `/files[/:folderId]` | Auth | File browser (grid + list view) |
| `WorkspacesPage` | `/workspaces` | Auth | Workspace CRUD + members + audit + settings tabs |
| `AutomationsPage` | `/automations` | Auth | Automation rules |
| `SettingsPage` | `/settings`, `/settings/drives` | Auth | Account, drives, S3 keys tabs |
| `SharedLinksPage` | `/shared` | Auth | Shared links I've created |
| `ExternalPage` | `/external[/:folderId]` | Auth | Items I own not in My Drive (computer backups + shared territory) |
| `TrashPage` | `/trash` | Auth | Trashed files (restore / permanent delete) |
| `StarredPage` | `/starred` | Auth | Starred files |
| `AdminUsersPage` | `/admin/users` | Super admin | User admin, invitations, audit |

### Routing & Guards

```
App
 ├── SetupGuard     → redirect /setup if no admin exists
 ├── AuthGuard      → redirect /login if no session
 └── AppLayout      → authenticated shell (Header + Sidebar + MainContent)
      └── Pages (Dashboard, Files, Workspaces, ...)
```

### State Management

Two complementary stores — **Zustand for client/UI state, TanStack Query for server state**:

| Store | File | Holds |
|-------|------|-------|
| `useUIStore` | `stores/useUIStore.ts` | Sidebar collapse, view mode (grid/list), sort, info-panel open |
| `useAuthStore` | `stores/useAuthStore.ts` | Current user, isSetup flag |
| `useUploadStore` | `stores/useUploadStore.ts` | Upload queue + progress |
| `useSelectionStore` | `stores/useSelectionStore.ts` | Multi-select file/folder ids |
| `useToastStore` | `stores/useToastStore.ts` | Toast queue |

TanStack Query (`@tanstack/react-query` 5.x) caches server state. Query keys are centralised in `lib/queryKeys.ts`, and cache invalidation goes through `lib/invalidate.ts` so mutation hooks can blast the right keys after writes.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `Omnibar` | `components/layout/Omnibar.tsx` | Global search box in the header. Hits `/api/files/search` and renders grouped folder + file results; selecting a folder navigates to it, selecting a file opens the preview modal. |
| `FileGrid` / `FileGridView` / `FileListView` | `components/files/` | File browser with grid + list modes, drag-select, context menu (`ItemContextMenu`), drag-and-drop (`DropZone` via `react-dropzone` 19.1.1) |
| `ShareModal` / `EditShareModal` | `components/` | Create / edit shared links (password, expiry, role) |
| `DashboardPage` bento grid | `pages/DashboardPage.tsx` | 4-column responsive bento (`bento-reveal` animation): storage hero (`StorageHero`), category donut (Recharts), recent files tile, quick-access tile. Uses `lg:col-span-*` / `lg:row-span-*` for asymmetric layout. |
| `UploadModal` | `components/UploadModal.tsx` | Upload progress modal wired to `useUploadStore` |
| `MoveModal` / `MoveDriveModal` | `components/` | Move files between folders / drives |
| `FilePreviewModal` | `components/FilePreviewModal.tsx` | Inline file preview |
| Settings tabs | `components/settings/` | `SettingsAccountTab`, `SettingsDrivesTab`, `SettingsS3Tab` (split out from the old 646-line `SettingsPage`) |
| Workspace tabs | `components/workspaces/` | `WorkspaceFilesTab`, `WorkspaceMembersTab`, `WorkspaceSettingsTab`, `WorkspaceAuditTab`, `WorkspaceSidebar`, `WorkspaceTreeNode` |

### Data Flow

```
Page Component
    → Zustand Store (UI state: selection, view mode, toasts)
    → TanStack Query (server state: useFilesQuery, useWorkspacesQuery, …)
    → api.ts request()
    → fetch(API_BASE + path, { credentials: 'include' })
    → Worker REST endpoint
    → JSON response
    → TanStack Query cache → component re-render
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

**370 tests total** across three suites:

| Suite | Count | Location | Framework |
|-------|-------|----------|-----------|
| Worker unit | 246 | `packages/worker/tests/*.test.ts` (38 files) + `packages/worker/src/tests/` | Vitest 4.1.10 |
| Worker integration | 65 | `packages/worker/tests/integration/*.test.ts` (9 files) | Vitest 4.1.10 + `@cloudflare/vitest-pool-workers` 0.18.6 |
| Web | 59 | `packages/web/src/**/*.test.{ts,tsx}` (13 files) | Vitest 4.1.10 + Testing Library (jsdom) |

### Integration tests

The integration suite uses `@cloudflare/vitest-pool-workers` 0.18.6 with the `cloudflareTest()` plugin (configured in `packages/worker/vitest.integration.config.mts`). Tests run against a **real D1 instance spun up by Miniflare** using the same `wrangler.toml` bindings as production — no `vi.fn()` mocks for D1. A seed fixture (`tests/integration/helpers.ts`) inserts 1 user, 1 drive, files, and workspaces before each test.

Run them with:

```bash
npm run test:worker                       # unit only
npm run test:integration --prefix packages/worker   # integration only
npm run test                              # everything (worker + web)
```

Integration suites cover: `repositories.test.ts` (every repository), `shared-links-quota`, `auth-flow`, `workspace-rbac`, `s3-protocol`, `oauth-callback`, `folder-browsing`, `shared-link-download`, `files-sql`.

**High-value unit suites**: S3 API (33 tests), SigV4 auth, sync, validation, workspaces.

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
| `upstream` | `james2256/OmniDrive` | Fetch updates (optional) |

The MIT license permits independent modification. See `docs/AGENTS.md` for the development workflow.
