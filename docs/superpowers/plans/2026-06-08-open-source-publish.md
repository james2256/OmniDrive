# Open Source Publish Preparation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the Omnidrive monorepo for public open-source release on GitHub by securing credentials, cleaning dev artifacts, fixing bugs, and writing documentation.

**Architecture:** A monorepo (`packages/worker` + `packages/web`) that needs config templating (wrangler.example.toml, .env.example, .dev.vars.example), expanded .gitignore, temp file cleanup, two bug fixes, and full documentation (README bilingual, CHANGELOG, LICENSE, package metadata).

**Tech Stack:** Node.js monorepo, Cloudflare Workers (Hono), React 19 + Vite, TypeScript

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Delete | `fix.js` | Temp dev artifact |
| Delete | `replace_api.js` | Temp dev artifact |
| Delete | `test-crypto.js` (root) | Temp dev artifact |
| Delete | `test-date.ts` | Temp dev artifact |
| Delete | `test_api.js` | Temp dev artifact |
| Delete | `packages/worker/test-crypto.js` | Temp dev artifact |
| Delete | `packages/worker/test-local.js` | Temp dev artifact |
| Delete | `packages/worker/test-script.js` | Temp dev artifact |
| Modify | `packages/web/src/pages/SharedLinksPage.tsx` | Fix bad import |
| Modify | `packages/web/src/components/ShareModal.tsx` | Fix interface mismatch |
| Create | `packages/worker/wrangler.example.toml` | Template for contributor wrangler config |
| Create | `packages/worker/.dev.vars.example` | Template for dev secrets |
| Create | `packages/web/.env.example` | Template for web env vars |
| Modify | `.gitignore` | Expand coverage |
| Untrack | `packages/web/.env.production` | Remove from git index |
| Untrack | `packages/worker/wrangler.toml` | Remove from git index |
| Create | `LICENSE` | MIT License |
| Create | `CHANGELOG.md` | Version history |
| Modify | `package.json` (root) | Add metadata fields |
| Create | `README.md` | English documentation |
| Create | `README.id.md` | Indonesian documentation |

---

### Task 1: Delete Temporary Dev Files

**Files:**
- Delete: `fix.js`
- Delete: `replace_api.js`
- Delete: `test-crypto.js` (root)
- Delete: `test-date.ts`
- Delete: `test_api.js`
- Delete: `packages/worker/test-crypto.js`
- Delete: `packages/worker/test-local.js`
- Delete: `packages/worker/test-script.js`

- [ ] **Step 1: Remove all 8 temporary files from git**

```bash
git rm fix.js replace_api.js test-crypto.js test-date.ts test_api.js \
  packages/worker/test-crypto.js packages/worker/test-local.js packages/worker/test-script.js
```

Expected: 8 files staged for deletion.

- [ ] **Step 2: Verify no temp files remain**

```bash
ls -la fix.js replace_api.js test-crypto.js test-date.ts test_api.js \
  packages/worker/test-crypto.js packages/worker/test-local.js packages/worker/test-script.js 2>&1
```

Expected: All files should return "No such file or directory".

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove temporary dev/debug scripts

Delete 8 scratch files used during development:
- fix.js, replace_api.js, test-crypto.js, test-date.ts, test_api.js (root)
- test-crypto.js, test-local.js, test-script.js (worker)"
```

---

### Task 2: Fix Bug — SharedLinksPage.tsx Bad Import

**Files:**
- Modify: `packages/web/src/pages/SharedLinksPage.tsx`

`SharedLinksPage.tsx` imports `request` from `../lib/api`, but `request` is a private (non-exported) function. The page uses two API calls: `GET /api/shared` (list) and `DELETE /api/shared/:id` (revoke). The correct exported functions are `getSharedLinks` and `deleteSharedLink`.

- [ ] **Step 1: Replace SharedLinksPage.tsx with fixed imports**

Replace the entire file content of `packages/web/src/pages/SharedLinksPage.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { getSharedLinks, deleteSharedLink, SharedLink } from '../lib/api';

export function SharedLinksPage() {
  const [links, setLinks] = useState<SharedLink[]>([]);

  useEffect(() => {
    getSharedLinks().then((res) => setLinks(res.links));
  }, []);

  const revoke = async (id: string) => {
    await deleteSharedLink(id);
    setLinks(links.filter(l => l.id !== id));
  };

  return (
    <div className="p-4">
      <h2>Active Shared Links</h2>
      <ul>
        {links.map(link => (
          <li key={link.id}>
            {link.id} - Views: {link.viewCount} - Downloads: {link.downloadCount}
            <button onClick={() => revoke(link.id)}>Stop Sharing</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Note: The `SharedLink` type from `api.ts` does not have `viewCount` or `downloadCount` fields. These fields exist in the database (`shared_links` table has `view_count` and `download_count` columns) and the API returns them, but the `SharedLink` TypeScript interface in `api.ts` doesn't include them. We need to add them.

- [ ] **Step 2: Add missing fields to SharedLink interface in api.ts**

In `packages/web/src/lib/api.ts`, find the `SharedLink` interface (around line 107) and add the missing fields:

Replace:
```typescript
export interface SharedLink {
  id: string;
  userId: string;
  targetType: 'file' | 'folder';
  targetId: string;
  expiresAt: string | null;
  createdAt: string;
}
```

With:
```typescript
export interface SharedLink {
  id: string;
  userId: string;
  targetType: 'file' | 'folder';
  targetId: string;
  expiresAt: string | null;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
}
```

- [ ] **Step 3: Verify the build passes**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/SharedLinksPage.tsx packages/web/src/lib/api.ts
git commit -m "fix: SharedLinksPage use exported API functions

Replace private 'request' import with exported 'getSharedLinks' and
'deleteSharedLink'. Add viewCount/downloadCount to SharedLink type."
```

---

### Task 3: Fix Bug — ShareModal.tsx Interface Mismatch

**Files:**
- Modify: `packages/web/src/components/ShareModal.tsx:44`

`ShareModal.tsx` line 44 calls `createSharedLink(targetType, targetId, password, isoExpiresAt)` with positional arguments, but the function signature is `createSharedLink(payload: CreateSharedLinkPayload)` — a single object.

- [ ] **Step 1: Fix the createSharedLink call**

In `packages/web/src/components/ShareModal.tsx`, find line 44:

```typescript
      const resp = await createSharedLink(targetType, targetId, password || undefined, isoExpiresAt);
```

Replace with:

```typescript
      const resp = await createSharedLink({
        targetType,
        targetId,
        password: password || undefined,
        expiresAt: isoExpiresAt,
      });
```

- [ ] **Step 2: Verify the build passes**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ShareModal.tsx
git commit -m "fix: ShareModal pass object to createSharedLink

The function expects a CreateSharedLinkPayload object, not positional args."
```

---

### Task 4: Create Example/Template Config Files

**Files:**
- Create: `packages/worker/wrangler.example.toml`
- Create: `packages/worker/.dev.vars.example`
- Create: `packages/web/.env.example`

- [ ] **Step 1: Create wrangler.example.toml**

Create `packages/worker/wrangler.example.toml` with:

```toml
# Omnidrive API — Cloudflare Worker Configuration
# Copy this file to wrangler.toml and fill in your values:
#   cp wrangler.example.toml wrangler.toml

name = "omnidrive-api"
main = "src/index.ts"
compatibility_date = "2025-06-01"

[triggers]
crons = ["*/30 * * * *"]

# D1 Database — create with: npx wrangler d1 create omnidrive
[[d1_databases]]
binding = "DB"
database_name = "omnidrive"
database_id = "<your-d1-database-id>"

# KV Namespace — create with: npx wrangler kv namespace create KV
[[kv_namespaces]]
binding = "KV"
id = "<your-kv-namespace-id>"

[vars]
FRONTEND_URL = "http://localhost:5173"
WORKER_URL = "http://localhost:8787"

[observability]
enabled = false
head_sampling_rate = 1

[observability.logs]
enabled = true
head_sampling_rate = 1
persist = true
invocation_logs = true

[observability.traces]
enabled = false
persist = true
head_sampling_rate = 1
```

- [ ] **Step 2: Create .dev.vars.example**

Create `packages/worker/.dev.vars.example` with:

```
# Omnidrive Worker Secrets
# Copy this file to .dev.vars and fill in your values:
#   cp .dev.vars.example .dev.vars
#
# Get these from Google Cloud Console > APIs & Services > Credentials
# Create an OAuth 2.0 Client ID (Web application type)

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

- [ ] **Step 3: Create .env.example for web**

Create `packages/web/.env.example` with:

```
# Omnidrive Web — Environment Variables
# Copy this file to .env and fill in your values:
#   cp .env.example .env
#
# For local development, leave VITE_API_URL empty.
# The Vite dev server proxies /api/* to http://localhost:8787 automatically.
#
# For production builds, set this to your deployed Worker URL:
#   VITE_API_URL=https://your-worker.your-subdomain.workers.dev

VITE_API_URL=
```

- [ ] **Step 4: Commit**

```bash
git add packages/worker/wrangler.example.toml packages/worker/.dev.vars.example packages/web/.env.example
git commit -m "chore: add example config templates for contributors

- wrangler.example.toml: Worker config with placeholder resource IDs
- .dev.vars.example: Google OAuth credentials template
- .env.example: Web env vars template (VITE_API_URL)"
```

---

### Task 5: Update .gitignore and Untrack Sensitive Files

**Files:**
- Modify: `.gitignore`
- Untrack: `packages/web/.env.production`
- Untrack: `packages/worker/wrangler.toml`

- [ ] **Step 1: Replace .gitignore with expanded version**

Replace the entire content of `.gitignore` with:

```gitignore
# Dependencies
node_modules/

# Build output
dist/
tsconfig.tsbuildinfo

# Cloudflare
.dev.vars
.wrangler/
.mf/
wrangler.toml

# Environment files
.env*
!.env.example

# Local overrides
*.local

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
```

- [ ] **Step 2: Untrack .env.production (keep local file)**

```bash
git rm --cached packages/web/.env.production
```

Expected: `rm 'packages/web/.env.production'` — removes from index only, file stays on disk.

- [ ] **Step 3: Untrack wrangler.toml (keep local file)**

```bash
git rm --cached packages/worker/wrangler.toml
```

Expected: `rm 'packages/worker/wrangler.toml'` — removes from index only, file stays on disk.

- [ ] **Step 4: Verify untracked files still exist locally**

```bash
test -f packages/web/.env.production && echo "OK: .env.production exists" || echo "FAIL"
test -f packages/worker/wrangler.toml && echo "OK: wrangler.toml exists" || echo "FAIL"
```

Expected: Both print "OK".

- [ ] **Step 5: Verify they are now gitignored**

```bash
git status --short packages/web/.env.production packages/worker/wrangler.toml
```

Expected: No output (files are ignored).

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: expand .gitignore and untrack sensitive config files

- Add wrangler.toml, .env*, tsconfig.tsbuildinfo, .DS_Store, *.log
- Untrack packages/web/.env.production (contains deployment URL)
- Untrack packages/worker/wrangler.toml (contains personal resource IDs)
- Both files remain locally for the original developer's use"
```

---

### Task 6: Create LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create MIT License file**

Create `LICENSE` at the project root with:

```
MIT License

Copyright (c) 2026 abilfida

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT License"
```

---

### Task 7: Create CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create CHANGELOG.md**

Create `CHANGELOG.md` at the project root with:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-06-08

### Added

- Google OAuth authentication with session management (KV-backed, 7-day sliding window)
- Multi-Google Drive account support (OAuth and Service Account)
- Google Drive file sync — initial full sync and incremental sync via Changes API
- Cron-based automatic sync (every 30 minutes)
- Virtual folder system for cross-drive file organization
- Merged drive view with unified browsing across all connected drives
- File upload with drag-and-drop and smart drive selection (most free space)
- Breadcrumb navigation for folder hierarchy
- Password-protected shared links with expiry and download limits
- File automation rules engine — auto-move and auto-delete based on name/extension conditions
- Dark mode UI design system with Inter font
- Dashboard with aggregate storage stats across all drives
- File preview modal for images and documents
- Settings page for managing connected drives
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md with v0.1.0 release notes"
```

---

### Task 8: Update Root package.json Metadata

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add metadata fields to package.json**

In the root `package.json`, add `version`, `description`, `license`, `author`, and `repository` fields. The final file should be:

```json
{
  "name": "omnidrive",
  "version": "0.1.0",
  "description": "Unified multi-Google Drive storage gateway built on Cloudflare Workers",
  "private": true,
  "license": "MIT",
  "author": "abilfida",
  "repository": {
    "type": "git",
    "url": "https://github.com/abilfida/omnidrive.git"
  },
  "workspaces": [
    "packages/worker",
    "packages/web"
  ],
  "scripts": {
    "dev:worker": "npm run dev -w packages/worker",
    "dev:web": "npm run dev -w packages/web",
    "dev": "concurrently \"npm run dev:worker\" \"npm run dev:web\"",
    "build:worker": "npm run build -w packages/worker",
    "build:web": "npm run build -w packages/web",
    "test": "npm run test -w packages/worker"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Verify package.json is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"
```

Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add project metadata to package.json

Add version (0.1.0), description, license (MIT), author, and
repository URL fields for open-source publishing."
```

---

### Task 9: Create README.md (English)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

Create `README.md` at the project root with:

````markdown
# Omnidrive

**Unified multi-Google Drive storage gateway built on Cloudflare Workers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

> 🌐 *Baca dalam [Bahasa Indonesia](README.id.md)*

---

## What is Omnidrive?

Omnidrive lets you connect multiple Google Drive accounts and manage all your files from a single dashboard. It runs entirely on Cloudflare's edge network — Workers for the API, D1 for the database, and KV for session storage — so there's no traditional server to maintain.

## Features

- **🔗 Multi-Drive Accounts** — Connect multiple Google Drive accounts via OAuth or Service Account JSON keys
- **📁 Unified File Browsing** — Browse files across all connected drives in a single merged view
- **🗂️ Virtual Folders** — Create your own folder structure to organize files across different drives
- **⬆️ Smart Upload** — Drag-and-drop file upload with automatic drive selection (picks the drive with the most free space)
- **🔒 Shared Links** — Share files with password protection, expiration dates, and download limits
- **⚡ Automation Rules** — Auto-move or auto-delete files based on name or extension patterns
- **🔄 Real-Time Sync** — Automatic sync via Google Drive Changes API (cron every 30 minutes)
- **🌙 Dark Mode** — Modern dark theme UI with responsive design

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | [Hono](https://hono.dev/) on [Cloudflare Workers](https://workers.cloudflare.com/) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| **Session Store** | [Cloudflare KV](https://developers.cloudflare.com/kv/) |
| **Frontend** | [React 19](https://react.dev/) + [Vite](https://vite.dev/) |
| **State Management** | [Zustand](https://zustand.docs.pmnd.rs/) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **Auth** | Google OAuth 2.0 |

## Architecture

```
omnidrive/
├── packages/
│   ├── worker/          # Cloudflare Worker (API backend)
│   │   ├── src/
│   │   │   ├── routes/      # API route handlers
│   │   │   ├── services/    # Business logic (Google Drive, sync, auth)
│   │   │   ├── middleware/  # Auth guard, CORS, error handling
│   │   │   ├── db/          # D1 schema
│   │   │   └── types/       # TypeScript types
│   │   └── tests/           # Vitest unit tests
│   └── web/             # React SPA (frontend)
│       └── src/
│           ├── components/  # UI components
│           ├── pages/       # Route pages
│           ├── stores/      # Zustand state stores
│           ├── hooks/       # Custom React hooks
│           ├── lib/         # API client, utilities
│           └── types/       # TypeScript types
├── docs/                # Design specs and implementation plans
├── Makefile             # Deployment automation
└── package.json         # Monorepo root (npm workspaces)
```

The backend and frontend communicate via REST API. In development, Vite's dev server proxies `/api/*` requests to the local Worker on port 8787.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A [Google Cloud project](https://console.cloud.google.com/) with the Google Drive API enabled
- An OAuth 2.0 Client ID (Web application type) from Google Cloud Console

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/abilfida/omnidrive.git
cd omnidrive
npm install
```

### 2. Configure the Worker

```bash
# Copy the example config
cp packages/worker/wrangler.example.toml packages/worker/wrangler.toml

# Create a D1 database
npx wrangler d1 create omnidrive
# Copy the database_id from the output into wrangler.toml

# Create a KV namespace
npx wrangler kv namespace create KV
# Copy the namespace id from the output into wrangler.toml

# Apply the database schema
npx wrangler d1 execute omnidrive --local --file=packages/worker/src/db/schema.sql
```

### 3. Set Up Google OAuth Credentials

```bash
# Copy the secrets template
cp packages/worker/.dev.vars.example packages/worker/.dev.vars
```

Edit `packages/worker/.dev.vars` and fill in your Google OAuth credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add `http://localhost:8787/api/auth/google/callback` as an authorized redirect URI
4. Copy the Client ID and Client Secret into `.dev.vars`

### 4. Configure the Frontend

```bash
cp packages/web/.env.example packages/web/.env
```

For local development, leave `VITE_API_URL` empty — the Vite dev server proxies API calls automatically.

### 5. Run

```bash
npm run dev
```

This starts both the Worker (port 8787) and the web app (port 5173) concurrently. Open [http://localhost:5173](http://localhost:5173) in your browser.

## Deployment

### Backend (Cloudflare Workers)

```bash
# Set production secrets
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Update FRONTEND_URL and WORKER_URL in wrangler.toml [vars] to production URLs

# Deploy
make deploy-worker
```

### Frontend (Cloudflare Pages)

```bash
# Set VITE_API_URL in packages/web/.env.production to your Worker URL
make deploy-web
```

Or use the [Cloudflare Pages dashboard](https://dash.cloudflare.com/?to=/:account/pages) for automatic deployments from your Git repo.

## Environment Variables

### Worker Secrets (set via `wrangler secret put` or `.dev.vars`)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |

### Worker Config (set in `wrangler.toml` `[vars]`)

| Variable | Description | Default |
|----------|-------------|---------|
| `FRONTEND_URL` | Frontend origin for CORS and redirects | `http://localhost:5173` |
| `WORKER_URL` | Worker URL for OAuth callback | `http://localhost:8787` |

### Worker Bindings (set in `wrangler.toml`)

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | SQLite database for all application data |
| `KV` | KV Namespace | Session storage and OAuth token cache |

### Web Environment (set in `.env` or `.env.production`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Worker API base URL (empty for local dev) | `""` |

## License

[MIT](LICENSE) © 2026 abilfida
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README.md with project overview and setup guide"
```

---

### Task 10: Create README.id.md (Indonesian)

**Files:**
- Create: `README.id.md`

- [ ] **Step 1: Create README.id.md**

Create `README.id.md` at the project root with:

````markdown
# Omnidrive

**Gateway penyimpanan multi-Google Drive terpadu yang dibangun di atas Cloudflare Workers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

> 🌐 *Read in [English](README.md)*

---

## Apa itu Omnidrive?

Omnidrive memungkinkan kamu menghubungkan beberapa akun Google Drive dan mengelola semua file dari satu dashboard. Semuanya berjalan di jaringan edge Cloudflare — Workers untuk API, D1 untuk database, dan KV untuk penyimpanan sesi — sehingga tidak perlu server tradisional.

## Fitur

- **🔗 Multi-Akun Drive** — Hubungkan beberapa akun Google Drive via OAuth atau Service Account JSON
- **📁 Browsing File Terpadu** — Jelajahi file dari semua drive yang terhubung dalam satu tampilan gabungan
- **🗂️ Folder Virtual** — Buat struktur folder sendiri untuk mengorganisir file lintas drive
- **⬆️ Upload Cerdas** — Drag-and-drop upload dengan pemilihan drive otomatis (pilih drive dengan ruang kosong terbanyak)
- **🔒 Shared Links** — Bagikan file dengan proteksi password, tanggal kadaluarsa, dan batas download
- **⚡ Aturan Automasi** — Pindahkan atau hapus file otomatis berdasarkan pola nama atau ekstensi
- **🔄 Sinkronisasi Real-Time** — Sinkronisasi otomatis via Google Drive Changes API (cron setiap 30 menit)
- **🌙 Mode Gelap** — UI tema gelap modern dengan desain responsif

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| **Backend** | [Hono](https://hono.dev/) di [Cloudflare Workers](https://workers.cloudflare.com/) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| **Session Store** | [Cloudflare KV](https://developers.cloudflare.com/kv/) |
| **Frontend** | [React 19](https://react.dev/) + [Vite](https://vite.dev/) |
| **State Management** | [Zustand](https://zustand.docs.pmnd.rs/) |
| **Bahasa** | [TypeScript](https://www.typescriptlang.org/) |
| **Auth** | Google OAuth 2.0 |

## Arsitektur

```
omnidrive/
├── packages/
│   ├── worker/          # Cloudflare Worker (API backend)
│   │   ├── src/
│   │   │   ├── routes/      # Handler rute API
│   │   │   ├── services/    # Logika bisnis (Google Drive, sync, auth)
│   │   │   ├── middleware/  # Auth guard, CORS, error handling
│   │   │   ├── db/          # Skema D1
│   │   │   └── types/       # Tipe TypeScript
│   │   └── tests/           # Unit test Vitest
│   └── web/             # React SPA (frontend)
│       └── src/
│           ├── components/  # Komponen UI
│           ├── pages/       # Halaman rute
│           ├── stores/      # State store Zustand
│           ├── hooks/       # Custom React hooks
│           ├── lib/         # API client, utilitas
│           └── types/       # Tipe TypeScript
├── docs/                # Spesifikasi desain dan rencana implementasi
├── Makefile             # Automasi deployment
└── package.json         # Root monorepo (npm workspaces)
```

Backend dan frontend berkomunikasi via REST API. Saat development, dev server Vite mem-proxy request `/api/*` ke Worker lokal di port 8787.

## Prasyarat

- [Node.js](https://nodejs.org/) 18+ dan npm
- Akun [Cloudflare](https://dash.cloudflare.com/sign-up) (tier gratis cukup)
- [Google Cloud project](https://console.cloud.google.com/) dengan Google Drive API yang sudah diaktifkan
- OAuth 2.0 Client ID (tipe Web application) dari Google Cloud Console

## Memulai

### 1. Clone dan Install

```bash
git clone https://github.com/abilfida/omnidrive.git
cd omnidrive
npm install
```

### 2. Konfigurasi Worker

```bash
# Salin contoh konfigurasi
cp packages/worker/wrangler.example.toml packages/worker/wrangler.toml

# Buat database D1
npx wrangler d1 create omnidrive
# Salin database_id dari output ke wrangler.toml

# Buat KV namespace
npx wrangler kv namespace create KV
# Salin namespace id dari output ke wrangler.toml

# Terapkan skema database
npx wrangler d1 execute omnidrive --local --file=packages/worker/src/db/schema.sql
```

### 3. Siapkan Kredensial Google OAuth

```bash
# Salin template secrets
cp packages/worker/.dev.vars.example packages/worker/.dev.vars
```

Edit `packages/worker/.dev.vars` dan isi kredensial Google OAuth:

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Buat **OAuth 2.0 Client ID** (tipe Web application)
3. Tambahkan `http://localhost:8787/api/auth/google/callback` sebagai authorized redirect URI
4. Salin Client ID dan Client Secret ke `.dev.vars`

### 4. Konfigurasi Frontend

```bash
cp packages/web/.env.example packages/web/.env
```

Untuk development lokal, biarkan `VITE_API_URL` kosong — dev server Vite otomatis mem-proxy panggilan API.

### 5. Jalankan

```bash
npm run dev
```

Ini menjalankan Worker (port 8787) dan web app (port 5173) secara bersamaan. Buka [http://localhost:5173](http://localhost:5173) di browser.

## Deployment

### Backend (Cloudflare Workers)

```bash
# Set secrets untuk production
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Update FRONTEND_URL dan WORKER_URL di wrangler.toml [vars] ke URL production

# Deploy
make deploy-worker
```

### Frontend (Cloudflare Pages)

```bash
# Set VITE_API_URL di packages/web/.env.production ke URL Worker kamu
make deploy-web
```

Atau gunakan [dashboard Cloudflare Pages](https://dash.cloudflare.com/?to=/:account/pages) untuk deployment otomatis dari repo Git.

## Variabel Environment

### Secrets Worker (set via `wrangler secret put` atau `.dev.vars`)

| Variabel | Deskripsi |
|----------|-----------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |

### Konfigurasi Worker (set di `wrangler.toml` `[vars]`)

| Variabel | Deskripsi | Default |
|----------|-----------|---------|
| `FRONTEND_URL` | Origin frontend untuk CORS dan redirect | `http://localhost:5173` |
| `WORKER_URL` | URL Worker untuk OAuth callback | `http://localhost:8787` |

### Binding Worker (set di `wrangler.toml`)

| Binding | Tipe | Deskripsi |
|---------|------|-----------|
| `DB` | D1 Database | Database SQLite untuk semua data aplikasi |
| `KV` | KV Namespace | Penyimpanan sesi dan cache token OAuth |

### Environment Web (set di `.env` atau `.env.production`)

| Variabel | Deskripsi | Default |
|----------|-----------|---------|
| `VITE_API_URL` | URL base API Worker (kosongkan untuk dev lokal) | `""` |

## Lisensi

[MIT](LICENSE) © 2026 abilfida
````

- [ ] **Step 2: Commit**

```bash
git add README.id.md
git commit -m "docs: add README.id.md (Indonesian translation)"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Verify no sensitive data is tracked**

```bash
git ls-files | grep -E '\.(env|vars)' | grep -v example
git ls-files | grep wrangler.toml
```

Expected: No output for both commands (all sensitive files are untracked).

- [ ] **Step 2: Verify all new files are committed**

```bash
git status
```

Expected: Clean working tree. `packages/web/.env.production` and `packages/worker/wrangler.toml` should not appear (they are gitignored).

- [ ] **Step 3: Verify project structure looks clean**

```bash
ls -la *.js *.ts 2>&1
```

Expected: `No such file or directory` — all root-level temp scripts are gone.

- [ ] **Step 4: Review the git log for this session**

```bash
git log --oneline -12
```

Expected: 10 clean commits covering all changes (temp file removal, 2 bug fixes, config templates, gitignore, LICENSE, CHANGELOG, package.json, README.md, README.id.md).
