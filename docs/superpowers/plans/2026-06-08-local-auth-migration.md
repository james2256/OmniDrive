# Local Authentication Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the authentication flow to use local username and password, relegating Google Drive connection to a secondary post-login step.

**Architecture:** We will add local auth endpoints (`/register`, `/login`) to the Cloudflare Worker using `bcryptjs` for password hashing. We will update the SQLite database schema to accommodate local user credentials while making Google-specific fields optional. The frontend will have a new username/password form, and the main dashboard will prompt the user to connect Google Drive if none are linked.

**Tech Stack:** React, Vite, Tailwind CSS, Cloudflare Workers, Hono, SQLite (D1), bcryptjs.

---

### Task 1: Update Database Schema

**Files:**
- Modify: `packages/worker/src/db/schema.sql`

- [ ] **Step 1: Update the users table schema**

Replace the existing `users` table definition with the following:

```sql
-- packages/worker/src/db/schema.sql
-- Users (from local auth and Google OAuth)
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    google_id       TEXT UNIQUE,
    email           TEXT UNIQUE,
    name            TEXT,
    avatar_url      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Run local database migration**

Run: `npm run db:migrate:local` inside `packages/worker/`
Expected: Success message indicating the schema was applied (or syntax OK).

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/db/schema.sql
git commit -m "feat: update users schema for local auth"
```

### Task 2: Install Dependencies and Update Types

**Files:**
- Modify: `packages/worker/package.json`
- Modify: `packages/worker/src/types/env.ts`

- [ ] **Step 1: Install bcryptjs**

Run: `npm install bcryptjs` and `npm install -D @types/bcryptjs` inside `packages/worker/`
Expected: PASS

- [ ] **Step 2: Update SessionData type**

In `packages/worker/src/types/env.ts`, update `SessionData`:

```typescript
export interface SessionData {
  userId: string;
  username: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/worker/package.json packages/worker/package-lock.json packages/worker/src/types/env.ts
git commit -m "chore: add bcryptjs and update session type"
```

### Task 3: Implement Auth Routes

**Files:**
- Modify: `packages/worker/src/routes/auth.ts`

- [ ] **Step 1: Add register and login endpoints**

Replace the top imports and add the unauthenticated routes before `authGuard`.

```typescript
// packages/worker/src/routes/auth.ts
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import * as bcrypt from 'bcryptjs';
import type { AppContext, SessionData } from '../types/env';
import { AuthService } from '../services/auth.service';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';

export const authRouter = new Hono<AppContext>({ strict: false });

authRouter.post('/register', async (c) => {
  const { username, password, email } = await c.req.json();
  if (!username || !password) throw new AppError(400, 'Username and password required');

  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) throw new AppError(400, 'Username already exists');

  const id = generateId();
  const passwordHash = await bcrypt.hash(password, 10);
  
  await db.prepare(
    'INSERT INTO users (id, username, password_hash, email, name) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, username, passwordHash, email || null, username).run();

  const sessionData: SessionData = { userId: id, username, email: email || null, name: username, avatarUrl: null };
  const sessionId = generateId();
  
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
  setCookie(c, 'omnidrive_sid', sessionId, { path: '/', secure: true, httpOnly: true, sameSite: 'None', maxAge: 60 * 60 * 24 * 7 });

  return c.json({ success: true, user: sessionData });
});

authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) throw new AppError(400, 'Username and password required');

  const user = await c.env.DB.prepare('SELECT id, username, password_hash, email, name, avatar_url FROM users WHERE username = ?').bind(username).first<any>();
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'Invalid credentials');
  }

  const sessionData: SessionData = { userId: user.id, username: user.username, email: user.email, name: user.name, avatarUrl: user.avatar_url };
  const sessionId = generateId();
  
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
  setCookie(c, 'omnidrive_sid', sessionId, { path: '/', secure: true, httpOnly: true, sameSite: 'None', maxAge: 60 * 60 * 24 * 7 });

  return c.json({ success: true, user: sessionData });
});

// Protected routes below
authRouter.use('*', authGuard);

// We will move Google OAuth below authGuard!
```

- [ ] **Step 2: Update Google OAuth flow**

Update the `/google` and `/callback` endpoints to rely on `authGuard`. Replace the existing `/google` and `/callback` logic with this (must be placed AFTER `authRouter.use('*', authGuard);`):

```typescript
authRouter.get('/google', (c) => {
  const env = c.env;
  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const scope = 'openid email profile https://www.googleapis.com/auth/drive';
  
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'consent');
  
  const state = crypto.randomUUID();
  setCookie(c, 'oauth_state', state, { path: '/', httpOnly: true, secure: true, maxAge: 60 * 5 });
  authUrl.searchParams.append('state', state);

  return c.redirect(authUrl.toString());
});

authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) throw new AppError(400, 'Authorization code missing');

  const state = c.req.query('state');
  const savedState = getCookie(c, 'oauth_state');
  if (!state || state !== savedState) {
    throw new AppError(400, 'Invalid state parameter');
  }
  deleteCookie(c, 'oauth_state', { path: '/' });

  const env = c.env;
  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const authService = new AuthService(env);

  const tokens = await authService.exchangeCodeForTokens(code, redirectUri);
  const googleUser = await authService.fetchUserInfo(tokens.accessToken);

  // User MUST be logged in to reach here (authGuard enforces this)
  const targetUserId = c.get('userId'); 
  const db = env.DB;

  // Link google account to local user
  await db.prepare('UPDATE users SET google_id = ?, email = COALESCE(email, ?), name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?) WHERE id = ?')
    .bind(googleUser.id, googleUser.email, googleUser.name, googleUser.picture, targetUserId).run();

  let drive = await db.prepare('SELECT id FROM drive_accounts WHERE google_account_id = ? AND user_id = ?').bind(googleUser.id, targetUserId).first<{ id: string }>();
  if (!drive) {
    const driveId = generateId();
    const res = await db.prepare('SELECT COUNT(*) as count FROM drive_accounts WHERE user_id = ?').bind(targetUserId).first<{ count: number }>();
    const isPrimary = (res && res.count === 0) ? 1 : 0;

    await db.prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(driveId, targetUserId, googleUser.id, googleUser.email, googleUser.name, 'oauth', isPrimary).run();
    drive = { id: driveId };
  }
  await env.KV.put(`tokens:${drive.id}`, JSON.stringify(tokens));

  return c.redirect(`${env.FRONTEND_URL}/`);
});

authRouter.get('/me', (c) => {
  return c.json({ user: c.get('session') });
});

authRouter.post('/logout', async (c) => {
  const sid = getCookie(c, 'omnidrive_sid');
  if (sid) {
    await c.env.KV.delete(`session:${sid}`);
  }
  deleteCookie(c, 'omnidrive_sid', { path: '/', secure: true, sameSite: 'None' });
  return c.json({ success: true });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/auth.ts
git commit -m "feat: implement local auth endpoints and update oauth flow"
```

### Task 4: Frontend API Updates

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add login and register to API client**

In `packages/web/src/lib/api.ts`, add the two new methods in the `Auth` section inside the `api` object:

```typescript
export const api = {
  // Auth
  login: (data: any) => request<{ success: boolean; user: import('../types').User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: any) => request<{ success: boolean; user: import('../types').User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  getUser: () => request<{ user: import('../types').User }>('/api/auth/me'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  // ... rest of the api object ...
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat: add login and register to API client"
```

### Task 5: Frontend Auth Pages

**Files:**
- Modify: `packages/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Implement the username/password form**

Replace the entire content of `LoginPage.tsx` with this new version:

```tsx
// packages/web/src/pages/LoginPage.tsx
import { useState } from 'react';
import { api } from '../lib/api';

export function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      if (isRegister) {
        await api.register({ username, password, email });
      } else {
        await api.login({ username, password });
      }
      window.location.href = '/';
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-blue-200 opacity-30 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-indigo-200 opacity-30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl shadow-blue-900/10 border border-white/60 p-10 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">OmniDrive</h1>
          <p className="text-gray-500 text-sm mb-8">
            Your unified Google Drive gateway
          </p>

          {errorMsg && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input type="text" required value={username} onChange={e => setUsername(e.target.value)} className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500" />
            </div>
            
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500" />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500" />
            </div>

            <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors mt-2">
              {isRegister ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6">
            <button onClick={() => setIsRegister(!isRegister)} className="text-sm text-blue-600 hover:underline">
              {isRegister ? 'Already have an account? Sign in' : 'Need an account? Register'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/LoginPage.tsx
git commit -m "feat: implement local auth forms in login page"
```

### Task 6: Frontend Dashboard Empty State

**Files:**
- Modify: `packages/web/src/pages/FilesPage.tsx`

- [ ] **Step 1: Update empty state to link directly to Google OAuth**

In `packages/web/src/pages/FilesPage.tsx`, locate the empty drives block (`drives.length === 0 ? ...`) and replace it with:

```tsx
        ) : drives.length === 0 ? (
          <div className="text-center p-12 text-gray-500 border rounded-lg bg-white m-4 flex flex-col items-center shadow-sm">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
               <Info size={24} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Google Drive Connected</h3>
            <p className="mb-6 max-w-sm text-center">You need to connect at least one Google Drive account to start using OmniDrive.</p>
            <a href={`${import.meta.env.VITE_API_URL || ''}/api/auth/google`} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-colors">
              Connect Google Drive Now
            </a>
          </div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/FilesPage.tsx
git commit -m "feat: improve empty state and add direct google connection link"
```
