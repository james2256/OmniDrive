# DEBUGGING.md — Debugging Guide

How to find and fix issues in OmniDrive. This guide covers local dev, production, and common pitfalls.

---

## 1. Local Development Debugging

### 1.1 Worker logs (Wrangler)

The worker runs on `http://localhost:8888`. All logs appear in the terminal where `npm run dev` is running.

**Structured JSON logs** — every error log is a JSON line with these fields:

```json
{
  "ts": "2026-07-22T12:00:00.000Z",
  "level": "error",
  "msg": "Unhandled server error",
  "requestId": "abc-123-def",
  "path": "/api/files/file-1",
  "err": "D1_ERROR: no such table: users",
  "errorClass": "Error",
  "stack": "at D1DatabaseSession..."
}
```

Filter by `requestId` to trace a single request across multiple log lines.

### 1.2 Web (Vite) logs

Vite logs appear in the `[web]` prefixed lines. Errors are usually:
- **Proxy errors** (`ECONNREFUSED 127.0.0.1:8888`) — worker not running. Start it in a separate terminal.
- **Module not found** — run `npm install` in `packages/web`.

### 1.3 Browser DevTools

- **Network tab** → any `/api/*` request → check the `x-request-id` response header. Use this ID to grep worker logs.
- **Application tab** → Cookies → `omnidrive_sid` — if missing, the user is logged out.

---

## 2. Production Debugging

### 2.1 `wrangler tail` (live logs)

```bash
cd packages/worker
npx wrangler tail
```

Shows real-time logs from the deployed worker. Filter by `requestId`:

```bash
npx wrangler tail --format pretty | grep "abc-123"
```

### 2.2 D1 queries (remote)

```bash
# List all users
npx wrangler d1 execute omnidrive --remote --command "SELECT id, username, is_super_admin FROM users"

# Check a specific file
npx wrangler d1 execute omnidrive --remote --command "SELECT * FROM files WHERE id = 'file-abc'"

# Check sessions for a user
npx wrangler d1 execute omnidrive --remote --command "SELECT id, expires_at, touched_at FROM sessions WHERE user_id = 'user-xyz'"
```

### 2.3 D1 queries (local)

Same commands but with `--local` instead of `--remote`:

```bash
npx wrangler d1 execute omnidrive --local --command "SELECT * FROM users"
```

### 2.4 KV inspection

```bash
# List all keys
npx wrangler kv key list --binding KV

# Get a specific key
npx wrangler kv key get --binding KV "shared_verify_lock:link-abc"
```

---

## 3. Common Issues & Fixes

### "Environment validation failed" (JWT_SECRET undefined)

**Cause:** Wrangler can't find secrets.

**Fix:** Ensure `packages/worker/.dev.vars` exists with:
```
JWT_SECRET=<32+ char string>
TOKEN_ENCRYPTION_KEY=<32+ char string>
WORKER_URL=http://localhost:8888
FRONTEND_URL=http://localhost:8999
```

Generate with:
```bash
node -e "console.log('JWT_SECRET=' + crypto.randomUUID().replace(/-/g,''))"
```

### "no such table: users"

**Cause:** D1 migrations haven't run or ran against a different database.

**Fix:**
```bash
cd packages/worker
npm run db:migrate:local    # local
npm run db:migrate:remote   # production
```

### "Cannot find package '@vitejs/plugin-react'"

**Cause:** npm workspace didn't install web package deps.

**Fix:**
```bash
cd packages/web
npm install
```

### "ECONNREFUSED 127.0.0.1:8888"

**Cause:** Worker not running. Vite proxy can't reach it.

**Fix:** Start the worker in a separate terminal:
```bash
cd packages/worker
npm run dev
```

### 403 Forbidden on file operations

**Cause:** RBAC check failed. The user's role doesn't have the required permission.

**Where to look:**
- `packages/worker/src/services/file.service.ts` → `assertCanMutate(file, userId, 'editor')`
- `packages/worker/src/services/shared.service.ts` → `assertCanShare(userId, targetType, targetId)`
- `packages/worker/src/middleware/rbac.ts` → `hasPermission(role, requiredRole)`

**Role hierarchy:** viewer (1) → auditor (1) → commenter (2) → editor (3) → manager (4) → owner (5)

### 429 Too Many Requests

**Cause:** Rate limiter triggered.

**Where to look:** `packages/worker/src/middleware/rate-limiter.ts`

**Limits:**
- Login: 10 per minute per IP
- Register: 10 per 10 minutes per IP
- Shared link verify: 5 per minute per IP+link
- Shared link download: 20 per minute per IP+link
- Global API: 100 per minute per IP
- S3 API: 100 per minute per IP

### Session expires quickly

**Cause:** Session TTL is 7 days, but only refreshed if untouched >1 hour.

**Where to look:** `packages/worker/src/middleware/auth-guard.ts` → `EXTENSION_THRESHOLD = 60 * 60 * 1000` (1 hour)

### Google Drive sync fails

**Cause:** OAuth token expired or Google API error.

**Where to look:**
- `packages/worker/src/services/sync.ts` → `syncDriveAccount()`
- `packages/worker/src/services/google-drive.ts` → `getValidToken()` (auto-refreshes)
- Check the `sync_state` table: `SELECT * FROM sync_state WHERE drive_account_id = ?`

---

## 4. Reset Local Database

```bash
cd packages/worker
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local
```

---

## 5. Debug Tests

### Run a single test file

```bash
cd packages/worker
npx vitest run tests/s3-api.test.ts
```

### Run with verbose output

```bash
npx vitest run --reporter verbose
```

### Debug integration tests (real D1)

```bash
cd packages/worker
npx vitest run --config vitest.integration.config.mts tests/integration/auth-flow.test.ts
```

### View D1 state after integration tests

Integration tests use Miniflare's local D1. The SQLite file is at:
```
packages/worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/
```

Query it:
```bash
npx wrangler d1 execute omnidrive --local --command "SELECT * FROM users"
```
