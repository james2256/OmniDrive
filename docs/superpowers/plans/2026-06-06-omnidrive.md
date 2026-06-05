# Omnidrive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-Google-Drive virtual storage gateway deployed entirely on Cloudflare Free Tier — aggregating quota, organizing files with virtual folders, and routing uploads to the Drive with the most free space.

**Architecture:** Monorepo with two packages: a Hono-based Cloudflare Worker (API + cron sync) and a React + Vite SPA on Cloudflare Pages. D1 stores all persistent metadata, KV caches sessions/tokens/quota. Files upload directly from browser to Google Drive via resumable URLs orchestrated by the Worker.

**Tech Stack:** TypeScript 5, Hono 4, Cloudflare Workers/D1/KV, React 19, Vite 6, Zustand 5, React Router 7, Vitest, Google Drive API v3

**Spec:** `docs/superpowers/specs/2026-06-06-omnidrive-design.md`

---

## File Structure

### Root

| File | Responsibility |
|---|---|
| `package.json` | npm workspaces config (packages/worker, packages/web) |
| `tsconfig.base.json` | Shared TypeScript compiler options |
| `.gitignore` | Git ignore rules |

### packages/worker (Cloudflare Worker Backend)

| File | Responsibility |
|---|---|
| `src/index.ts` | Hono app entry — mounts all routes, exports fetch + scheduled |
| `src/types/env.ts` | Cloudflare bindings (D1, KV, env vars) |
| `src/types/index.ts` | Shared domain types (User, DriveAccount, File, etc.) |
| `src/middleware/cors.ts` | CORS headers for cross-origin requests from Pages |
| `src/middleware/error-handler.ts` | Global error catcher, consistent JSON error responses |
| `src/middleware/auth-guard.ts` | Session validation from KV, injects userId into context |
| `src/services/google-auth.ts` | OAuth URL generation, PKCE, token exchange, userinfo |
| `src/services/google-drive.ts` | Drive API wrapper: token refresh, quota, folder CRUD, file ops |
| `src/services/upload-router.ts` | Drive selection algorithm for uploads |
| `src/services/sync.ts` | Incremental sync via Google Drive Changes API |
| `src/routes/auth.ts` | Login, callback, logout, me endpoints |
| `src/routes/drives.ts` | List drives, connect, disconnect, service account, manual sync |
| `src/routes/folders.ts` | Virtual folder CRUD, contents listing, breadcrumb |
| `src/routes/files.ts` | File list/search/rename/delete/move, upload initiate/confirm |
| `src/db/schema.sql` | D1 table definitions + indexes |
| `src/lib/id.ts` | ID generation utility |
| `wrangler.toml` | Worker config: D1 binding, KV binding, cron trigger, vars |
| `package.json` | Worker dependencies |
| `tsconfig.json` | Worker TypeScript config |
| `vitest.config.ts` | Vitest config for unit tests |
| `tests/upload-router.test.ts` | Unit tests for upload routing algorithm |
| `tests/breadcrumb.test.ts` | Unit tests for breadcrumb builder |

### packages/web (React Frontend)

| File | Responsibility |
|---|---|
| `src/main.tsx` | React DOM entry point |
| `src/App.tsx` | Root component with React Router |
| `src/index.css` | Design system: CSS custom properties, dark theme, components |
| `src/types/index.ts` | Frontend domain types mirroring API responses |
| `src/lib/api.ts` | Fetch wrapper for all API calls |
| `src/lib/utils.ts` | Formatters (file size, date, mime type icon) |
| `src/stores/authStore.ts` | Zustand store: user session state |
| `src/stores/driveStore.ts` | Zustand store: connected drives + quota |
| `src/stores/fileStore.ts` | Zustand store: folder contents, breadcrumb, CRUD |
| `src/stores/uploadStore.ts` | Zustand store: upload queue + progress |
| `src/components/Layout.tsx` | Shell: sidebar + main content area |
| `src/components/Sidebar.tsx` | Navigation links, drive list, add drive button |
| `src/components/AuthGuard.tsx` | Redirect to /login if unauthenticated |
| `src/components/QuotaBar.tsx` | Visual storage bar (single drive or aggregate) |
| `src/components/FileCard.tsx` | File display in grid/list mode |
| `src/components/FolderCard.tsx` | Folder display in grid/list mode |
| `src/components/Breadcrumb.tsx` | Folder navigation breadcrumb |
| `src/components/UploadModal.tsx` | Upload dialog: file list, drive picker, folder picker |
| `src/components/DropZone.tsx` | Drag & drop overlay for file uploads |
| `src/components/FilePreviewModal.tsx` | Google Drive embed preview |
| `src/components/DriveAccountCard.tsx` | Drive info card for settings page |
| `src/components/Toast.tsx` | Toast notification container + provider |
| `src/pages/LoginPage.tsx` | Google OAuth login button |
| `src/pages/DashboardPage.tsx` | Aggregate quota, per-drive bars, recent files |
| `src/pages/FilesPage.tsx` | Virtual folder browser: folders, files, toolbar |
| `src/pages/SettingsPage.tsx` | Drive management: list, add, remove, sync |
| `index.html` | HTML entry point |
| `vite.config.ts` | Vite config with API proxy for dev |
| `package.json` | Frontend dependencies |
| `tsconfig.json` | Frontend TypeScript config |

---

## Phase 1: Project Foundation

### Task 1: Root Monorepo Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json with npm workspaces**

```json
{
  "name": "omnidrive",
  "private": true,
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

- [ ] **Step 2: Create shared tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.dev.vars
.wrangler/
.mf/
*.local
```

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.base.json .gitignore
git commit -m "chore: initialize monorepo with npm workspaces"
```

---

### Task 2: Worker Package Scaffold

**Files:**
- Create: `packages/worker/package.json`
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/wrangler.toml`
- Create: `packages/worker/src/index.ts`
- Create: `packages/worker/src/types/env.ts`
- Create: `packages/worker/vitest.config.ts`

- [ ] **Step 1: Create packages/worker/package.json**

```json
{
  "name": "@omnidrive/worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run --outdir=dist",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate:local": "wrangler d1 execute omnidrive-db --local --file=src/db/schema.sql",
    "db:migrate:remote": "wrangler d1 execute omnidrive-db --remote --file=src/db/schema.sql"
  },
  "dependencies": {
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250530.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.14.0"
  }
}
```

- [ ] **Step 2: Create packages/worker/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create packages/worker/src/types/env.ts**

```typescript
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FRONTEND_URL: string;
  WORKER_URL: string;
}

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    userId: string;
    session: SessionData;
  };
};
```

- [ ] **Step 4: Create packages/worker/src/index.ts — minimal Hono app**

```typescript
import { Hono } from 'hono';
import type { AppContext } from './types/env';

const app = new Hono<AppContext>();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Sync handler — implemented in Task 17
    console.log('Cron triggered:', event.cron);
  },
} satisfies ExportedHandler<Env>;

// Re-export for Hono's type inference
import type { Env } from './types/env';
```

- [ ] **Step 5: Create packages/worker/wrangler.toml**

```toml
name = "omnidrive-api"
main = "src/index.ts"
compatibility_date = "2025-06-01"

[triggers]
crons = ["*/30 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "omnidrive-db"
database_id = "local"

[[kv_namespaces]]
binding = "KV"
id = "local"

[vars]
FRONTEND_URL = "http://localhost:5173"
WORKER_URL = "http://localhost:8787"
```

- [ ] **Step 6: Create packages/worker/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
  },
});
```

- [ ] **Step 7: Create packages/worker/.dev.vars for local secrets**

```
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

- [ ] **Step 8: Install dependencies and verify worker starts**

Run: `cd /home/bilfid/projects/omnidrive && npm install`
Run: `cd /home/bilfid/projects/omnidrive && npm run dev:worker`

Expected: Wrangler starts, `GET http://localhost:8787/api/health` returns `{"status":"ok",...}`

- [ ] **Step 9: Commit**

```bash
git add packages/worker/
git commit -m "feat: scaffold worker package with Hono + wrangler"
```

---

### Task 3: Web Package Scaffold

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/vite-env.d.ts`

- [ ] **Step 1: Create packages/web/package.json**

```json
{
  "name": "@omnidrive/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.511.0",
    "react-dropzone": "^14.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "vite": "^6.3.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create packages/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 3: Create packages/web/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Create packages/web/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔷</text></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Omnidrive — Unified multi-Google-Drive storage gateway" />
    <title>Omnidrive</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create packages/web/src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 6: Create packages/web/src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Create packages/web/src/App.tsx — placeholder**

```tsx
export function App() {
  return (
    <div style={{ color: 'white', padding: '2rem' }}>
      <h1>🔷 Omnidrive</h1>
      <p>Loading...</p>
    </div>
  );
}
```

- [ ] **Step 8: Create packages/web/src/index.css — minimal reset**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0a0a0f;
  color: #e4e4e7;
  min-height: 100vh;
}
```

- [ ] **Step 9: Install and verify frontend starts**

Run: `cd /home/bilfid/projects/omnidrive && npm install`
Run: `cd /home/bilfid/projects/omnidrive && npm run dev:web`

Expected: Vite starts at `http://localhost:5173`, shows "🔷 Omnidrive" heading.

- [ ] **Step 10: Commit**

```bash
git add packages/web/
git commit -m "feat: scaffold web package with React + Vite"
```

---

## Phase 2: Database & Types

### Task 4: D1 Schema + Shared Types

**Files:**
- Create: `packages/worker/src/db/schema.sql`
- Create: `packages/worker/src/types/index.ts`
- Create: `packages/worker/src/lib/id.ts`

- [ ] **Step 1: Create packages/worker/src/db/schema.sql**

```sql
-- Users (from Google OAuth login)
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    google_id       TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    avatar_url      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Connected Google Drive accounts
CREATE TABLE IF NOT EXISTS drive_accounts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_account_id TEXT NOT NULL,
    email           TEXT NOT NULL,
    name            TEXT,
    type            TEXT NOT NULL DEFAULT 'oauth',
    is_primary      INTEGER NOT NULL DEFAULT 0,
    root_folder_id  TEXT,
    total_quota     INTEGER DEFAULT 0,
    used_quota      INTEGER DEFAULT 0,
    quota_updated_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, google_account_id)
);

-- Virtual folder structure (Omnidrive-only, not in Google Drive)
CREATE TABLE IF NOT EXISTS virtual_folders (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    parent_id       TEXT REFERENCES virtual_folders(id) ON DELETE CASCADE,
    icon            TEXT DEFAULT '📁',
    color           TEXT DEFAULT '#4A90D9',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, parent_id, name)
);

-- File metadata synced from Google Drive
CREATE TABLE IF NOT EXISTS files (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    google_file_id  TEXT NOT NULL,
    virtual_folder_id TEXT REFERENCES virtual_folders(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    mime_type       TEXT,
    size            INTEGER DEFAULT 0,
    thumbnail_url   TEXT,
    web_view_link   TEXT,
    web_content_link TEXT,
    is_trashed      INTEGER NOT NULL DEFAULT 0,
    google_created_at  TEXT,
    google_modified_at TEXT,
    synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(drive_account_id, google_file_id)
);

-- Sync state tracking per drive account
CREATE TABLE IF NOT EXISTS sync_state (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    change_token     TEXT,
    last_synced_at   TEXT,
    status           TEXT DEFAULT 'idle',
    error_message    TEXT
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_files_user_folder ON files(user_id, virtual_folder_id);
CREATE INDEX IF NOT EXISTS idx_files_drive ON files(drive_account_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(user_id, name);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON virtual_folders(user_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_drives_user ON drive_accounts(user_id);
```

- [ ] **Step 2: Create packages/worker/src/lib/id.ts**

```typescript
export function generateId(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 3: Create packages/worker/src/types/index.ts**

```typescript
// ─── Domain Types ───

export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriveAccount {
  id: string;
  userId: string;
  googleAccountId: string;
  email: string;
  name: string | null;
  type: 'oauth' | 'service_account';
  isPrimary: boolean;
  rootFolderId: string | null;
  totalQuota: number;
  usedQuota: number;
  quotaUpdatedAt: string | null;
  createdAt: string;
}

export interface VirtualFolder {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  icon: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  id: string;
  userId: string;
  driveAccountId: string;
  googleFileId: string;
  virtualFolderId: string | null;
  name: string;
  mimeType: string | null;
  size: number;
  thumbnailUrl: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  isTrashed: boolean;
  googleCreatedAt: string | null;
  googleModifiedAt: string | null;
  syncedAt: string;
  createdAt: string;
}

export interface SyncState {
  driveAccountId: string;
  changeToken: string | null;
  lastSyncedAt: string | null;
  status: 'idle' | 'syncing' | 'error';
  errorMessage: string | null;
}

// ─── KV Types ───

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix timestamp ms
}

export interface QuotaCache {
  total: number;
  used: number;
  updatedAt: string;
}

// ─── API Response Types ───

export interface DriveWithQuota extends DriveAccount {
  freeSpace: number;
  usagePercent: number;
}

export interface AggregateQuota {
  totalQuota: number;
  totalUsed: number;
  totalFree: number;
  driveCount: number;
}

export interface FolderContents {
  folder: VirtualFolder | null;
  subfolders: VirtualFolder[];
  files: (FileEntry & { driveEmail: string })[];
  breadcrumb: BreadcrumbItem[];
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface UploadInitResponse {
  uploadUrl: string;
  driveAccountId: string;
  googleFolderId: string;
}

// ─── Row Mappers ───

export function mapUserRow(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    googleId: row.google_id as string,
    email: row.email as string,
    name: row.name as string,
    avatarUrl: (row.avatar_url as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapDriveRow(row: Record<string, unknown>): DriveAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    googleAccountId: row.google_account_id as string,
    email: row.email as string,
    name: (row.name as string) ?? null,
    type: row.type as 'oauth' | 'service_account',
    isPrimary: row.is_primary === 1,
    rootFolderId: (row.root_folder_id as string) ?? null,
    totalQuota: (row.total_quota as number) ?? 0,
    usedQuota: (row.used_quota as number) ?? 0,
    quotaUpdatedAt: (row.quota_updated_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapFolderRow(row: Record<string, unknown>): VirtualFolder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    parentId: (row.parent_id as string) ?? null,
    icon: (row.icon as string) ?? '📁',
    color: (row.color as string) ?? '#4A90D9',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapFileRow(row: Record<string, unknown>): FileEntry {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    driveAccountId: row.drive_account_id as string,
    googleFileId: row.google_file_id as string,
    virtualFolderId: (row.virtual_folder_id as string) ?? null,
    name: row.name as string,
    mimeType: (row.mime_type as string) ?? null,
    size: (row.size as number) ?? 0,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    webViewLink: (row.web_view_link as string) ?? null,
    webContentLink: (row.web_content_link as string) ?? null,
    isTrashed: row.is_trashed === 1,
    googleCreatedAt: (row.google_created_at as string) ?? null,
    googleModifiedAt: (row.google_modified_at as string) ?? null,
    syncedAt: row.synced_at as string,
    createdAt: row.created_at as string,
  };
}
```

- [ ] **Step 4: Apply schema to local D1**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx wrangler d1 execute omnidrive-db --local --file=src/db/schema.sql`

Expected: "Executed N queries" without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/db/schema.sql packages/worker/src/types/index.ts packages/worker/src/lib/id.ts
git commit -m "feat: add D1 schema, domain types, and row mappers"
```

---

## Phase 3: Worker Infrastructure

### Task 5: Middleware Stack

**Files:**
- Create: `packages/worker/src/middleware/cors.ts`
- Create: `packages/worker/src/middleware/error-handler.ts`
- Create: `packages/worker/src/middleware/auth-guard.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Create packages/worker/src/middleware/cors.ts**

```typescript
import { cors } from 'hono/cors';
import type { Env } from '../types/env';

export function corsMiddleware() {
  return cors({
    origin: (origin, c) => {
      const env = c.env as Env;
      const allowed = [env.FRONTEND_URL];
      if (allowed.includes(origin)) {
        return origin;
      }
      // Allow localhost in development
      if (origin?.startsWith('http://localhost')) {
        return origin;
      }
      return '';
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
    maxAge: 86400,
  });
}
```

- [ ] **Step 2: Create packages/worker/src/middleware/error-handler.ts**

```typescript
import type { Context, Next } from 'hono';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    console.error('Unhandled error:', err);

    const status = err instanceof AppError ? err.status : 500;
    const message = err instanceof AppError ? err.message : 'Internal server error';

    return c.json({ error: message }, status as 400);
  }
}

export class AppError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 3: Create packages/worker/src/middleware/auth-guard.ts**

```typescript
import { createMiddleware } from 'hono/factory';
import type { AppContext, SessionData } from '../types/env';
import { AppError } from './error-handler';

export const authGuard = createMiddleware<AppContext>(async (c, next) => {
  const cookie = getCookie(c, 'omnidrive_sid');
  if (!cookie) {
    throw new AppError(401, 'Not authenticated');
  }

  const sessionJson = await c.env.KV.get(`session:${cookie}`);
  if (!sessionJson) {
    throw new AppError(401, 'Session expired');
  }

  const session: SessionData = JSON.parse(sessionJson);
  c.set('userId', session.userId);
  c.set('session', session);

  // Sliding window: extend session TTL on each valid request
  await c.env.KV.put(`session:${cookie}`, sessionJson, {
    expirationTtl: 60 * 60 * 24 * 7, // 7 days
  });

  await next();
});

function getCookie(c: { req: { header: (name: string) => string | undefined } }, name: string): string | undefined {
  const cookieHeader = c.req.header('cookie');
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Update packages/worker/src/index.ts to use middleware**

```typescript
import { Hono } from 'hono';
import type { AppContext, Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';

const app = new Hono<AppContext>();

// Global middleware
app.use('*', corsMiddleware());
app.use('*', errorHandler);

// Health check (public)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('Cron triggered:', event.cron);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Verify middleware works**

Run: `cd /home/bilfid/projects/omnidrive && npm run dev:worker`

Test CORS: `curl -v -H "Origin: http://localhost:5173" http://localhost:8787/api/health`
Expected: Response includes `Access-Control-Allow-Origin: http://localhost:5173`

Test 401: `curl http://localhost:8787/api/auth/me`
Expected: 404 (route doesn't exist yet, but middleware is loaded)

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/middleware/ packages/worker/src/index.ts
git commit -m "feat: add CORS, error handler, and auth guard middleware"
```

---

## Phase 4: Authentication

### Task 6: Google OAuth Service

**Files:**
- Create: `packages/worker/src/services/google-auth.ts`

- [ ] **Step 1: Create packages/worker/src/services/google-auth.ts**

```typescript
import type { Env } from '../types/env';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive',
].join(' ');

interface PkceState {
  codeVerifier: string;
  mode: 'login' | 'connect';
  userId?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface UserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export async function generateAuthUrl(
  env: Env,
  kv: KVNamespace,
  mode: 'login' | 'connect',
  userId?: string
): Promise<string> {
  // Generate PKCE code verifier and challenge
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await computeCodeChallenge(codeVerifier);

  // Generate state parameter
  const state = generateRandomString(32);

  // Store PKCE state in KV (10-min TTL)
  const pkceState: PkceState = { codeVerifier, mode, userId };
  await kv.put(`pkce:${state}`, JSON.stringify(pkceState), {
    expirationTtl: 600,
  });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.WORKER_URL}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  env: Env,
  kv: KVNamespace,
  code: string,
  state: string
): Promise<{ tokens: TokenResponse; pkceState: PkceState }> {
  // Retrieve PKCE state
  const pkceJson = await kv.get(`pkce:${state}`);
  if (!pkceJson) {
    throw new Error('Invalid or expired OAuth state');
  }
  const pkceState: PkceState = JSON.parse(pkceJson);

  // Delete used state
  await kv.delete(`pkce:${state}`);

  // Exchange code for tokens
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: `${env.WORKER_URL}/api/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: pkceState.codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokens: TokenResponse = await response.json();
  return { tokens, pkceState };
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  return response.json();
}

// ─── Helpers ───

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/worker/src/services/google-auth.ts
git commit -m "feat: add Google OAuth service with PKCE support"
```

---

### Task 7: Auth Routes

**Files:**
- Create: `packages/worker/src/routes/auth.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Create packages/worker/src/routes/auth.ts**

```typescript
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { generateAuthUrl, exchangeCodeForTokens, fetchUserInfo } from '../services/google-auth';
import { generateId } from '../lib/id';
import { mapUserRow } from '../types/index';

const auth = new Hono<AppContext>();

// GET /api/auth/login — redirect to Google OAuth
auth.get('/login', async (c) => {
  const url = await generateAuthUrl(c.env, c.env.KV, 'login');
  return c.redirect(url);
});

// GET /api/auth/callback — handle OAuth callback
auth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=${error}`);
  }

  if (!code || !state) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=missing_params`);
  }

  try {
    // Exchange code for tokens
    const { tokens, pkceState } = await exchangeCodeForTokens(c.env, c.env.KV, code, state);

    // Fetch user info from Google
    const userInfo = await fetchUserInfo(tokens.access_token);

    if (pkceState.mode === 'connect' && pkceState.userId) {
      // ─── Connect mode: add new drive to existing user ───
      return await handleConnect(c, pkceState.userId, userInfo, tokens);
    }

    // ─── Login mode: create/update user + primary drive ───
    return await handleLogin(c, userInfo, tokens);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

// POST /api/auth/logout — clear session
auth.post('/logout', async (c) => {
  const cookie = getCookieValue(c.req.header('cookie'), 'omnidrive_sid');
  if (cookie) {
    await c.env.KV.delete(`session:${cookie}`);
  }

  return c.json({ success: true }, 200, {
    'Set-Cookie': 'omnidrive_sid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
  });
});

// GET /api/auth/me — get current user
auth.get('/me', authGuard, async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

  if (!row) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ user: mapUserRow(row) });
});

// ─── Internal Handlers ───

async function handleLogin(c: any, userInfo: any, tokens: any) {
  const db = c.env.DB;
  const kv = c.env.KV;

  // Upsert user
  let userRow = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(userInfo.sub).first();

  let userId: string;
  if (userRow) {
    userId = userRow.id as string;
    await db
      .prepare('UPDATE users SET name = ?, avatar_url = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(userInfo.name, userInfo.picture ?? null, userId)
      .run();
  } else {
    userId = generateId();
    await db
      .prepare('INSERT INTO users (id, google_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, userInfo.sub, userInfo.email, userInfo.name, userInfo.picture ?? null)
      .run();
  }

  // Upsert drive account
  let driveRow = await db
    .prepare('SELECT * FROM drive_accounts WHERE user_id = ? AND google_account_id = ?')
    .bind(userId, userInfo.sub)
    .first();

  let driveId: string;
  if (driveRow) {
    driveId = driveRow.id as string;
  } else {
    driveId = generateId();
    await db
      .prepare(
        'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(driveId, userId, userInfo.sub, userInfo.email, userInfo.name, 'oauth', 1)
      .run();

    // Initialize sync state
    await db.prepare('INSERT INTO sync_state (drive_account_id, status) VALUES (?, ?)').bind(driveId, 'idle').run();
  }

  // Store OAuth tokens in KV
  await kv.put(
    `oauth:${driveId}`,
    JSON.stringify({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      expiresAt: Date.now() + tokens.expires_in * 1000,
    })
  );

  // Create "Omnidrive" folder in Google Drive if not exists
  if (!driveRow?.root_folder_id) {
    try {
      const folderId = await createOmnidriveFolderInDrive(tokens.access_token);
      await db.prepare('UPDATE drive_accounts SET root_folder_id = ? WHERE id = ?').bind(folderId, driveId).run();
    } catch (err) {
      console.error('Failed to create Omnidrive folder:', err);
    }
  }

  // Create session
  const sessionId = generateId();
  await kv.put(
    `session:${sessionId}`,
    JSON.stringify({
      userId,
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.picture ?? null,
    }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  );

  // Set cookie and redirect
  const cookie = `omnidrive_sid=${sessionId}; Path=/; Max-Age=${60 * 60 * 24 * 7}; HttpOnly; Secure; SameSite=Lax`;
  return c.redirect(`${c.env.FRONTEND_URL}/`, 302, { 'Set-Cookie': cookie });
}

async function handleConnect(c: any, userId: string, userInfo: any, tokens: any) {
  const db = c.env.DB;
  const kv = c.env.KV;

  // Check if this Google account is already connected
  const existing = await db
    .prepare('SELECT * FROM drive_accounts WHERE user_id = ? AND google_account_id = ?')
    .bind(userId, userInfo.sub)
    .first();

  if (existing) {
    // Update tokens for existing connection
    await kv.put(
      `oauth:${existing.id}`,
      JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? '',
        expiresAt: Date.now() + tokens.expires_in * 1000,
      })
    );
    return c.redirect(`${c.env.FRONTEND_URL}/settings/drives`);
  }

  // Create new drive account
  const driveId = generateId();
  await db
    .prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(driveId, userId, userInfo.sub, userInfo.email, userInfo.name, 'oauth', 0)
    .run();

  // Initialize sync state
  await db.prepare('INSERT INTO sync_state (drive_account_id, status) VALUES (?, ?)').bind(driveId, 'idle').run();

  // Store tokens
  await kv.put(
    `oauth:${driveId}`,
    JSON.stringify({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      expiresAt: Date.now() + tokens.expires_in * 1000,
    })
  );

  // Create Omnidrive folder
  try {
    const folderId = await createOmnidriveFolderInDrive(tokens.access_token);
    await db.prepare('UPDATE drive_accounts SET root_folder_id = ? WHERE id = ?').bind(folderId, driveId).run();
  } catch (err) {
    console.error('Failed to create Omnidrive folder:', err);
  }

  return c.redirect(`${c.env.FRONTEND_URL}/settings/drives`);
}

async function createOmnidriveFolderInDrive(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Omnidrive',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create folder: ${await response.text()}`);
  }

  const folder: { id: string } = await response.json();
  return folder.id;
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split('=');
    if (key === name) return valueParts.join('=');
  }
  return undefined;
}

export { auth };
```

- [ ] **Step 2: Mount auth routes in packages/worker/src/index.ts**

Replace the entire file content with:

```typescript
import { Hono } from 'hono';
import type { AppContext, Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { auth } from './routes/auth';

const app = new Hono<AppContext>();

// Global middleware
app.use('*', corsMiddleware());
app.use('*', errorHandler);

// Health check (public)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.route('/api/auth', auth);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('Cron triggered:', event.cron);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 3: Verify compilation**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/routes/auth.ts packages/worker/src/index.ts
git commit -m "feat: add auth routes — login, callback, logout, me"
```

---

## Phase 5: Google Drive Integration

### Task 8: Google Drive API Service

**Files:**
- Create: `packages/worker/src/services/google-drive.ts`

- [ ] **Step 1: Create packages/worker/src/services/google-drive.ts**

```typescript
import type { OAuthTokens, QuotaCache } from '../types/index';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleDriveService {
  constructor(
    private kv: KVNamespace,
    private clientId: string,
    private clientSecret: string
  ) {}

  // ─── Token Management ───

  async getValidToken(driveAccountId: string): Promise<string> {
    const tokensJson = await this.kv.get(`oauth:${driveAccountId}`);
    if (!tokensJson) {
      throw new Error(`No tokens found for drive ${driveAccountId}`);
    }

    const tokens: OAuthTokens = JSON.parse(tokensJson);

    // Return cached token if not expired (with 60s buffer)
    if (tokens.expiresAt > Date.now() + 60_000) {
      return tokens.accessToken;
    }

    // Refresh the token
    return this.refreshToken(driveAccountId, tokens.refreshToken);
  }

  private async refreshToken(driveAccountId: string, refreshToken: string): Promise<string> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed for ${driveAccountId}: ${error}`);
    }

    const data: { access_token: string; expires_in: number } = await response.json();

    // Update KV with new access token (keep existing refresh token)
    await this.kv.put(
      `oauth:${driveAccountId}`,
      JSON.stringify({
        accessToken: data.access_token,
        refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
      } satisfies OAuthTokens)
    );

    return data.access_token;
  }

  // ─── Quota ───

  async getQuota(
    driveAccountId: string
  ): Promise<{ total: number; used: number }> {
    // Check KV cache first
    const cached = await this.kv.get(`quota:${driveAccountId}`);
    if (cached) {
      const quota: QuotaCache = JSON.parse(cached);
      return { total: quota.total, used: quota.used };
    }

    // Fetch from Google Drive API
    const token = await this.getValidToken(driveAccountId);
    const response = await fetch(`${DRIVE_API}/about?fields=storageQuota`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch quota: ${await response.text()}`);
    }

    const data: {
      storageQuota: { limit?: string; usage?: string };
    } = await response.json();

    const total = parseInt(data.storageQuota.limit ?? '0', 10);
    const used = parseInt(data.storageQuota.usage ?? '0', 10);

    // Cache in KV (5-min TTL)
    await this.kv.put(
      `quota:${driveAccountId}`,
      JSON.stringify({ total, used, updatedAt: new Date().toISOString() } satisfies QuotaCache),
      { expirationTtl: 300 }
    );

    return { total, used };
  }

  // ─── Folder Operations ───

  async createFolder(
    driveAccountId: string,
    name: string,
    parentId?: string
  ): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const response = await fetch(`${DRIVE_API}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      throw new Error(`Failed to create folder: ${await response.text()}`);
    }

    const folder: { id: string } = await response.json();
    return folder.id;
  }

  // ─── Upload ───

  async initiateResumableUpload(
    driveAccountId: string,
    fileName: string,
    mimeType: string,
    parentFolderId: string
  ): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
        },
        body: JSON.stringify({
          name: fileName,
          parents: [parentFolderId],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to initiate upload: ${await response.text()}`);
    }

    const uploadUrl = response.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('No upload URL in response');
    }

    return uploadUrl;
  }

  // ─── File Operations ───

  async getFile(
    driveAccountId: string,
    googleFileId: string
  ): Promise<{
    id: string;
    name: string;
    mimeType: string;
    size: string;
    thumbnailLink?: string;
    webViewLink?: string;
    webContentLink?: string;
    createdTime: string;
    modifiedTime: string;
  }> {
    const token = await this.getValidToken(driveAccountId);
    const fields = 'id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime';

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get file: ${await response.text()}`);
    }

    return response.json();
  }

  async deleteFile(driveAccountId: string, googleFileId: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete file: ${await response.text()}`);
    }
  }

  async renameFile(driveAccountId: string, googleFileId: string, newName: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to rename file: ${await response.text()}`);
    }
  }

  // ─── Changes API (for sync) ───

  async getStartPageToken(driveAccountId: string): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/changes/startPageToken`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get start page token: ${await response.text()}`);
    }

    const data: { startPageToken: string } = await response.json();
    return data.startPageToken;
  }

  async listChanges(
    driveAccountId: string,
    pageToken: string
  ): Promise<{
    changes: Array<{
      fileId: string;
      removed: boolean;
      file?: {
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        parents?: string[];
        trashed: boolean;
        thumbnailLink?: string;
        webViewLink?: string;
        webContentLink?: string;
        createdTime: string;
        modifiedTime: string;
      };
    }>;
    nextPageToken?: string;
    newStartPageToken?: string;
  }> {
    const token = await this.getValidToken(driveAccountId);
    const fields =
      'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,parents,trashed,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime))';

    const response = await fetch(
      `${DRIVE_API}/changes?pageToken=${pageToken}&fields=${fields}&spaces=drive&includeRemoved=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      throw new Error(`Failed to list changes: ${await response.text()}`);
    }

    return response.json();
  }

  async listFilesInFolder(
    driveAccountId: string,
    folderId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      thumbnailLink?: string;
      webViewLink?: string;
      webContentLink?: string;
      createdTime: string;
      modifiedTime: string;
    }>
  > {
    const token = await this.getValidToken(driveAccountId);
    const fields = 'files(id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime)';
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);

    const allFiles: Array<any> = [];
    let pageToken: string | undefined;

    do {
      const url = `${DRIVE_API}/files?q=${q}&fields=nextPageToken,${fields}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to list files: ${await response.text()}`);
      }

      const data: { files: any[]; nextPageToken?: string } = await response.json();
      allFiles.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/worker/src/services/google-drive.ts
git commit -m "feat: add Google Drive API service — tokens, quota, uploads, files, changes"
```

---

### Task 9: Upload Routing Service + Tests

**Files:**
- Create: `packages/worker/src/services/upload-router.ts`
- Create: `packages/worker/tests/upload-router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/worker/tests/upload-router.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectDriveAccount } from '../src/services/upload-router';

const makeDrive = (id: string, total: number, used: number) => ({
  id,
  totalQuota: total,
  usedQuota: used,
});

describe('selectDriveAccount', () => {
  const drives = [
    makeDrive('drive-a', 15_000_000_000, 10_000_000_000), // 5GB free
    makeDrive('drive-b', 15_000_000_000, 3_000_000_000),  // 12GB free
    makeDrive('drive-c', 15_000_000_000, 14_000_000_000), // 1GB free
  ];

  it('selects drive with most free space when no preference', () => {
    const result = selectDriveAccount(drives, 1_000_000_000); // 1GB file
    expect(result.id).toBe('drive-b'); // 12GB free
  });

  it('selects preferred drive when specified and has space', () => {
    const result = selectDriveAccount(drives, 1_000_000_000, 'drive-a');
    expect(result.id).toBe('drive-a');
  });

  it('throws when preferred drive does not have enough space', () => {
    expect(() => selectDriveAccount(drives, 6_000_000_000, 'drive-c')).toThrow(
      'Not enough space in selected drive'
    );
  });

  it('throws when preferred drive is not found', () => {
    expect(() => selectDriveAccount(drives, 1_000_000_000, 'drive-z')).toThrow(
      'Drive account not found'
    );
  });

  it('throws when no drive has enough space', () => {
    expect(() => selectDriveAccount(drives, 20_000_000_000)).toThrow(
      'No drive has enough free space'
    );
  });

  it('skips drives with zero free space', () => {
    const fullDrives = [makeDrive('full', 15_000_000_000, 15_000_000_000)];
    expect(() => selectDriveAccount(fullDrives, 1)).toThrow('No drive has enough free space');
  });

  it('handles single drive with enough space', () => {
    const single = [makeDrive('only', 15_000_000_000, 0)];
    const result = selectDriveAccount(single, 1_000_000_000);
    expect(result.id).toBe('only');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run tests/upload-router.test.ts`

Expected: FAIL — `Cannot find module '../src/services/upload-router'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/worker/src/services/upload-router.ts`:

```typescript
interface DriveForRouting {
  id: string;
  totalQuota: number;
  usedQuota: number;
}

export function selectDriveAccount(
  drives: DriveForRouting[],
  fileSize: number,
  preferredId?: string
): DriveForRouting {
  // User specified a preferred drive
  if (preferredId) {
    const preferred = drives.find((d) => d.id === preferredId);
    if (!preferred) {
      throw new Error('Drive account not found');
    }
    const freeSpace = preferred.totalQuota - preferred.usedQuota;
    if (freeSpace < fileSize) {
      throw new Error('Not enough space in selected drive');
    }
    return preferred;
  }

  // Auto-select: drive with most free space that can fit the file
  const eligible = drives
    .map((d) => ({ ...d, freeSpace: d.totalQuota - d.usedQuota }))
    .filter((d) => d.freeSpace >= fileSize)
    .sort((a, b) => b.freeSpace - a.freeSpace);

  if (eligible.length === 0) {
    throw new Error('No drive has enough free space');
  }

  return eligible[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run tests/upload-router.test.ts`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/services/upload-router.ts packages/worker/tests/upload-router.test.ts
git commit -m "feat: add upload routing algorithm with tests"
```

---

### Task 10: Drive Management Routes

**Files:**
- Create: `packages/worker/src/routes/drives.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Create packages/worker/src/routes/drives.ts**

```typescript
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { generateAuthUrl } from '../services/google-auth';
import { GoogleDriveService } from '../services/google-drive';
import { mapDriveRow } from '../types/index';
import type { DriveWithQuota, AggregateQuota } from '../types/index';
import { generateId } from '../lib/id';
import { AppError } from '../middleware/error-handler';

const drives = new Hono<AppContext>();

// All drive routes require auth
drives.use('*', authGuard);

// GET /api/drives — list all connected drives with quota
drives.get('/', async (c) => {
  const userId = c.get('userId');
  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);

  const rows = await c.env.DB.prepare('SELECT * FROM drive_accounts WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC')
    .bind(userId)
    .all();

  const driveAccounts = (rows.results ?? []).map(mapDriveRow);

  // Fetch quota for each drive (uses KV cache)
  const drivesWithQuota: DriveWithQuota[] = await Promise.all(
    driveAccounts.map(async (drive) => {
      try {
        const quota = await driveService.getQuota(drive.id);
        // Update D1 with latest quota
        await c.env.DB.prepare('UPDATE drive_accounts SET total_quota = ?, used_quota = ?, quota_updated_at = datetime(\'now\') WHERE id = ?')
          .bind(quota.total, quota.used, drive.id)
          .run();

        const freeSpace = quota.total - quota.used;
        return {
          ...drive,
          totalQuota: quota.total,
          usedQuota: quota.used,
          freeSpace,
          usagePercent: quota.total > 0 ? Math.round((quota.used / quota.total) * 1000) / 10 : 0,
        };
      } catch {
        // Fallback to cached quota from D1
        const freeSpace = drive.totalQuota - drive.usedQuota;
        return {
          ...drive,
          freeSpace,
          usagePercent: drive.totalQuota > 0 ? Math.round((drive.usedQuota / drive.totalQuota) * 1000) / 10 : 0,
        };
      }
    })
  );

  const aggregate: AggregateQuota = {
    totalQuota: drivesWithQuota.reduce((sum, d) => sum + d.totalQuota, 0),
    totalUsed: drivesWithQuota.reduce((sum, d) => sum + d.usedQuota, 0),
    totalFree: drivesWithQuota.reduce((sum, d) => sum + d.freeSpace, 0),
    driveCount: drivesWithQuota.length,
  };

  return c.json({ drives: drivesWithQuota, aggregate });
});

// GET /api/drives/connect — redirect to Google OAuth (connect mode)
drives.get('/connect', async (c) => {
  const userId = c.get('userId');
  const url = await generateAuthUrl(c.env, c.env.KV, 'connect', userId);
  return c.redirect(url);
});

// DELETE /api/drives/:id — disconnect a drive
drives.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const driveId = c.req.param('id');

  const drive = await c.env.DB.prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId)
    .first();

  if (!drive) {
    throw new AppError(404, 'Drive account not found');
  }

  if (drive.is_primary === 1) {
    throw new AppError(400, 'Cannot disconnect primary drive account');
  }

  // Delete from D1 (cascade deletes files and sync_state)
  await c.env.DB.prepare('DELETE FROM drive_accounts WHERE id = ?').bind(driveId).run();

  // Clean up KV
  await c.env.KV.delete(`oauth:${driveId}`);
  await c.env.KV.delete(`quota:${driveId}`);

  return c.json({ success: true });
});

// POST /api/drives/service-account — add service account
drives.post('/service-account', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ credentials: string; folderId: string }>();

  if (!body.credentials || !body.folderId) {
    throw new AppError(400, 'Missing credentials or folderId');
  }

  // Validate JSON structure
  let saCredentials: { client_email?: string; private_key?: string };
  try {
    saCredentials = JSON.parse(body.credentials);
  } catch {
    throw new AppError(400, 'Invalid service account JSON');
  }

  if (!saCredentials.client_email || !saCredentials.private_key) {
    throw new AppError(400, 'Service account JSON missing client_email or private_key');
  }

  // Create drive account record
  const driveId = generateId();
  await c.env.DB.prepare(
    'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary, root_folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(driveId, userId, saCredentials.client_email, saCredentials.client_email, 'Service Account', 'service_account', 0, body.folderId)
    .run();

  // Initialize sync state
  await c.env.DB.prepare('INSERT INTO sync_state (drive_account_id, status) VALUES (?, ?)').bind(driveId, 'idle').run();

  // Store SA credentials in KV
  await c.env.KV.put(`sa:${driveId}`, body.credentials);

  return c.json({ success: true, driveId });
});

// POST /api/drives/:id/sync — trigger manual sync
drives.post('/:id/sync', async (c) => {
  const userId = c.get('userId');
  const driveId = c.req.param('id');

  const drive = await c.env.DB.prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId)
    .first();

  if (!drive) {
    throw new AppError(404, 'Drive account not found');
  }

  // Import sync service (lazy to avoid circular deps)
  const { syncDriveAccount } = await import('../services/sync');
  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);

  await syncDriveAccount(mapDriveRow(drive), c.env.DB, c.env.KV, driveService);

  return c.json({ success: true });
});

export { drives };
```

- [ ] **Step 2: Mount drives routes in packages/worker/src/index.ts**

Add to index.ts after the auth route:

```typescript
import { drives } from './routes/drives';
// ... existing code ...
app.route('/api/drives', drives);
```

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/drives.ts packages/worker/src/index.ts
git commit -m "feat: add drive management routes — list, connect, disconnect, service account, sync"
```

---

## Phase 6: Virtual Folders & Files

### Task 11: Virtual Folder Routes + Breadcrumb

**Files:**
- Create: `packages/worker/src/routes/folders.ts`
- Create: `packages/worker/tests/breadcrumb.test.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Write breadcrumb builder test**

Create `packages/worker/tests/breadcrumb.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildBreadcrumb } from '../src/routes/folders';

describe('buildBreadcrumb', () => {
  const folders = [
    { id: 'a', name: 'Projects', parent_id: null },
    { id: 'b', name: 'Website', parent_id: 'a' },
    { id: 'c', name: 'Assets', parent_id: 'b' },
  ];

  it('returns root-only breadcrumb for null folderId', () => {
    const result = buildBreadcrumb(null, folders);
    expect(result).toEqual([{ id: null, name: 'Root' }]);
  });

  it('builds full breadcrumb path for nested folder', () => {
    const result = buildBreadcrumb('c', folders);
    expect(result).toEqual([
      { id: null, name: 'Root' },
      { id: 'a', name: 'Projects' },
      { id: 'b', name: 'Website' },
      { id: 'c', name: 'Assets' },
    ]);
  });

  it('builds breadcrumb for top-level folder', () => {
    const result = buildBreadcrumb('a', folders);
    expect(result).toEqual([
      { id: null, name: 'Root' },
      { id: 'a', name: 'Projects' },
    ]);
  });

  it('returns root for unknown folder ID', () => {
    const result = buildBreadcrumb('unknown', folders);
    expect(result).toEqual([{ id: null, name: 'Root' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run tests/breadcrumb.test.ts`

Expected: FAIL — `Cannot find module '../src/routes/folders'`

- [ ] **Step 3: Create packages/worker/src/routes/folders.ts**

```typescript
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { mapFolderRow, mapFileRow } from '../types/index';
import type { BreadcrumbItem } from '../types/index';
import { generateId } from '../lib/id';
import { AppError } from '../middleware/error-handler';

const folders = new Hono<AppContext>();

folders.use('*', authGuard);

// GET /api/folders/root/contents — root level contents
folders.get('/root/contents', async (c) => {
  const userId = c.get('userId');

  const [folderRows, fileRows, allFolders] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM virtual_folders WHERE user_id = ? AND parent_id IS NULL ORDER BY name')
      .bind(userId)
      .all(),
    c.env.DB.prepare(
      'SELECT f.*, da.email as drive_email FROM files f JOIN drive_accounts da ON f.drive_account_id = da.id WHERE f.user_id = ? AND f.virtual_folder_id IS NULL AND f.is_trashed = 0 ORDER BY f.name'
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare('SELECT id, name, parent_id FROM virtual_folders WHERE user_id = ?').bind(userId).all(),
  ]);

  return c.json({
    folder: null,
    subfolders: (folderRows.results ?? []).map(mapFolderRow),
    files: (fileRows.results ?? []).map((row) => ({
      ...mapFileRow(row),
      driveEmail: row.drive_email as string,
    })),
    breadcrumb: [{ id: null, name: 'Root' }],
  });
});

// GET /api/folders/:id/contents — folder contents + breadcrumb
folders.get('/:id/contents', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');

  const folder = await c.env.DB.prepare('SELECT * FROM virtual_folders WHERE id = ? AND user_id = ?')
    .bind(folderId, userId)
    .first();

  if (!folder) {
    throw new AppError(404, 'Folder not found');
  }

  const [folderRows, fileRows, allFolders] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM virtual_folders WHERE user_id = ? AND parent_id = ? ORDER BY name')
      .bind(userId, folderId)
      .all(),
    c.env.DB.prepare(
      'SELECT f.*, da.email as drive_email FROM files f JOIN drive_accounts da ON f.drive_account_id = da.id WHERE f.user_id = ? AND f.virtual_folder_id = ? AND f.is_trashed = 0 ORDER BY f.name'
    )
      .bind(userId, folderId)
      .all(),
    c.env.DB.prepare('SELECT id, name, parent_id FROM virtual_folders WHERE user_id = ?').bind(userId).all(),
  ]);

  return c.json({
    folder: mapFolderRow(folder),
    subfolders: (folderRows.results ?? []).map(mapFolderRow),
    files: (fileRows.results ?? []).map((row) => ({
      ...mapFileRow(row),
      driveEmail: row.drive_email as string,
    })),
    breadcrumb: buildBreadcrumb(folderId, allFolders.results ?? []),
  });
});

// POST /api/folders — create folder
folders.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ name: string; parentId?: string; icon?: string; color?: string }>();

  if (!body.name?.trim()) {
    throw new AppError(400, 'Folder name is required');
  }

  // Validate parent exists if specified
  if (body.parentId) {
    const parent = await c.env.DB.prepare('SELECT id FROM virtual_folders WHERE id = ? AND user_id = ?')
      .bind(body.parentId, userId)
      .first();
    if (!parent) {
      throw new AppError(404, 'Parent folder not found');
    }
  }

  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO virtual_folders (id, user_id, name, parent_id, icon, color) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, userId, body.name.trim(), body.parentId ?? null, body.icon ?? '📁', body.color ?? '#4A90D9')
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM virtual_folders WHERE id = ?').bind(id).first();
  return c.json({ folder: mapFolderRow(created!) }, 201);
});

// PATCH /api/folders/:id — rename / move folder
folders.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const body = await c.req.json<{ name?: string; parentId?: string }>();

  const folder = await c.env.DB.prepare('SELECT * FROM virtual_folders WHERE id = ? AND user_id = ?')
    .bind(folderId, userId)
    .first();

  if (!folder) {
    throw new AppError(404, 'Folder not found');
  }

  // Guard against circular parent references
  if (body.parentId !== undefined) {
    if (body.parentId === folderId) {
      throw new AppError(400, 'Cannot move folder into itself');
    }
    if (body.parentId !== null) {
      // Check parentId is not a descendant of this folder
      if (await isDescendant(c.env.DB, userId, body.parentId, folderId)) {
        throw new AppError(400, 'Cannot move folder into its own descendant');
      }
    }
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.parentId !== undefined) {
    updates.push('parent_id = ?');
    values.push(body.parentId);
  }

  if (updates.length === 0) {
    throw new AppError(400, 'No updates provided');
  }

  updates.push("updated_at = datetime('now')");
  values.push(folderId, userId);

  await c.env.DB.prepare(`UPDATE virtual_folders SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM virtual_folders WHERE id = ?').bind(folderId).first();
  return c.json({ folder: mapFolderRow(updated!) });
});

// DELETE /api/folders/:id — delete folder, move files to root
folders.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');

  const folder = await c.env.DB.prepare('SELECT * FROM virtual_folders WHERE id = ? AND user_id = ?')
    .bind(folderId, userId)
    .first();

  if (!folder) {
    throw new AppError(404, 'Folder not found');
  }

  // Move files in this folder to root (virtual_folder_id = NULL)
  await c.env.DB.prepare('UPDATE files SET virtual_folder_id = NULL WHERE virtual_folder_id = ? AND user_id = ?')
    .bind(folderId, userId)
    .run();

  // Move child folders to parent (or root)
  await c.env.DB.prepare('UPDATE virtual_folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?')
    .bind(folder.parent_id ?? null, folderId, userId)
    .run();

  // Delete the folder
  await c.env.DB.prepare('DELETE FROM virtual_folders WHERE id = ?').bind(folderId).run();

  return c.json({ success: true });
});

// ─── Helpers ───

export function buildBreadcrumb(
  folderId: string | null,
  allFolders: Array<Record<string, unknown>>
): BreadcrumbItem[] {
  const breadcrumb: BreadcrumbItem[] = [{ id: null, name: 'Root' }];

  if (!folderId) return breadcrumb;

  // Build a map for quick lookup
  const folderMap = new Map<string, { id: string; name: string; parentId: string | null }>();
  for (const f of allFolders) {
    folderMap.set(f.id as string, {
      id: f.id as string,
      name: f.name as string,
      parentId: (f.parent_id as string) ?? null,
    });
  }

  // Walk up from current folder to root
  const path: BreadcrumbItem[] = [];
  let currentId: string | null = folderId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) break; // Safety: prevent infinite loop
    visited.add(currentId);

    const folder = folderMap.get(currentId);
    if (!folder) break;

    path.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }

  return [...breadcrumb, ...path];
}

async function isDescendant(
  db: D1Database,
  userId: string,
  candidateId: string,
  ancestorId: string
): Promise<boolean> {
  const allFolders = await db
    .prepare('SELECT id, parent_id FROM virtual_folders WHERE user_id = ?')
    .bind(userId)
    .all();

  const parentMap = new Map<string, string | null>();
  for (const f of allFolders.results ?? []) {
    parentMap.set(f.id as string, (f.parent_id as string) ?? null);
  }

  let current: string | null = candidateId;
  const visited = new Set<string>();

  while (current) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = parentMap.get(current) ?? null;
  }

  return false;
}

export { folders };
```

- [ ] **Step 4: Run breadcrumb test to verify it passes**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run tests/breadcrumb.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 5: Mount folders routes in packages/worker/src/index.ts**

Add:

```typescript
import { folders } from './routes/folders';
// ...
app.route('/api/folders', folders);
```

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/routes/folders.ts packages/worker/tests/breadcrumb.test.ts packages/worker/src/index.ts
git commit -m "feat: add virtual folder routes with breadcrumb builder"
```

---

### Task 12: File Operation & Upload Routes

**Files:**
- Create: `packages/worker/src/routes/files.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Create packages/worker/src/routes/files.ts**

```typescript
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { GoogleDriveService } from '../services/google-drive';
import { selectDriveAccount } from '../services/upload-router';
import { mapFileRow, mapDriveRow } from '../types/index';
import { generateId } from '../lib/id';
import { AppError } from '../middleware/error-handler';

const files = new Hono<AppContext>();

files.use('*', authGuard);

// POST /api/files/upload — initiate resumable upload
files.post('/upload', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    name: string;
    mimeType: string;
    size: number;
    driveAccountId?: string;
    virtualFolderId?: string;
  }>();

  if (!body.name || !body.mimeType || !body.size) {
    throw new AppError(400, 'Missing required fields: name, mimeType, size');
  }

  // Get all drives for this user
  const driveRows = await c.env.DB.prepare('SELECT * FROM drive_accounts WHERE user_id = ?')
    .bind(userId)
    .all();

  const driveAccounts = (driveRows.results ?? []).map(mapDriveRow);

  if (driveAccounts.length === 0) {
    throw new AppError(400, 'No drive accounts connected');
  }

  // Select target drive
  const drivesForRouting = driveAccounts.map((d) => ({
    id: d.id,
    totalQuota: d.totalQuota,
    usedQuota: d.usedQuota,
  }));

  const targetDrive = selectDriveAccount(drivesForRouting, body.size, body.driveAccountId);
  const fullDrive = driveAccounts.find((d) => d.id === targetDrive.id)!;

  if (!fullDrive.rootFolderId) {
    throw new AppError(400, 'Drive has no Omnidrive folder. Please re-sync.');
  }

  // Validate virtual folder if specified
  if (body.virtualFolderId) {
    const folder = await c.env.DB.prepare('SELECT id FROM virtual_folders WHERE id = ? AND user_id = ?')
      .bind(body.virtualFolderId, userId)
      .first();
    if (!folder) {
      throw new AppError(404, 'Virtual folder not found');
    }
  }

  // Initiate resumable upload on Google Drive
  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);
  const uploadUrl = await driveService.initiateResumableUpload(
    fullDrive.id,
    body.name,
    body.mimeType,
    fullDrive.rootFolderId
  );

  return c.json({
    uploadUrl,
    driveAccountId: fullDrive.id,
    googleFolderId: fullDrive.rootFolderId,
  });
});

// POST /api/files/confirm — confirm upload completed, save metadata
files.post('/confirm', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    googleFileId: string;
    driveAccountId: string;
    virtualFolderId?: string;
  }>();

  if (!body.googleFileId || !body.driveAccountId) {
    throw new AppError(400, 'Missing required fields: googleFileId, driveAccountId');
  }

  // Verify drive belongs to user
  const drive = await c.env.DB.prepare('SELECT * FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(body.driveAccountId, userId)
    .first();

  if (!drive) {
    throw new AppError(404, 'Drive account not found');
  }

  // Fetch file metadata from Google Drive
  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);
  const gFile = await driveService.getFile(body.driveAccountId, body.googleFileId);

  // Insert into D1
  const fileId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO files (id, user_id, drive_account_id, google_file_id, virtual_folder_id, name, mime_type, size, thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      fileId,
      userId,
      body.driveAccountId,
      gFile.id,
      body.virtualFolderId ?? null,
      gFile.name,
      gFile.mimeType,
      parseInt(gFile.size ?? '0', 10),
      gFile.thumbnailLink ?? null,
      gFile.webViewLink ?? null,
      gFile.webContentLink ?? null,
      gFile.createdTime,
      gFile.modifiedTime
    )
    .run();

  // Invalidate quota cache
  await c.env.KV.delete(`quota:${body.driveAccountId}`);

  const created = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first();
  return c.json({ file: mapFileRow(created!) }, 201);
});

// GET /api/files/search?q= — search files by name
files.get('/search', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('q');

  if (!query?.trim()) {
    throw new AppError(400, 'Search query is required');
  }

  const rows = await c.env.DB.prepare(
    `SELECT f.*, da.email as drive_email FROM files f
     JOIN drive_accounts da ON f.drive_account_id = da.id
     WHERE f.user_id = ? AND f.name LIKE ? AND f.is_trashed = 0
     ORDER BY f.name LIMIT 50`
  )
    .bind(userId, `%${query.trim()}%`)
    .all();

  return c.json({
    files: (rows.results ?? []).map((row) => ({
      ...mapFileRow(row),
      driveEmail: row.drive_email as string,
    })),
    query: query.trim(),
  });
});

// PATCH /api/files/:id/move — move file to virtual folder
files.patch('/:id/move', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const body = await c.req.json<{ virtualFolderId: string | null }>();

  // Validate file belongs to user
  const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .bind(fileId, userId)
    .first();

  if (!file) {
    throw new AppError(404, 'File not found');
  }

  // Validate target folder if specified
  if (body.virtualFolderId) {
    const folder = await c.env.DB.prepare('SELECT id FROM virtual_folders WHERE id = ? AND user_id = ?')
      .bind(body.virtualFolderId, userId)
      .first();
    if (!folder) {
      throw new AppError(404, 'Virtual folder not found');
    }
  }

  await c.env.DB.prepare('UPDATE files SET virtual_folder_id = ? WHERE id = ?')
    .bind(body.virtualFolderId, fileId)
    .run();

  return c.json({ success: true });
});

// PATCH /api/files/:id — rename file
files.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const body = await c.req.json<{ name: string }>();

  if (!body.name?.trim()) {
    throw new AppError(400, 'Name is required');
  }

  const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .bind(fileId, userId)
    .first();

  if (!file) {
    throw new AppError(404, 'File not found');
  }

  // Rename on Google Drive first
  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);
  await driveService.renameFile(file.drive_account_id as string, file.google_file_id as string, body.name.trim());

  // Update D1
  await c.env.DB.prepare('UPDATE files SET name = ? WHERE id = ?')
    .bind(body.name.trim(), fileId)
    .run();

  return c.json({ success: true });
});

// DELETE /api/files/:id — delete file from Google Drive + D1
files.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');

  const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .bind(fileId, userId)
    .first();

  if (!file) {
    throw new AppError(404, 'File not found');
  }

  // Delete from Google Drive
  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);
  await driveService.deleteFile(file.drive_account_id as string, file.google_file_id as string);

  // Delete from D1
  await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();

  // Invalidate quota cache
  await c.env.KV.delete(`quota:${file.drive_account_id}`);

  return c.json({ success: true });
});

export { files };
```

- [ ] **Step 2: Mount files routes in packages/worker/src/index.ts**

The final `packages/worker/src/index.ts`:

```typescript
import { Hono } from 'hono';
import type { AppContext, Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { auth } from './routes/auth';
import { drives } from './routes/drives';
import { folders } from './routes/folders';
import { files } from './routes/files';

const app = new Hono<AppContext>();

// Global middleware
app.use('*', corsMiddleware());
app.use('*', errorHandler);

// Health check (public)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.route('/api/auth', auth);
app.route('/api/drives', drives);
app.route('/api/folders', folders);
app.route('/api/files', files);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Implemented in Task 13
    console.log('Cron triggered:', event.cron);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 3: Verify all tests still pass**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/routes/files.ts packages/worker/src/index.ts
git commit -m "feat: add file operation routes — upload, confirm, search, move, rename, delete"
```

---

## Phase 7: Sync

### Task 13: Sync Service + Cron Handler

**Files:**
- Create: `packages/worker/src/services/sync.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Create packages/worker/src/services/sync.ts**

```typescript
import type { DriveAccount } from '../types/index';
import { mapDriveRow } from '../types/index';
import { GoogleDriveService } from './google-drive';
import { generateId } from '../lib/id';

export async function syncDriveAccount(
  drive: DriveAccount,
  db: D1Database,
  kv: KVNamespace,
  driveService: GoogleDriveService
): Promise<void> {
  // Skip drives without root folder
  if (!drive.rootFolderId) {
    console.log(`Skipping sync for ${drive.email}: no root folder`);
    return;
  }

  // Update status to syncing
  await db
    .prepare("UPDATE sync_state SET status = 'syncing', error_message = NULL WHERE drive_account_id = ?")
    .bind(drive.id)
    .run();

  try {
    // Get sync state
    const syncState = await db
      .prepare('SELECT * FROM sync_state WHERE drive_account_id = ?')
      .bind(drive.id)
      .first();

    let changeToken = syncState?.change_token as string | null;

    // If no change token, do initial sync
    if (!changeToken) {
      await performInitialSync(drive, db, driveService);
      changeToken = await driveService.getStartPageToken(drive.id);
    } else {
      // Incremental sync via Changes API
      await performIncrementalSync(drive, db, changeToken, driveService);
      // Get the latest token after processing all changes
      changeToken = await getLatestChangeToken(drive, changeToken, driveService);
    }

    // Update sync state
    await db
      .prepare(
        "UPDATE sync_state SET change_token = ?, last_synced_at = datetime('now'), status = 'idle' WHERE drive_account_id = ?"
      )
      .bind(changeToken, drive.id)
      .run();

    // Refresh quota cache
    try {
      await driveService.getQuota(drive.id);
    } catch {
      // Non-fatal: quota refresh can fail
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Sync failed for ${drive.email}:`, message);

    await db
      .prepare("UPDATE sync_state SET status = 'error', error_message = ? WHERE drive_account_id = ?")
      .bind(message, drive.id)
      .run();
  }
}

async function performInitialSync(
  drive: DriveAccount,
  db: D1Database,
  driveService: GoogleDriveService
): Promise<void> {
  console.log(`Initial sync for ${drive.email}`);

  const files = await driveService.listFilesInFolder(drive.id, drive.rootFolderId!);

  for (const file of files) {
    // Skip folders
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;

    await upsertFile(db, drive, {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      thumbnailLink: file.thumbnailLink,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
    });
  }
}

async function performIncrementalSync(
  drive: DriveAccount,
  db: D1Database,
  pageToken: string,
  driveService: GoogleDriveService
): Promise<void> {
  console.log(`Incremental sync for ${drive.email} from token ${pageToken}`);

  let currentToken = pageToken;
  let hasMore = true;

  while (hasMore) {
    const response = await driveService.listChanges(drive.id, currentToken);

    for (const change of response.changes) {
      // File removed entirely
      if (change.removed) {
        await db
          .prepare('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?')
          .bind(drive.id, change.fileId)
          .run();
        continue;
      }

      const file = change.file;
      if (!file) continue;

      // Skip folders
      if (file.mimeType === 'application/vnd.google-apps.folder') continue;

      // File trashed or not in Omnidrive folder
      if (file.trashed || !file.parents?.includes(drive.rootFolderId!)) {
        await db
          .prepare('DELETE FROM files WHERE drive_account_id = ? AND google_file_id = ?')
          .bind(drive.id, change.fileId)
          .run();
        continue;
      }

      // File created or modified within Omnidrive folder
      await upsertFile(db, drive, {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        thumbnailLink: file.thumbnailLink,
        webViewLink: file.webViewLink,
        webContentLink: file.webContentLink,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
      });
    }

    if (response.nextPageToken) {
      currentToken = response.nextPageToken;
    } else {
      hasMore = false;
    }
  }
}

async function getLatestChangeToken(
  drive: DriveAccount,
  startToken: string,
  driveService: GoogleDriveService
): Promise<string> {
  let currentToken = startToken;
  let hasMore = true;

  while (hasMore) {
    const response = await driveService.listChanges(drive.id, currentToken);
    if (response.newStartPageToken) {
      return response.newStartPageToken;
    }
    if (response.nextPageToken) {
      currentToken = response.nextPageToken;
    } else {
      hasMore = false;
    }
  }

  return currentToken;
}

async function upsertFile(
  db: D1Database,
  drive: DriveAccount,
  file: {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    thumbnailLink?: string;
    webViewLink?: string;
    webContentLink?: string;
    createdTime: string;
    modifiedTime: string;
  }
): Promise<void> {
  const existing = await db
    .prepare('SELECT id, virtual_folder_id FROM files WHERE drive_account_id = ? AND google_file_id = ?')
    .bind(drive.id, file.id)
    .first();

  if (existing) {
    // Update existing file metadata, preserve virtual_folder_id
    await db
      .prepare(
        `UPDATE files SET name = ?, mime_type = ?, size = ?, thumbnail_url = ?, web_view_link = ?, web_content_link = ?, google_modified_at = ?, synced_at = datetime('now')
         WHERE id = ?`
      )
      .bind(
        file.name,
        file.mimeType,
        parseInt(file.size ?? '0', 10),
        file.thumbnailLink ?? null,
        file.webViewLink ?? null,
        file.webContentLink ?? null,
        file.modifiedTime,
        existing.id as string
      )
      .run();
  } else {
    // Insert new file
    const fileId = generateId();
    await db
      .prepare(
        `INSERT INTO files (id, user_id, drive_account_id, google_file_id, name, mime_type, size, thumbnail_url, web_view_link, web_content_link, google_created_at, google_modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        fileId,
        drive.userId,
        drive.id,
        file.id,
        file.name,
        file.mimeType,
        parseInt(file.size ?? '0', 10),
        file.thumbnailLink ?? null,
        file.webViewLink ?? null,
        file.webContentLink ?? null,
        file.createdTime,
        file.modifiedTime
      )
      .run();
  }
}

export async function runScheduledSync(env: { DB: D1Database; KV: KVNamespace; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string }): Promise<void> {
  const driveService = new GoogleDriveService(env.KV, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);

  // Get all drive accounts
  const rows = await env.DB.prepare("SELECT * FROM drive_accounts WHERE type = 'oauth'").all();
  const driveAccounts = (rows.results ?? []).map(mapDriveRow);

  console.log(`Syncing ${driveAccounts.length} drive accounts`);

  for (const drive of driveAccounts) {
    try {
      await syncDriveAccount(drive, env.DB, env.KV, driveService);
    } catch (err) {
      console.error(`Sync error for ${drive.email}:`, err);
    }
  }
}
```

- [ ] **Step 2: Wire up cron handler in packages/worker/src/index.ts**

Replace the `scheduled` handler:

```typescript
import { runScheduledSync } from './services/sync';

// ... existing code ...

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('Cron triggered:', event.cron);
    ctx.waitUntil(runScheduledSync(env));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 3: Verify all tests still pass**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/sync.ts packages/worker/src/index.ts
git commit -m "feat: add sync service with cron handler — initial + incremental sync"
```

---

## Phase 8: Frontend Foundation

### Task 14: Design System CSS

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 1: Replace packages/web/src/index.css with full design system**

```css
/* ─── Google Fonts ─── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ─── CSS Custom Properties ─── */
:root {
  /* Colors — Dark Theme */
  --bg-primary: #0a0a0f;
  --bg-secondary: #111118;
  --bg-tertiary: #1a1a24;
  --bg-elevated: #1e1e2a;
  --bg-hover: #252533;
  --bg-active: #2d2d3f;

  --border-subtle: #2a2a3a;
  --border-default: #3a3a4f;
  --border-strong: #4a4a60;

  --text-primary: #e4e4e7;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;
  --text-inverse: #0a0a0f;

  --accent-primary: #6366f1;
  --accent-primary-hover: #818cf8;
  --accent-primary-subtle: rgba(99, 102, 241, 0.15);
  --accent-success: #22c55e;
  --accent-success-subtle: rgba(34, 197, 94, 0.15);
  --accent-warning: #f59e0b;
  --accent-warning-subtle: rgba(245, 158, 11, 0.15);
  --accent-danger: #ef4444;
  --accent-danger-subtle: rgba(239, 68, 68, 0.15);
  --accent-info: #3b82f6;

  /* Drive colors */
  --drive-1: #6366f1;
  --drive-2: #ec4899;
  --drive-3: #14b8a6;
  --drive-4: #f59e0b;
  --drive-5: #8b5cf6;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* Typography */
  --font-family: 'Inter', system-ui, -apple-system, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.8125rem;
  --font-size-base: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 2rem;

  /* Border radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(99, 102, 241, 0.2);

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
  --transition-slow: 350ms ease;

  /* Layout */
  --sidebar-width: 260px;
  --header-height: 56px;
}

/* ─── Reset ─── */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-family);
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  line-height: 1.5;
}

a {
  color: var(--accent-primary);
  text-decoration: none;
}

a:hover {
  color: var(--accent-primary-hover);
}

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: none;
  font-size: inherit;
  color: inherit;
}

input, textarea, select {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  outline: none;
  transition: border-color var(--transition-fast);
}

input:focus, textarea:focus, select:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-primary-subtle);
}

/* ─── Scrollbar ─── */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

/* ─── Button Styles ─── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: 500;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.btn-primary {
  background: var(--accent-primary);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-primary-hover);
  box-shadow: var(--shadow-glow);
}

.btn-secondary {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn-danger {
  background: var(--accent-danger-subtle);
  color: var(--accent-danger);
}

.btn-danger:hover {
  background: var(--accent-danger);
  color: white;
}

.btn-ghost {
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn-sm {
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-size-sm);
}

.btn-lg {
  padding: var(--space-md) var(--space-lg);
  font-size: var(--font-size-md);
}

/* ─── Card ─── */
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  transition: border-color var(--transition-fast);
}

.card:hover {
  border-color: var(--border-default);
}

.card-interactive:hover {
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-glow);
  cursor: pointer;
}

/* ─── Quota Bar ─── */
.quota-bar {
  width: 100%;
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.quota-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width var(--transition-slow);
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-primary-hover));
}

.quota-bar-fill.warning {
  background: linear-gradient(90deg, var(--accent-warning), #fbbf24);
}

.quota-bar-fill.danger {
  background: linear-gradient(90deg, var(--accent-danger), #f87171);
}

/* ─── Badge ─── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

/* ─── Modal Overlay ─── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: fadeIn var(--transition-fast) ease;
}

.modal-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
  max-width: 520px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: slideUp var(--transition-base) ease;
}

/* ─── Toast ─── */
.toast-container {
  position: fixed;
  bottom: var(--space-lg);
  right: var(--space-lg);
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: slideInRight var(--transition-base) ease;
  min-width: 300px;
}

/* ─── Dropzone ─── */
.dropzone-overlay {
  position: fixed;
  inset: 0;
  background: rgba(99, 102, 241, 0.08);
  border: 2px dashed var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  animation: fadeIn var(--transition-fast) ease;
}

/* ─── Drive Color Dot ─── */
.drive-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

/* ─── Animations ─── */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(100px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* ─── Utility ─── */
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/index.css
git commit -m "feat: add dark mode design system — tokens, components, animations"
```

---

### Task 15: Frontend Types + API Client

**Files:**
- Create: `packages/web/src/types/index.ts`
- Create: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/utils.ts`

- [ ] **Step 1: Create packages/web/src/types/index.ts**

```typescript
export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriveAccount {
  id: string;
  userId: string;
  googleAccountId: string;
  email: string;
  name: string | null;
  type: 'oauth' | 'service_account';
  isPrimary: boolean;
  rootFolderId: string | null;
  totalQuota: number;
  usedQuota: number;
  freeSpace: number;
  usagePercent: number;
  quotaUpdatedAt: string | null;
  createdAt: string;
}

export interface AggregateQuota {
  totalQuota: number;
  totalUsed: number;
  totalFree: number;
  driveCount: number;
}

export interface VirtualFolder {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  icon: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  id: string;
  userId: string;
  driveAccountId: string;
  googleFileId: string;
  virtualFolderId: string | null;
  name: string;
  mimeType: string | null;
  size: number;
  thumbnailUrl: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  isTrashed: boolean;
  googleCreatedAt: string | null;
  googleModifiedAt: string | null;
  syncedAt: string;
  createdAt: string;
  driveEmail: string;
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface FolderContents {
  folder: VirtualFolder | null;
  subfolders: VirtualFolder[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
}

export interface UploadInitResponse {
  uploadUrl: string;
  driveAccountId: string;
  googleFolderId: string;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}
```

- [ ] **Step 2: Create packages/web/src/lib/api.ts**

```typescript
const API_BASE = import.meta.env.VITE_API_URL ?? '';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  getUser: () => request<{ user: import('../types').User }>('/api/auth/me'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Drives
  getDrives: () =>
    request<{ drives: import('../types').DriveAccount[]; aggregate: import('../types').AggregateQuota }>('/api/drives'),
  disconnectDrive: (id: string) => request<{ success: boolean }>(`/api/drives/${id}`, { method: 'DELETE' }),
  addServiceAccount: (credentials: string, folderId: string) =>
    request<{ success: boolean; driveId: string }>('/api/drives/service-account', {
      method: 'POST',
      body: JSON.stringify({ credentials, folderId }),
    }),
  triggerSync: (id: string) => request<{ success: boolean }>(`/api/drives/${id}/sync`, { method: 'POST' }),

  // Folders
  getRootContents: () => request<import('../types').FolderContents>('/api/folders/root/contents'),
  getFolderContents: (id: string) => request<import('../types').FolderContents>(`/api/folders/${id}/contents`),
  createFolder: (name: string, parentId?: string, icon?: string, color?: string) =>
    request<{ folder: import('../types').VirtualFolder }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId, icon, color }),
    }),
  updateFolder: (id: string, data: { name?: string; parentId?: string }) =>
    request<{ folder: import('../types').VirtualFolder }>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteFolder: (id: string) => request<{ success: boolean }>(`/api/folders/${id}`, { method: 'DELETE' }),

  // Files
  searchFiles: (query: string) =>
    request<{ files: import('../types').FileEntry[]; query: string }>(`/api/files/search?q=${encodeURIComponent(query)}`),
  initiateUpload: (data: { name: string; mimeType: string; size: number; driveAccountId?: string; virtualFolderId?: string }) =>
    request<import('../types').UploadInitResponse>('/api/files/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  confirmUpload: (data: { googleFileId: string; driveAccountId: string; virtualFolderId?: string }) =>
    request<{ file: import('../types').FileEntry }>('/api/files/confirm', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  moveFile: (id: string, virtualFolderId: string | null) =>
    request<{ success: boolean }>(`/api/files/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ virtualFolderId }),
    }),
  renameFile: (id: string, name: string) =>
    request<{ success: boolean }>(`/api/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFile: (id: string) => request<{ success: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),

  // Recent files (uses root contents, sorted by date)
  getRecentFiles: () =>
    request<{ files: import('../types').FileEntry[] }>('/api/files/search?q=%'),
};

export { ApiError };
```

- [ ] **Step 3: Create packages/web/src/lib/utils.ts**

```typescript
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function getFileIcon(mimeType: string | null): string {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return '📦';
  if (mimeType.includes('text')) return '📄';
  return '📄';
}

export function getDriveColor(index: number): string {
  const colors = [
    'var(--drive-1)',
    'var(--drive-2)',
    'var(--drive-3)',
    'var(--drive-4)',
    'var(--drive-5)',
  ];
  return colors[index % colors.length];
}

export function getQuotaLevel(percent: number): 'normal' | 'warning' | 'danger' {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warning';
  return 'normal';
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/types/ packages/web/src/lib/
git commit -m "feat: add frontend types, API client, and utility functions"
```

---

### Task 16: Zustand Stores

**Files:**
- Create: `packages/web/src/stores/authStore.ts`
- Create: `packages/web/src/stores/driveStore.ts`
- Create: `packages/web/src/stores/fileStore.ts`
- Create: `packages/web/src/stores/uploadStore.ts`
- Create: `packages/web/src/stores/toastStore.ts`

- [ ] **Step 1: Create packages/web/src/stores/authStore.ts**

```typescript
import { create } from 'zustand';
import type { User } from '../types';
import { api } from '../lib/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  fetchUser: async () => {
    try {
      const { user } = await api.getUser();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, isAuthenticated: false });
    }
  },
}));
```

- [ ] **Step 2: Create packages/web/src/stores/driveStore.ts**

```typescript
import { create } from 'zustand';
import type { DriveAccount, AggregateQuota } from '../types';
import { api } from '../lib/api';

interface DriveState {
  drives: DriveAccount[];
  aggregate: AggregateQuota;
  isLoading: boolean;
  fetchDrives: () => Promise<void>;
  removeDrive: (id: string) => Promise<void>;
  triggerSync: (id: string) => Promise<void>;
}

const emptyAggregate: AggregateQuota = { totalQuota: 0, totalUsed: 0, totalFree: 0, driveCount: 0 };

export const useDriveStore = create<DriveState>((set) => ({
  drives: [],
  aggregate: emptyAggregate,
  isLoading: false,

  fetchDrives: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getDrives();
      set({ drives: data.drives, aggregate: data.aggregate, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  removeDrive: async (id: string) => {
    await api.disconnectDrive(id);
    set((state) => ({
      drives: state.drives.filter((d) => d.id !== id),
    }));
  },

  triggerSync: async (id: string) => {
    await api.triggerSync(id);
  },
}));
```

- [ ] **Step 3: Create packages/web/src/stores/fileStore.ts**

```typescript
import { create } from 'zustand';
import type { VirtualFolder, FileEntry, BreadcrumbItem } from '../types';
import { api } from '../lib/api';

interface FileState {
  currentFolder: VirtualFolder | null;
  subfolders: VirtualFolder[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
  isLoading: boolean;
  searchResults: FileEntry[] | null;
  fetchContents: (folderId?: string) => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFile: (fileId: string, folderId: string | null) => Promise<void>;
  renameFile: (fileId: string, name: string) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;
  searchFiles: (query: string) => Promise<void>;
  clearSearch: () => void;
}

export const useFileStore = create<FileState>((set) => ({
  currentFolder: null,
  subfolders: [],
  files: [],
  breadcrumb: [{ id: null, name: 'Root' }],
  isLoading: false,
  searchResults: null,

  fetchContents: async (folderId?: string) => {
    set({ isLoading: true, searchResults: null });
    try {
      const data = folderId ? await api.getFolderContents(folderId) : await api.getRootContents();
      set({
        currentFolder: data.folder,
        subfolders: data.subfolders,
        files: data.files,
        breadcrumb: data.breadcrumb,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  createFolder: async (name: string, parentId?: string) => {
    const { folder } = await api.createFolder(name, parentId);
    set((state) => ({ subfolders: [...state.subfolders, folder] }));
  },

  deleteFolder: async (id: string) => {
    await api.deleteFolder(id);
    set((state) => ({ subfolders: state.subfolders.filter((f) => f.id !== id) }));
  },

  moveFile: async (fileId: string, folderId: string | null) => {
    await api.moveFile(fileId, folderId);
    set((state) => ({ files: state.files.filter((f) => f.id !== fileId) }));
  },

  renameFile: async (fileId: string, name: string) => {
    await api.renameFile(fileId, name);
    set((state) => ({
      files: state.files.map((f) => (f.id === fileId ? { ...f, name } : f)),
    }));
  },

  deleteFile: async (fileId: string) => {
    await api.deleteFile(fileId);
    set((state) => ({ files: state.files.filter((f) => f.id !== fileId) }));
  },

  searchFiles: async (query: string) => {
    const { files } = await api.searchFiles(query);
    set({ searchResults: files });
  },

  clearSearch: () => set({ searchResults: null }),
}));
```

- [ ] **Step 4: Create packages/web/src/stores/uploadStore.ts**

```typescript
import { create } from 'zustand';
import { api } from '../lib/api';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'confirming' | 'done' | 'error';
  error?: string;
}

interface UploadState {
  queue: UploadItem[];
  isUploading: boolean;
  showModal: boolean;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearQueue: () => void;
  startUpload: (driveAccountId?: string, virtualFolderId?: string) => Promise<void>;
  setShowModal: (show: boolean) => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  queue: [],
  isUploading: false,
  showModal: false,

  addFiles: (files: File[]) => {
    const items: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'pending',
    }));
    set((state) => ({ queue: [...state.queue, ...items], showModal: true }));
  },

  removeFile: (id: string) => {
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
  },

  clearQueue: () => set({ queue: [], isUploading: false }),

  startUpload: async (driveAccountId?: string, virtualFolderId?: string) => {
    set({ isUploading: true });
    const { queue } = get();

    for (const item of queue) {
      if (item.status !== 'pending') continue;

      try {
        // Update status
        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'uploading' as const } : q)),
        }));

        // 1. Initiate upload — get resumable URL from Worker
        const { uploadUrl, driveAccountId: actualDriveId } = await api.initiateUpload({
          name: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          size: item.file.size,
          driveAccountId,
          virtualFolderId,
        });

        // 2. Upload directly to Google Drive
        const uploadResponse = await uploadToGoogleDrive(uploadUrl, item.file, (progress) => {
          set((state) => ({
            queue: state.queue.map((q) => (q.id === item.id ? { ...q, progress } : q)),
          }));
        });

        // 3. Confirm upload with Worker
        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'confirming' as const, progress: 100 } : q)),
        }));

        await api.confirmUpload({
          googleFileId: uploadResponse.id,
          driveAccountId: actualDriveId,
          virtualFolderId,
        });

        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'done' as const } : q)),
        }));
      } catch (err) {
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === item.id ? { ...q, status: 'error' as const, error: (err as Error).message } : q
          ),
        }));
      }
    }

    set({ isUploading: false });
  },

  setShowModal: (show: boolean) => set({ showModal: show }),
}));

async function uploadToGoogleDrive(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload network error')));

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}
```

- [ ] **Step 5: Create packages/web/src/stores/toastStore.ts**

```typescript
import { create } from 'zustand';
import type { Toast, ToastType } from '../types';

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));

    // Auto-remove after 5 seconds
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/stores/
git commit -m "feat: add Zustand stores — auth, drive, file, upload, toast"
```

---

## Phase 9: Frontend Shell

### Task 17: Layout, Sidebar, AuthGuard, Toast

**Files:**
- Create: `packages/web/src/components/AuthGuard.tsx`
- Create: `packages/web/src/components/Layout.tsx`
- Create: `packages/web/src/components/Sidebar.tsx`
- Create: `packages/web/src/components/QuotaBar.tsx`
- Create: `packages/web/src/components/Toast.tsx`

- [ ] **Step 1: Create packages/web/src/components/AuthGuard.tsx**

```tsx
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, fetchUser } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = '/login';
    return null;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Create packages/web/src/components/QuotaBar.tsx**

```tsx
import { formatFileSize, getQuotaLevel } from '../lib/utils';

interface QuotaBarProps {
  used: number;
  total: number;
  color?: string;
  showLabel?: boolean;
}

export function QuotaBar({ used, total, color, showLabel = true }: QuotaBarProps) {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const level = getQuotaLevel(percent);

  return (
    <div>
      <div className="quota-bar">
        <div
          className={`quota-bar-fill ${level}`}
          style={{
            width: `${Math.min(percent, 100)}%`,
            ...(color ? { background: color } : {}),
          }}
        />
      </div>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
          <span>{formatFileSize(used)} used</span>
          <span>{formatFileSize(total)} total</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create packages/web/src/components/Sidebar.tsx**

```tsx
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, Settings, Plus, HardDrive } from 'lucide-react';
import { useDriveStore } from '../stores/driveStore';
import { useAuthStore } from '../stores/authStore';
import { QuotaBar } from './QuotaBar';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useEffect } from 'react';

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { drives, aggregate, fetchDrives } = useDriveStore();
  const location = useLocation();

  useEffect(() => {
    fetchDrives();
  }, [fetchDrives]);

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon">🔷</span>
        <span className="sidebar-logo-text">Omnidrive</span>
      </div>

      {/* Nav Links */}
      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/files" className={() => `sidebar-link ${location.pathname.startsWith('/files') ? 'active' : ''}`}>
          <FolderOpen size={18} />
          <span>Files</span>
        </NavLink>
        <NavLink to="/settings/drives" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>

      {/* Aggregate Quota */}
      {aggregate.driveCount > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">Total Storage</div>
          <QuotaBar used={aggregate.totalUsed} total={aggregate.totalQuota} />
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {formatFileSize(aggregate.totalFree)} free across {aggregate.driveCount} drive{aggregate.driveCount > 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Connected Drives */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Drives</div>
        <div className="sidebar-drives">
          {drives.map((drive, i) => (
            <div key={drive.id} className="sidebar-drive-item">
              <div className="drive-dot" style={{ backgroundColor: getDriveColor(i) }} />
              <span className="truncate" style={{ fontSize: 'var(--font-size-sm)' }}>{drive.email}</span>
            </div>
          ))}
          <a href="/api/drives/connect" className="sidebar-link add-drive">
            <Plus size={16} />
            <span>Add Drive</span>
          </a>
        </div>
      </div>

      {/* User */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} className="sidebar-avatar" referrerPolicy="no-referrer" />
          ) : (
            <div className="sidebar-avatar-placeholder">{user?.name?.[0] ?? '?'}</div>
          )}
          <div className="truncate" style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{user?.name}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{user?.email}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
      </div>

      <style>{sidebarStyles}</style>
    </aside>
  );
}

const sidebarStyles = `
  .sidebar {
    width: var(--sidebar-width);
    height: 100vh;
    position: fixed;
    left: 0;
    top: 0;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    padding: var(--space-md);
    overflow-y: auto;
  }

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-sm);
    margin-bottom: var(--space-lg);
  }

  .sidebar-logo-icon { font-size: 1.5rem; }
  .sidebar-logo-text { font-size: var(--font-size-lg); font-weight: 700; }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: var(--space-lg);
  }

  .sidebar-link {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--font-size-base);
    transition: all var(--transition-fast);
    text-decoration: none;
  }

  .sidebar-link:hover { background: var(--bg-hover); color: var(--text-primary); }
  .sidebar-link.active { background: var(--accent-primary-subtle); color: var(--accent-primary-hover); }

  .sidebar-section {
    padding: var(--space-md) var(--space-sm);
    border-top: 1px solid var(--border-subtle);
  }

  .sidebar-section-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-tertiary);
    letter-spacing: 0.05em;
    margin-bottom: var(--space-sm);
  }

  .sidebar-drives { display: flex; flex-direction: column; gap: 4px; }

  .sidebar-drive-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    color: var(--text-secondary);
  }

  .add-drive { margin-top: var(--space-xs); }

  .sidebar-footer {
    margin-top: auto;
    padding-top: var(--space-md);
    border-top: 1px solid var(--border-subtle);
  }

  .sidebar-user {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm);
    margin-bottom: var(--space-sm);
  }

  .sidebar-avatar {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
  }

  .sidebar-avatar-placeholder {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--accent-primary-subtle);
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: var(--font-size-sm);
  }
`;
```

- [ ] **Step 4: Create packages/web/src/components/Layout.tsx**

```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-width)', padding: 'var(--space-xl) var(--space-2xl)', maxWidth: '1200px' }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Create packages/web/src/components/Toast.tsx**

```tsx
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore } from '../stores/toastStore';
import type { ToastType } from '../types';

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} color="var(--accent-success)" />,
  error: <AlertCircle size={18} color="var(--accent-danger)" />,
  warning: <AlertTriangle size={18} color="var(--accent-warning)" />,
  info: <Info size={18} color="var(--accent-info)" />,
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {icons[toast.type]}
          <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{toast.message}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => removeToast(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/
git commit -m "feat: add shell components — AuthGuard, Layout, Sidebar, QuotaBar, Toast"
```

---

### Task 18: App Routing + Login Page

**Files:**
- Create: `packages/web/src/pages/LoginPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create packages/web/src/pages/LoginPage.tsx**

```tsx
import { LogIn } from 'lucide-react';

export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get('error');

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🔷</div>
        <h1 className="login-title">Omnidrive</h1>
        <p className="login-subtitle">Unified multi-Google-Drive storage gateway</p>

        {error && (
          <div className="login-error">
            Authentication failed. Please try again.
          </div>
        )}

        <a href="/api/auth/login" className="btn btn-primary btn-lg login-btn">
          <LogIn size={20} />
          Sign in with Google
        </a>

        <p className="login-footer">
          Your first Google Drive will be connected automatically.
        </p>
      </div>

      <style>{loginStyles}</style>
    </div>
  );
}

const loginStyles = `
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    padding: var(--space-lg);
  }

  .login-card {
    text-align: center;
    max-width: 400px;
    width: 100%;
  }

  .login-logo {
    font-size: 4rem;
    margin-bottom: var(--space-md);
    animation: slideUp var(--transition-slow) ease;
  }

  .login-title {
    font-size: var(--font-size-3xl);
    font-weight: 700;
    margin-bottom: var(--space-sm);
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .login-subtitle {
    color: var(--text-secondary);
    margin-bottom: var(--space-xl);
    font-size: var(--font-size-md);
  }

  .login-error {
    background: var(--accent-danger-subtle);
    color: var(--accent-danger);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-lg);
    font-size: var(--font-size-sm);
  }

  .login-btn {
    width: 100%;
    text-decoration: none;
    margin-bottom: var(--space-lg);
  }

  .login-footer {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
`;
```

- [ ] **Step 2: Replace packages/web/src/App.tsx**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { Layout } from './components/Layout';
import { ToastContainer } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FilesPage } from './pages/FilesPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <AuthGuard>
              <Layout />
              <ToastContainer />
            </AuthGuard>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/files/:folderId" element={<FilesPage />} />
          <Route path="/settings/drives" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Create stub pages so the app compiles**

Create `packages/web/src/pages/DashboardPage.tsx`:

```tsx
export function DashboardPage() {
  return <div><h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Dashboard</h1></div>;
}
```

Create `packages/web/src/pages/FilesPage.tsx`:

```tsx
export function FilesPage() {
  return <div><h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Files</h1></div>;
}
```

Create `packages/web/src/pages/SettingsPage.tsx`:

```tsx
export function SettingsPage() {
  return <div><h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Settings</h1></div>;
}
```

- [ ] **Step 4: Verify app compiles and login page renders**

Run: `cd /home/bilfid/projects/omnidrive && npm run dev:web`

Navigate to `http://localhost:5173/login`

Expected: Login page with Omnidrive logo, title, gradient text, and Google sign-in button.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/pages/
git commit -m "feat: add app routing, login page, and page stubs"
```

---

## Phase 10: Frontend Pages

### Task 19: Dashboard Page

**Files:**
- Modify: `packages/web/src/pages/DashboardPage.tsx`
- Create: `packages/web/src/components/FileCard.tsx`

- [ ] **Step 1: Create packages/web/src/components/FileCard.tsx**

```tsx
import { MoreVertical, Download, Trash2, FolderInput, Pencil } from 'lucide-react';
import { getFileIcon, formatFileSize, formatRelativeTime } from '../lib/utils';
import type { FileEntry } from '../types';
import { useState } from 'react';

interface FileCardProps {
  file: FileEntry;
  driveColor: string;
  onDelete?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onPreview?: (file: FileEntry) => void;
}

export function FileCard({ file, driveColor, onDelete, onRename, onPreview }: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="file-card" onClick={() => onPreview?.(file)}>
      <div className="file-card-icon">{getFileIcon(file.mimeType)}</div>
      <div className="file-card-info">
        <div className="file-card-name truncate">{file.name}</div>
        <div className="file-card-meta">
          <div className="drive-dot" style={{ backgroundColor: driveColor }} />
          <span>{formatFileSize(file.size)}</span>
          <span>·</span>
          <span>{formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}</span>
        </div>
      </div>
      <div className="file-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(!menuOpen)}>
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="file-card-menu">
            {file.webContentLink && (
              <a href={file.webContentLink} target="_blank" rel="noopener noreferrer" className="file-card-menu-item">
                <Download size={14} /> Download
              </a>
            )}
            <button
              className="file-card-menu-item"
              onClick={() => {
                const newName = prompt('Rename file:', file.name);
                if (newName && newName !== file.name) onRename?.(file.id, newName);
                setMenuOpen(false);
              }}
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              className="file-card-menu-item danger"
              onClick={() => { onDelete?.(file.id); setMenuOpen(false); }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>

      <style>{fileCardStyles}</style>
    </div>
  );
}

const fileCardStyles = `
  .file-card {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-md);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast);
    position: relative;
  }

  .file-card:hover { background: var(--bg-hover); }

  .file-card-icon { font-size: 1.5rem; flex-shrink: 0; }

  .file-card-info { flex: 1; min-width: 0; }

  .file-card-name {
    font-size: var(--font-size-base);
    font-weight: 500;
  }

  .file-card-meta {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .file-card-actions { position: relative; }

  .file-card-menu {
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-xs);
    min-width: 150px;
    box-shadow: var(--shadow-lg);
    z-index: 10;
  }

  .file-card-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    width: 100%;
    text-align: left;
    cursor: pointer;
    border: none;
    background: none;
    text-decoration: none;
  }

  .file-card-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .file-card-menu-item.danger:hover { background: var(--accent-danger-subtle); color: var(--accent-danger); }
`;
```

- [ ] **Step 2: Replace packages/web/src/pages/DashboardPage.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useDriveStore } from '../stores/driveStore';
import { QuotaBar } from '../components/QuotaBar';
import { FileCard } from '../components/FileCard';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { api } from '../lib/api';
import { HardDrive, RefreshCw, TrendingUp } from 'lucide-react';
import type { FileEntry } from '../types';

export function DashboardPage() {
  const { drives, aggregate, isLoading, fetchDrives } = useDriveStore();
  const [recentFiles, setRecentFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    fetchDrives();
    api.getRecentFiles().then((data) => setRecentFiles(data.files.slice(0, 10))).catch(() => {});
  }, [fetchDrives]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-xl)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Dashboard</h1>
        <button className="btn btn-secondary btn-sm" onClick={() => fetchDrives()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Aggregate Quota */}
      {aggregate.driveCount > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
            <TrendingUp size={18} color="var(--accent-primary)" />
            <span style={{ fontWeight: 600 }}>Total Storage</span>
          </div>
          <QuotaBar used={aggregate.totalUsed} total={aggregate.totalQuota} />
          <div style={{ display: 'flex', gap: 'var(--space-xl)', marginTop: 'var(--space-md)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            <span>{formatFileSize(aggregate.totalFree)} free</span>
            <span>{aggregate.driveCount} drive{aggregate.driveCount > 1 ? 's' : ''} connected</span>
          </div>
        </div>
      )}

      {/* Per-Drive Quota */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {drives.map((drive, i) => (
          <div key={drive.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
              <div className="drive-dot" style={{ backgroundColor: getDriveColor(i), width: 10, height: 10 }} />
              <HardDrive size={16} />
              <span className="truncate" style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{drive.email}</span>
              {drive.isPrimary && <span className="badge" style={{ background: 'var(--accent-primary-subtle)', color: 'var(--accent-primary)' }}>Primary</span>}
            </div>
            <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={getDriveColor(i)} />
          </div>
        ))}
      </div>

      {/* Recent Files */}
      {recentFiles.length > 0 && (
        <div>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-md)' }}>Recent Files</h2>
          <div className="card" style={{ padding: 'var(--space-sm)' }}>
            {recentFiles.map((file) => {
              const driveIndex = drives.findIndex((d) => d.id === file.driveAccountId);
              return (
                <FileCard
                  key={file.id}
                  file={file}
                  driveColor={getDriveColor(driveIndex >= 0 ? driveIndex : 0)}
                />
              );
            })}
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/DashboardPage.tsx packages/web/src/components/FileCard.tsx
git commit -m "feat: add dashboard page — aggregate quota, per-drive cards, recent files"
```

---

### Task 20: Files Page

**Files:**
- Create: `packages/web/src/components/Breadcrumb.tsx`
- Create: `packages/web/src/components/FolderCard.tsx`
- Create: `packages/web/src/components/DropZone.tsx`
- Modify: `packages/web/src/pages/FilesPage.tsx`

- [ ] **Step 1: Create packages/web/src/components/Breadcrumb.tsx**

```tsx
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from '../types';

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="Folder navigation">
      {items.map((item, i) => (
        <span key={item.id ?? 'root'} className="breadcrumb-item">
          {i > 0 && <ChevronRight size={14} className="breadcrumb-separator" />}
          {i < items.length - 1 ? (
            <Link to={item.id ? `/files/${item.id}` : '/files'} className="breadcrumb-link">
              {item.name}
            </Link>
          ) : (
            <span className="breadcrumb-current">{item.name}</span>
          )}
        </span>
      ))}

      <style>{`
        .breadcrumb {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 2px;
          font-size: var(--font-size-sm);
        }
        .breadcrumb-item { display: flex; align-items: center; gap: 2px; }
        .breadcrumb-separator { color: var(--text-tertiary); }
        .breadcrumb-link { color: var(--text-secondary); }
        .breadcrumb-link:hover { color: var(--text-primary); }
        .breadcrumb-current { color: var(--text-primary); font-weight: 500; }
      `}</style>
    </nav>
  );
}
```

- [ ] **Step 2: Create packages/web/src/components/FolderCard.tsx**

```tsx
import { Link } from 'react-router-dom';
import { Trash2, Pencil } from 'lucide-react';
import type { VirtualFolder } from '../types';
import { useState } from 'react';

interface FolderCardProps {
  folder: VirtualFolder;
  onDelete?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
}

export function FolderCard({ folder, onDelete, onRename }: FolderCardProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className="folder-card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link to={`/files/${folder.id}`} className="folder-card-link">
        <span className="folder-card-icon">{folder.icon}</span>
        <span className="folder-card-name truncate">{folder.name}</span>
      </Link>
      {hovering && (
        <div className="folder-card-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.preventDefault();
              const newName = prompt('Rename folder:', folder.name);
              if (newName && newName !== folder.name) onRename?.(folder.id, newName);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.preventDefault();
              if (confirm(`Delete folder "${folder.name}"? Files will be moved to root.`)) {
                onDelete?.(folder.id);
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      <style>{`
        .folder-card {
          display: flex;
          align-items: center;
          padding: var(--space-md);
          border-radius: var(--radius-md);
          transition: background var(--transition-fast);
          position: relative;
        }
        .folder-card:hover { background: var(--bg-hover); }
        .folder-card-link {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          flex: 1;
          min-width: 0;
          text-decoration: none;
          color: inherit;
        }
        .folder-card-icon { font-size: 1.25rem; flex-shrink: 0; }
        .folder-card-name { font-weight: 500; }
        .folder-card-actions { display: flex; gap: 2px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Create packages/web/src/components/DropZone.tsx**

```tsx
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';

export function DropZone({ children }: { children: React.ReactNode }) {
  const addFiles = useUploadStore((s) => s.addFiles);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        addFiles(acceptedFiles);
      }
    },
    [addFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} style={{ position: 'relative', minHeight: '100%' }}>
      <input {...getInputProps()} />
      {children}
      {isDragActive && (
        <div className="dropzone-overlay">
          <div style={{ textAlign: 'center' }}>
            <Upload size={48} color="var(--accent-primary)" />
            <p style={{ marginTop: 'var(--space-md)', fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
              Drop files to upload
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Replace packages/web/src/pages/FilesPage.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFileStore } from '../stores/fileStore';
import { useUploadStore } from '../stores/uploadStore';
import { useDriveStore } from '../stores/driveStore';
import { Breadcrumb } from '../components/Breadcrumb';
import { FolderCard } from '../components/FolderCard';
import { FileCard } from '../components/FileCard';
import { DropZone } from '../components/DropZone';
import { UploadModal } from '../components/UploadModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { Upload, FolderPlus, Search, X } from 'lucide-react';
import { getDriveColor } from '../lib/utils';
import { useToastStore } from '../stores/toastStore';
import type { FileEntry } from '../types';

export function FilesPage() {
  const { folderId } = useParams();
  const { subfolders, files, breadcrumb, isLoading, searchResults, fetchContents, createFolder, deleteFolder, deleteFile, renameFile, searchFiles, clearSearch } = useFileStore();
  const { drives } = useDriveStore();
  const { showModal, setShowModal, addFiles } = useUploadStore();
  const { addToast } = useToastStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  useEffect(() => {
    fetchContents(folderId);
  }, [folderId, fetchContents]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchFiles(searchQuery.trim());
    }
  };

  const handleCreateFolder = () => {
    const name = prompt('New folder name:');
    if (name?.trim()) {
      createFolder(name.trim(), folderId).catch(() => addToast('error', 'Failed to create folder'));
    }
  };

  const handleDeleteFile = async (id: string) => {
    if (confirm('Delete this file permanently from Google Drive?')) {
      try {
        await deleteFile(id);
        addToast('success', 'File deleted');
      } catch {
        addToast('error', 'Failed to delete file');
      }
    }
  };

  const handleRenameFile = async (id: string, name: string) => {
    try {
      await renameFile(id, name);
      addToast('success', 'File renamed');
    } catch {
      addToast('error', 'Failed to rename file');
    }
  };

  const displayFiles = searchResults ?? files;

  return (
    <DropZone>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <Breadcrumb items={breadcrumb} />
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 'var(--space-xs)' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) clearSearch();
                }}
                style={{ width: 200, paddingRight: 28 }}
              />
              {searchResults && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}
                  onClick={() => { setSearchQuery(''); clearSearch(); }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </form>
          <button className="btn btn-secondary btn-sm" onClick={handleCreateFolder}>
            <FolderPlus size={16} /> New Folder
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.onchange = () => {
              if (input.files?.length) addFiles(Array.from(input.files));
            };
            input.click();
          }}>
            <Upload size={16} /> Upload
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="card" style={{ padding: 'var(--space-sm)' }}>
          {/* Folders */}
          {!searchResults && subfolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onDelete={(id) => deleteFolder(id).catch(() => addToast('error', 'Failed to delete folder'))}
              onRename={(id, name) => {
                // Inline rename via store update is possible but we keep it simple
                api.updateFolder(id, { name }).then(() => fetchContents(folderId));
              }}
            />
          ))}

          {/* Divider */}
          {!searchResults && subfolders.length > 0 && displayFiles.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: 'var(--space-xs) var(--space-md)' }} />
          )}

          {/* Files */}
          {displayFiles.map((file) => {
            const driveIndex = drives.findIndex((d) => d.id === file.driveAccountId);
            return (
              <FileCard
                key={file.id}
                file={file}
                driveColor={getDriveColor(driveIndex >= 0 ? driveIndex : 0)}
                onDelete={handleDeleteFile}
                onRename={handleRenameFile}
                onPreview={setPreviewFile}
              />
            );
          })}

          {/* Empty state */}
          {!searchResults && subfolders.length === 0 && files.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
              <p style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-sm)' }}>📂</p>
              <p>This folder is empty</p>
              <p style={{ fontSize: 'var(--font-size-sm)' }}>Drag & drop files here or click Upload</p>
            </div>
          )}

          {searchResults && displayFiles.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
              No files found for "{searchQuery}"
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showModal && <UploadModal folderId={folderId} onClose={() => setShowModal(false)} />}
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </DropZone>
  );
}

// Need to import api for folder rename
import { api } from '../lib/api';
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Breadcrumb.tsx packages/web/src/components/FolderCard.tsx packages/web/src/components/DropZone.tsx packages/web/src/pages/FilesPage.tsx
git commit -m "feat: add files page — folder browser, breadcrumb, drag & drop, search"
```

---

### Task 21: Settings Page

**Files:**
- Create: `packages/web/src/components/DriveAccountCard.tsx`
- Modify: `packages/web/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Create packages/web/src/components/DriveAccountCard.tsx**

```tsx
import { HardDrive, RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import type { DriveAccount } from '../types';
import { QuotaBar } from './QuotaBar';
import { formatFileSize, getDriveColor, formatRelativeTime } from '../lib/utils';
import { useState } from 'react';

interface DriveAccountCardProps {
  drive: DriveAccount;
  index: number;
  onSync: (id: string) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
}

export function DriveAccountCard({ drive, index, onSync, onDisconnect }: DriveAccountCardProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(drive.id); } finally { setSyncing(false); }
  };

  return (
    <div className="card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: getDriveColor(index), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HardDrive size={20} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{drive.email}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
              {drive.type === 'service_account' ? 'Service Account' : 'OAuth'}{drive.isPrimary ? ' · Primary' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'spinning' : ''} /> Sync
          </button>
          {!drive.isPrimary && (
            <button className="btn btn-danger btn-sm" onClick={() => {
              if (confirm(`Disconnect ${drive.email}? Files from this drive will be removed from Omnidrive.`)) {
                onDisconnect(drive.id);
              }
            }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={getDriveColor(index)} />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
        <span>{formatFileSize(drive.freeSpace)} free of {formatFileSize(drive.totalQuota)}</span>
        <span>{drive.usagePercent}% used</span>
      </div>

      <style>{`
        .spinning { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Replace packages/web/src/pages/SettingsPage.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useDriveStore } from '../stores/driveStore';
import { DriveAccountCard } from '../components/DriveAccountCard';
import { useToastStore } from '../stores/toastStore';
import { Plus, Key } from 'lucide-react';

export function SettingsPage() {
  const { drives, fetchDrives, removeDrive, triggerSync } = useDriveStore();
  const { addToast } = useToastStore();
  const [showSaForm, setShowSaForm] = useState(false);
  const [saCredentials, setSaCredentials] = useState('');
  const [saFolderId, setSaFolderId] = useState('');

  useEffect(() => {
    fetchDrives();
  }, [fetchDrives]);

  const handleSync = async (id: string) => {
    try {
      await triggerSync(id);
      addToast('success', 'Sync completed');
      fetchDrives();
    } catch {
      addToast('error', 'Sync failed');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await removeDrive(id);
      addToast('success', 'Drive disconnected');
      fetchDrives();
    } catch {
      addToast('error', 'Failed to disconnect drive');
    }
  };

  const handleAddServiceAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { api } = await import('../lib/api');
      await api.addServiceAccount(saCredentials, saFolderId);
      addToast('success', 'Service account added');
      setSaCredentials('');
      setSaFolderId('');
      setShowSaForm(false);
      fetchDrives();
    } catch {
      addToast('error', 'Failed to add service account');
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-xl)' }}>Drive Settings</h1>

      {/* Drive Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {drives.map((drive, i) => (
          <DriveAccountCard
            key={drive.id}
            drive={drive}
            index={i}
            onSync={handleSync}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {/* Add Drive Buttons */}
      <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
        <a href="/api/drives/connect" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          <Plus size={18} /> Add Google Drive
        </a>
        <button className="btn btn-secondary" onClick={() => setShowSaForm(!showSaForm)}>
          <Key size={18} /> Add Service Account
        </button>
      </div>

      {/* Service Account Form */}
      {showSaForm && (
        <form onSubmit={handleAddServiceAccount} className="card" style={{ marginTop: 'var(--space-lg)', maxWidth: 500 }}>
          <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-md)' }}>Add Service Account</h3>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Service Account JSON
            </label>
            <textarea
              value={saCredentials}
              onChange={(e) => setSaCredentials(e.target.value)}
              placeholder='Paste service account JSON key...'
              rows={6}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}
              required
            />
          </div>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Shared Folder ID
            </label>
            <input
              type="text"
              value={saFolderId}
              onChange={(e) => setSaFolderId(e.target.value)}
              placeholder="Google Drive folder ID shared with SA"
              style={{ width: '100%' }}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowSaForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Account</button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/DriveAccountCard.tsx packages/web/src/pages/SettingsPage.tsx
git commit -m "feat: add settings page — drive management, sync, service account form"
```

---

## Phase 11: Upload & Preview Modals

### Task 22: Upload Modal

**Files:**
- Create: `packages/web/src/components/UploadModal.tsx`

- [ ] **Step 1: Create packages/web/src/components/UploadModal.tsx**

```tsx
import { X, Upload, Check, AlertCircle, Loader } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import { useDriveStore } from '../stores/driveStore';
import { useFileStore } from '../stores/fileStore';
import { useToastStore } from '../stores/toastStore';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useState } from 'react';

interface UploadModalProps {
  folderId?: string;
  onClose: () => void;
}

export function UploadModal({ folderId, onClose }: UploadModalProps) {
  const { queue, isUploading, removeFile, startUpload, clearQueue } = useUploadStore();
  const { drives } = useDriveStore();
  const { fetchContents } = useFileStore();
  const { addToast } = useToastStore();
  const [selectedDriveId, setSelectedDriveId] = useState<string>('');

  const handleUpload = async () => {
    try {
      await startUpload(selectedDriveId || undefined, folderId);
      addToast('success', 'Upload completed');
      fetchContents(folderId);
    } catch {
      addToast('error', 'Upload failed');
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      clearQueue();
      onClose();
    }
  };

  const allDone = queue.every((item) => item.status === 'done' || item.status === 'error');

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done': return <Check size={16} color="var(--accent-success)" />;
      case 'error': return <AlertCircle size={16} color="var(--accent-danger)" />;
      case 'uploading':
      case 'confirming': return <Loader size={16} className="spinning" />;
      default: return null;
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Upload Files</h2>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}><X size={18} /></button>
        </div>

        {/* File list */}
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 'var(--space-lg)' }}>
          {queue.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }} className="truncate">{item.file.name}</span>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatFileSize(item.file.size)}</span>
              {item.status === 'uploading' && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-primary)', minWidth: 40, textAlign: 'right' }}>{item.progress}%</span>
              )}
              {statusIcon(item.status)}
              {item.status === 'pending' && !isUploading && (
                <button className="btn btn-ghost btn-sm" onClick={() => removeFile(item.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Drive selector */}
        {!isUploading && !allDone && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Target Drive
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: !selectedDriveId ? 'var(--accent-primary-subtle)' : 'transparent' }}>
                <input type="radio" name="drive" value="" checked={!selectedDriveId} onChange={() => setSelectedDriveId('')} />
                <span style={{ fontSize: 'var(--font-size-sm)' }}>Auto (most free space)</span>
              </label>
              {drives.map((drive, i) => (
                <label key={drive.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: selectedDriveId === drive.id ? 'var(--accent-primary-subtle)' : 'transparent' }}>
                  <input type="radio" name="drive" value={drive.id} checked={selectedDriveId === drive.id} onChange={() => setSelectedDriveId(drive.id)} />
                  <div className="drive-dot" style={{ backgroundColor: getDriveColor(i) }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', flex: 1 }}>{drive.email}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{formatFileSize(drive.freeSpace)} free</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          {allDone ? (
            <button className="btn btn-primary" onClick={handleClose}>Done</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleClose} disabled={isUploading}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={isUploading || queue.length === 0}>
                {isUploading ? <><Loader size={16} className="spinning" /> Uploading...</> : <><Upload size={16} /> Upload</>}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        .spinning { animation: spin 1s linear infinite; }
        input[type="radio"] { accent-color: var(--accent-primary); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/UploadModal.tsx
git commit -m "feat: add upload modal — file queue, drive selector, progress tracking"
```

---

### Task 23: File Preview Modal

**Files:**
- Create: `packages/web/src/components/FilePreviewModal.tsx`

- [ ] **Step 1: Create packages/web/src/components/FilePreviewModal.tsx**

```tsx
import { X, ExternalLink, Download } from 'lucide-react';
import type { FileEntry } from '../types';
import { formatFileSize, formatRelativeTime, getFileIcon } from '../lib/utils';

interface FilePreviewModalProps {
  file: FileEntry;
  onClose: () => void;
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const isImage = file.mimeType?.startsWith('image/');
  const isGoogleDoc = file.mimeType?.startsWith('application/vnd.google-apps.');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', minWidth: 0 }}>
            <span style={{ fontSize: '2rem' }}>{getFileIcon(file.mimeType)}</span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }} className="truncate">{file.name}</h2>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                {file.driveEmail}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Preview */}
        {isImage && file.thumbnailUrl && (
          <div style={{ marginBottom: 'var(--space-lg)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
            <img
              src={file.thumbnailUrl.replace('=s220', '=s600')}
              alt={file.name}
              style={{ width: '100%', maxHeight: 400, objectFit: 'contain' }}
            />
          </div>
        )}

        {!isImage && file.thumbnailUrl && (
          <div style={{ marginBottom: 'var(--space-lg)', display: 'flex', justifyContent: 'center', padding: 'var(--space-xl)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
            <img src={file.thumbnailUrl} alt={file.name} style={{ maxHeight: 200 }} />
          </div>
        )}

        {/* File Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', fontSize: 'var(--font-size-sm)' }}>
          <div>
            <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Size</div>
            <div>{formatFileSize(file.size)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Type</div>
            <div>{file.mimeType ?? 'Unknown'}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Modified</div>
            <div>{file.googleModifiedAt ? formatRelativeTime(file.googleModifiedAt) : '—'}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Created</div>
            <div>{file.googleCreatedAt ? formatRelativeTime(file.googleCreatedAt) : '—'}</div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
          {file.webViewLink && (
            <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              <ExternalLink size={16} /> Open in Drive
            </a>
          )}
          {file.webContentLink && !isGoogleDoc && (
            <a href={file.webContentLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              <Download size={16} /> Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/FilePreviewModal.tsx
git commit -m "feat: add file preview modal — thumbnail, metadata, download/open actions"
```

---

### Task 24: Final Integration + Verification

**Files:**
- Modify: `packages/worker/src/index.ts` (ensure final state)
- Verify build

- [ ] **Step 1: Verify worker compiles**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx tsc --noEmit`

Expected: No type errors. Fix any issues if they appear.

- [ ] **Step 2: Run all worker tests**

Run: `cd /home/bilfid/projects/omnidrive/packages/worker && npx vitest run`

Expected: All tests PASS (upload-router + breadcrumb).

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /home/bilfid/projects/omnidrive/packages/web && npx tsc --noEmit`

Expected: No type errors. Fix any issues if they appear.

- [ ] **Step 4: Verify frontend builds**

Run: `cd /home/bilfid/projects/omnidrive/packages/web && npx vite build`

Expected: Build succeeds, outputs to `dist/`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Omnidrive MVP — worker + frontend integrated"
```

---

## Deployment Checklist (Post-Implementation)

These steps are manual, done once after all tasks are complete:

1. **Google Cloud Console**: Create OAuth 2.0 credentials, add redirect URI
2. **Cloudflare Dashboard**: Create D1 database, create KV namespace, note IDs
3. **Update wrangler.toml**: Replace `database_id` and KV `id` with real values
4. **Set secrets**: `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
5. **Deploy worker**: `cd packages/worker && wrangler deploy`
6. **Deploy frontend**: `cd packages/web && npx wrangler pages deploy dist/`
7. **Run remote migration**: `cd packages/worker && npm run db:migrate:remote`
8. **Update env vars**: Set `FRONTEND_URL` and `WORKER_URL` to production URLs
