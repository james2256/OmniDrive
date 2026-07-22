# OmniDrive

**Unified multi-Google Drive storage gateway built on Cloudflare Workers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

---

## What is OmniDrive?

OmniDrive lets you connect multiple Google Drive accounts and manage all your files from a single dashboard. It runs entirely on Cloudflare's edge network — Workers for the API, D1 for the database, and KV for session storage — so there's no traditional server to maintain.

## Features

- **🔗 Multi-Drive Accounts** — Connect multiple Google Drive accounts via OAuth or Service Account JSON keys
- **🏢 Enterprise Workspaces** — Team workspaces with RBAC (viewer → owner), Quotas, Data Retention Policies, and Audit Logging
- **📁 Unified File Browsing** — Browse files across all connected drives in a single merged view
- **🔍 Global Search & Metadata** — Unified global search with metadata filtering, custom file metadata properties, and visual badges
- **⬆️ Smart Upload & Bulk Actions** — Drag-and-drop upload, automatic drive selection, and bulk operations (Move, Delete)
- **🔒 Shared Links** — Share files with password protection, expiration dates, and download limits
- **⚡ Automation Rules** — Auto-move or auto-delete files based on name or extension patterns
- **🔄 Resilient Background Sync** — Automatic sync via Google Drive Changes API (cron every 30 minutes). Features OOM-safe chunk processing using generators, resume-able syncs across restarts via `next_page_token`, atomic upserts for performance, and graceful shutdown (SIGTERM) to prevent concurrent syncs.
- **🎨 Modern UI** — Warm canvas design system with bento-grid dashboard, responsive layout, and Notion-style hierarchical workspace sidebar
- **☁️ S3 Object Storage API** — S3-compatible API (path-style access) exposing each workspace as a bucket; supports rclone, aws-cli, boto3, and AWS SDK with full Multipart Upload support

## Security

OmniDrive implements a robust security model to protect your files and data:
- **Token Encryption**: Google OAuth tokens are encrypted at rest using AES-256-GCM.
- **CSRF & SSRF Protection**: All mutating endpoints are protected against Cross-Site Request Forgery, and webhooks are validated against Server-Side Request Forgery.
- **Rate Limiting**: Built-in sliding window rate limiters protect authentication and public endpoints from brute-force attacks.
- **OAuth PKCE**: Authentication flow uses Proof Key for Code Exchange (S256) for enhanced security.
- **Strict Access Control**: Enforced RBAC role escalation prevention and IDOR (Insecure Direct Object Reference) prevention on all resource access.
- **Fail-Fast Env Validation**: Zod-validated environment at boot — missing secrets crash immediately instead of failing silently at runtime.

## S3 Object Storage API

OmniDrive exposes an S3-compatible Object Storage API. Any S3 client (rclone, aws-cli, boto3, AWS SDK) can connect to it using path-style access.

**How it works:**
- Each **Workspace** is a **Bucket**
- Files inside a workspace become **Objects**, with folder paths as key prefixes
- Generate per-user credentials from **Settings → S3 Credentials**

**Endpoint:** `https://<your-worker-url>/s3`

**rclone configuration example:**
```ini
[omnidrive]
type = s3
provider = Other
access_key_id = OMNI...
secret_access_key = ...
endpoint = https://<your-worker-url>/s3
force_path_style = true
```

**Supported operations:** ListBuckets, ListObjectsV2, GetObject, PutObject (single-part), HeadObject, DeleteObject, full Multipart Upload (Initiate, UploadPart, CompleteMultipartUpload, AbortMultipartUpload), and Bucket Lifecycle (Put/Get/DeleteBucketLifecycleConfiguration — expired objects are moved to Google Drive trash, recoverable ~30 days).

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | [Hono](https://hono.dev/) on [Cloudflare Workers](https://workers.cloudflare.com/) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| **Session Store** | [Cloudflare KV](https://developers.cloudflare.com/kv/) |
| **Frontend** | [React 19](https://react.dev/) + [Vite 8](https://vite.dev/) |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com/) (CSS-first `@theme` config) |
| **State Management** | [Zustand](https://zustand.docs.pmnd.rs/) + [TanStack Query](https://tanstack.com/query) |
| **Language** | [TypeScript 6](https://www.typescriptlang.org/) (strict mode) |
| **Testing** | [Vitest 4](https://vitest.dev/) + `@cloudflare/vitest-pool-workers` |
| **Auth** | Google OAuth 2.0 (PKCE) |
| **Runtime** | [Node.js 24](https://nodejs.org/) LTS |

## Architecture

```
omnidrive/
├── packages/
│   ├── worker/              # Cloudflare Worker (API backend)
│   │   ├── src/
│   │   │   ├── routes/          # 10 route files (thin orchestrators)
│   │   │   ├── services/        # 14 service files (business logic + RBAC)
│   │   │   ├── repositories/    # 9 repository files (all SQL)
│   │   │   ├── middleware/      # 11 middleware (auth, CORS, CSRF, rate limit, request ID, RBAC, S3 auth, shared services)
│   │   │   ├── lib/             # 16 utility files (crypto, validation, env, logger, schemas, password, PKCE, cursor, etc.)
│   │   │   ├── db/              # D1 schema
│   │   │   └── types/           # TypeScript types
│   │   ├── migrations/          # 4 D1 migrations
│   │   └── tests/               # 48 unit test files + 9 integration test files
│   └── web/                 # React SPA (frontend)
│       └── src/
│           ├── components/      # 6 dirs: files, layout, legal, settings, ui, workspaces
│           ├── pages/           # 19 pages (Dashboard, Files, Settings, Admin, Search, etc.)
│           ├── stores/          # 6 Zustand stores (auth, UI, upload, toast, selection, automation)
│           ├── hooks/           # 5 TanStack Query hooks (drives, file mutations, folder mutations, shared links, merged drive)
│           ├── lib/             # API client, query keys, invalidation helpers, utilities
│           └── types/           # TypeScript types
├── docs/                    # Project documentation
│   ├── PRD.md               # Product requirements document
│   ├── API.md               # API reference (all endpoints)
│   ├── ARCHITECTURE.md      # System architecture
│   ├── DEPLOYMENT.md        # Deployment guide (local/Docker/Cloudflare)
│   ├── SCHEMA.md            # D1 database schema
│   ├── DESIGN.md            # UI/UX design system
│   ├── AGENTS.md            # AI agent coding guide
│   ├── CONTRIBUTING.md      # Contributing guide
│   └── adr/                 # 8 Architecture Decision Records
├── scripts/                 # Deployment + onboarding scripts
├── Makefile                 # Deployment automation (10 targets)
└── package.json             # Monorepo root (npm workspaces)
```

**Repository Pattern:** All SQL lives in `repositories/`. Services own business logic + RBAC. Routes are thin orchestrators (parse → validate → call service → return JSON). 8 of 10 routes have zero inline SQL; the remaining 2 (`s3.ts` with 37, `auth.ts /callback` with 8) are deferred with `ponytail:` comments.

**Testing:** 63 test files (48 worker unit + 9 worker integration + 16 web component) run against real D1 via Miniflare. Run with `npm test`.

**Structured Logging:** Every request gets a UUID (`x-request-id` header). All error logs are JSON with `requestId`, `path`, `errorClass`, and `stack` — filterable in `wrangler tail`.

The backend and frontend communicate via REST API. In development, Vite's dev server proxies `/api/*` and `/s3/*` requests to the local Worker on port 8888.

## Prerequisites

- [Node.js](https://nodejs.org/) 24+ and npm
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A [Google Cloud project](https://console.cloud.google.com/) with the Google Drive API enabled
- An OAuth 2.0 Client ID (Web application type) from Google Cloud Console

## Getting Started

### 1. Setup Google OAuth Credentials

Before running the deployment wizard, ensure you have a Google OAuth App configured:
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add `http://localhost:8888/api/auth/callback` as an authorized redirect URI (if running locally) or your production domain callback.
4. Keep the Client ID and Client Secret handy.

### 2. Run the Interactive Setup (Quickstart)

OmniDrive includes a fully automated deployment wizard that configures your environment, sets up databases, and starts the application for you. You can run it directly via remote script:

```bash
curl -fsSL https://raw.githubusercontent.com/james2256/OmniDrive/main/deploy.sh | bash
```

*(This script will automatically clone the repository if it's not present in the current directory).*

Follow the prompts to select your deployment target:
- **💻 Local Development**: Automatically provisions local D1/KV databases, generates secrets, and starts `npm run dev`.
- **🐳 Docker Compose (Self-hosted)**: Generates `.env`, exposes your selected port, and runs `docker compose up -d`.
- **☁️ Cloudflare (Production)**: Provisions remote D1/KV resources, pushes secrets to Cloudflare, and deploys the API and Frontend directly to the edge.

Or use the [Cloudflare Pages dashboard](https://dash.cloudflare.com/?to=/:account/pages) for automatic deployments from your Git repo if you prefer CI/CD.

### 3. Manual Local Development Setup

If you prefer to set up manually:

```bash
git clone https://github.com/james2256/OmniDrive.git
cd OmniDrive
npm install

# Create local D1 database + run migrations
cd packages/worker
npx wrangler d1 create omnidrive  # copy database_id into wrangler.toml
npm run db:migrate:local

# Generate secrets (.dev.vars — read by Wrangler for local dev)
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

# Start both worker + web
cd ~/OmniDrive
npm run dev
```

Open **http://localhost:8999** — the app redirects to `/setup` to create your first admin account.

> **Note:** Google OAuth credentials are optional for local testing. Username/password auth works without them. Add them to `.dev.vars` only if you want to test the "Connect Google Drive" flow.

### 4. Manual Deployment to Cloudflare

If you prefer not to use the `deploy.sh` script, you can deploy manually:

1. **Login to Cloudflare via Wrangler**
   ```bash
   npx wrangler login
   ```
2. **Create D1 Database**
   ```bash
   npx wrangler d1 create omnidrive
   ```
   *Update `packages/worker/wrangler.toml` with the generated `database_id`.*
3. **Create KV Namespace**
   ```bash
   npx wrangler kv:namespace create OMNIDRIVE_SESSIONS
   ```
   *Update `packages/worker/wrangler.toml` with the generated KV `id`.*
4. **Apply Database Migrations**
   ```bash
   npm run db:migrate:remote -w packages/worker
   ```
5. **Set Secrets (Secure Environment Variables)**
   Run these commands one by one and enter the respective values:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID -c packages/worker/wrangler.toml
   npx wrangler secret put GOOGLE_CLIENT_SECRET -c packages/worker/wrangler.toml
   npx wrangler secret put JWT_SECRET -c packages/worker/wrangler.toml
   npx wrangler secret put TOKEN_ENCRYPTION_KEY -c packages/worker/wrangler.toml
   ```
6. **Deploy Worker (Backend)**
   ```bash
   npm run deploy -w packages/worker
   ```
   *Note the Worker URL provided after deployment.*
7. **Deploy Pages (Frontend)**
   Ensure you have configured `packages/web/.env.production` with your newly deployed Worker domain.
   ```bash
   npm run build -w packages/web
   npx wrangler pages deploy packages/web/dist --project-name=omnidrive-web
   ```

## Environment Variables

OmniDrive uses a **single centralized `.env` file** at the root of the project to manage both Web and Worker configurations. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the complete guide.

For local development, Wrangler reads secrets from `packages/worker/.dev.vars` (not `.env`). See the manual setup instructions above.

Copy `/.env.example` to `/.env` and fill in your values. This file is automatically read by both Vite and Wrangler during local development.

| Variable | Description | Default |
|----------|-------------|---------|
| `WEB_PORT` | Port for the React frontend | `8999` |
| `WORKER_PORT` | Port for the Cloudflare Worker API | `8888` |
| `FRONTEND_URL` | Frontend origin for CORS and redirects | `http://localhost:8999` |
| `WORKER_URL` | Worker URL for OAuth callback | `http://localhost:8888` |
| `VITE_API_URL` | Worker API base URL for the frontend (empty = same-origin) | |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | |
| `JWT_SECRET` | Session JWT signing key (min 32 chars) | |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for encrypting OAuth tokens + S3 secrets | |

*Note: For production on Cloudflare, backend secrets should be set via `wrangler secret put`, and non-secrets in `wrangler.toml` under `[vars]`. The frontend uses `packages/web/.env.production`.*

## Documentation

| Document | Description |
|----------|-------------|
| [docs/PRD.md](docs/PRD.md) | Product requirements — features, user stories, functional requirements |
| [docs/API.md](docs/API.md) | API reference — all endpoints, request/response shapes, status codes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture — request pipeline, service layer, repository pattern |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment guide — local dev, Docker self-host, Cloudflare production |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Database schema — all D1 tables with relationships |
| [docs/DESIGN.md](docs/DESIGN.md) | Design system — colors, typography, Tailwind 4 migration notes |
| [docs/AGENTS.md](docs/AGENTS.md) | AI agent guide — coding conventions, patterns, anti-patterns |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Contributing guide — development setup, commit conventions, debugging guide |
| [docs/DEBUGGING.md](docs/DEBUGGING.md) | Debugging guide — local dev, production, common issues, D1 queries |
| [docs/TESTING.md](docs/TESTING.md) | Testing guide — test suites, commands, patterns, writing new tests |
