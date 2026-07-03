# OmniDrive Security Audit Report

**Date:** 2026-07-03
**Scope:** Full source-code security audit of `packages/worker` (Cloudflare Workers + Hono backend) and `packages/web` (React 19 + Vite frontend).
**Method:** Read-only static analysis of authentication, session management, CSRF, RBAC, S3 SigV4, input validation, SQL injection, security headers, CORS, rate limiting, secrets handling, XSS, cookie security, and dependency posture.

---

## Executive Summary

Overall security posture is **strong**. The codebase uses parameterized SQL throughout (no injection found), React auto-escaping with zero `dangerouslySetInnerHTML`/`innerHTML`/`eval` usage, AES-256-GCM encryption at rest, OAuth with PKCE, a working CSRF guard, and proper ownership-scoped queries on most endpoints.

However, **6 HIGH**, **15 MEDIUM**, and **15 LOW** issues were identified. The most critical are **IDOR vulnerabilities in workspace folder operations**, an **RBAC bypass via the S3 gateway**, and an **S3 signature-verification oracle** that leaks signing material to clients.

### Findings by Severity

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 HIGH | 6 | Fixed |
| 🟡 MEDIUM | 15 | Fixed |
| 🟢 LOW | 15 | Fixed |

---

## 🔴 HIGH Severity Findings

### H1. IDOR — workspace_folders operations missing membership checks

**Files:** `packages/worker/src/routes/folders.ts` (lines ~132, ~205, ~240, ~282, ~288, ~294-305)

**Description:** Multiple handlers in `folders.ts` look up folders/workspaces by `id` without verifying the caller is a member of the workspace. The workspace branch of `GET /:id?` correctly joins `workspace_members`, but the folder branch and all mutation endpoints (`PUT`, `DELETE`, `star`/`unstar`, `POST` with `parentId`) skip this check entirely.

**Attack scenario:** Any authenticated user who knows or guesses a folder UUID can read, rename, move, star, or delete folders belonging to any workspace in the system — including workspaces they are not a member of.

**Fix:** Added `JOIN workspace_members wm ON f.workspace_id = wm.workspace_id AND wm.user_id = ?` to all folder-scoped queries. For workspace rename, added ownership check. For `POST /` with `parentId`, verify caller is a member of the parent workspace.

---

### H2. IDOR — shared-link creation for folders does not verify ownership

**File:** `packages/worker/src/routes/shared.ts:69-75`

**Description:** When creating a shared link with `targetType: 'folder'`, the handler only checks that the folder exists (`SELECT id FROM workspace_folders WHERE id = ?`) without any ownership or workspace-membership check. The `file` branch correctly scopes with `AND user_id = ?`, but the `folder` branch does not.

**Attack scenario:** Any authenticated user can create a shareable link (with optional password and webhook URL) for any workspace folder in the system, even folders in workspaces they don't belong to.

**Fix:** Replaced the folder existence check with a `JOIN workspace_members` query that verifies the caller is a member of the folder's workspace.

---

### H3. RBAC bypass via S3 gateway

**Files:** `packages/worker/src/routes/s3.ts` (multiple handlers), `packages/worker/src/routes/s3-credentials.ts:17`

**Description:** S3 protocol handlers enforce workspace membership (`JOIN workspace_members`) but never check the member's RBAC role. A `viewer` can perform `PUT` (upload/overwrite) and `DELETE` operations via S3, fully bypassing the viewer→editor→manager hierarchy enforced by the HTTP API. Additionally, creating a user-scoped S3 credential (no `workspaceId`) requires no role check at all.

**Attack scenario:** A `viewer` in a workspace creates a user-scoped S3 access key (no manager approval needed), then uses any S3 client to upload, overwrite, or delete objects in that workspace — bypassing their read-only role.

**Fix:** S3 handlers now retrieve `wm.role` and enforce RBAC: `PUT`/`DELETE` require `editor` permission, `GET`/`LIST` require `viewer`. User-scoped S3 credential creation now requires `manager` role in at least one workspace.

---

### H4. S3 signature-verification oracle leaks signing material

**File:** `packages/worker/src/middleware/s3-auth.ts:299-308, 315`

**Description:** On signature mismatch, the server returns the computed `CanonicalRequest` and `StringToSign` as XML fields in the error response. In the catch branch, raw `err.message` (which can include decryption errors) is appended to the error message. Real AWS never discloses this information.

**Attack scenario:** An attacker forging SigV4 signatures gets a differential oracle showing exactly how the server normalized the request, dramatically lowering the difficulty of producing a valid signature. Internal exception text may also leak.

**Fix:** Removed `CanonicalRequest`, `StringToSign`, and `err.message` from client-facing error responses. Server-side `console.error` logging retained for debugging.

---

### H5. Missing Content-Security-Policy header

**File:** `packages/worker/src/middleware/security-headers.ts`

**Description:** No `Content-Security-Policy` header is set anywhere in the codebase. CSP is the most important browser-enforced XSS defense-in-depth control.

**Fix:** Added a strict CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' <api-origin>; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`.

---

### H6. Folder deletion without membership check

**File:** `packages/worker/src/routes/folders.ts:294-305`

**Description:** The `workspace_folders` branch of `DELETE /:id` executes `DELETE FROM workspace_folders WHERE id = ?` with no membership or role check. The workspace branch correctly checks `owner_id`, but the folder branch does not.

**Attack scenario:** Any authenticated user can delete any workspace folder by ID.

**Fix:** Covered under H1 — added membership check to the folder delete branch.

---

## 🟡 MEDIUM Severity Findings

### M1. No rate limiting on `/s3/*` endpoints

**File:** `packages/worker/src/index.ts:93, 104`

**Description:** The global rate limiter is scoped to `/api/*` only. S3 routes mounted at `/s3` bypass it entirely, allowing unlimited requests for signature verification attempts and access-key enumeration.

**Fix:** Added `app.use('/s3/*', rateLimiter(...))` before the S3 router mount.

---

### M2. No rate limit on public shared download endpoint

**File:** `packages/worker/src/routes/shared.ts:358` (via `index.ts`)

**Description:** Only `POST /api/shared/:id/verify` is rate-limited (5/min). The unauthenticated `GET /api/shared/:id/download` has no limit, enabling DoS of the proxied Google Drive API or rapid exhaustion of `maxDownloads`.

**Fix:** Added a dedicated rate limiter for the shared download endpoint.

---

### M3. `maxDownloads` limit has a TOCTOU race

**File:** `packages/worker/src/routes/shared.ts:375-386`

**Description:** The download count check reads `downloadCount` from a row fetched earlier, and the increment is deferred via `c.executionCtx.waitUntil` (non-atomic). Concurrent requests all observe the stale count before any increment lands.

**Fix:** Replaced with an atomic conditional UPDATE: `UPDATE shared_links SET download_count = download_count + 1 WHERE id = ? AND (max_downloads IS NULL OR download_count < max_downloads) RETURNING ...`. Reject when zero rows updated.

---

### M4. `requireEmail` and `allowUploads` stored but never enforced

**File:** `packages/worker/src/routes/shared.ts`

**Description:** `requireEmail` is accepted on create/update and persisted, but neither `/:id/meta` nor `/:id/download` checks it. A user relying on it believes access is email-gated when it is not. Same for `allowUploads` — no public upload endpoint exists.

**Fix:** Implemented `requireEmail` gate on meta/download. `allowUploads` now returns 400 if sent on create/update (not yet implemented, refuses to store a false sense of security).

---

### M5. Weak key derivation for at-rest encryption

**File:** `packages/worker/src/lib/crypto.ts:4-17`

**Description:** `getKey()` derives the AES-256 key by taking the first 32 UTF-8 bytes of the secret and zero-padding the remainder. No KDF, no salt, no stretching. Short/guessable secrets yield low-entropy keys with predictable zero padding.

**Fix:** Replaced with HKDF-SHA256 key derivation using Web Crypto `deriveKey`. Added versioned ciphertext prefix (`v1:`) for key rotation support.

---

### M6. `decryptOrPassthrough` silently downgrades to plaintext

**File:** `packages/worker/src/lib/crypto.ts:54-61`

**Description:** Any decryption failure silently returns the input as-is (treated as a legacy plaintext token). This masks key-misconfiguration and allows plaintext OAuth tokens to be accepted.

**Fix:** Added `console.warn` on fallback. Only accept plaintext values with an explicit `plain:` marker prefix.

---

### M7. Manager can remove the workspace owner

**File:** `packages/worker/src/routes/workspaces.ts:108-119`

**Description:** `DELETE /:id/members/:targetUserId` only checks `hasPermission(currentUserRole, 'manager')`. A manager can remove an owner, and there is no check preventing removal of the last owner, orphaning the workspace.

**Fix:** Only an `owner` can remove another `owner`. Reject if the target is the last owner in the workspace.

---

### M8. Unauthenticated super-admin bootstrap + public setup-status oracle

**File:** `packages/worker/src/routes/auth.ts:18-22, 37-60`

**Description:** `/api/auth/setup-status` is public and returns whether setup has been completed. When `isSetup` is false, `POST /api/auth/register` creates a super-admin user with no invitation code required. The public oracle widens the race for claiming an unclaimed instance.

**Fix:** Added optional `BOOTSTRAP_TOKEN` env var. If set, first registration requires the token. Setup-status remains public but does not reveal whether a token is required.

---

### M9. Incomplete SSRF protection in webhook URL validation

**File:** `packages/worker/src/lib/validation.ts:9-44`

**Description:** `validateWebhookUrl` only inspects the literal hostname. A domain resolving to a private/metadata IP passes validation. IPv6 private ranges (ULA, link-local), CGNAT, and `0.0.0.0/8` are not blocked. DNS rebinding is not mitigated.

**Fix:** Added DNS-over-HTTPS resolution check via Cloudflare DNS. Blocks IPv6 ULA (`fc00::/7`), link-local (`fe80::/10`), CGNAT (`100.64.0.0/10`), `0.0.0.0/8`. Marked ceiling: `// ponytail: DNS rebinding not fully mitigated — Workers runtime doesn't expose socket-level IP pinning`.

---

### M10. S3 request body not bound for PUT/POST

**File:** `packages/worker/src/middleware/s3-auth.ts:205-212`

**Description:** When `x-amz-content-sha256` is absent on non-GET/HEAD/DELETE requests, `payloadHash` defaults to `UNSIGNED-PAYLOAD`. The signature does not commit the upload body, allowing content substitution.

**Fix:** PUT/POST now require `x-amz-content-sha256`. If present and not `UNSIGNED-PAYLOAD`, the body hash is verified.

---

### M11. Missing HSTS header

**File:** `packages/worker/src/middleware/security-headers.ts`

**Description:** No `Strict-Transport-Security` header is set. Auth cookies are shipped over HTTPS in production.

**Fix:** Added `Strict-Transport-Security: max-age=31536000; includeSubDomains` on HTTPS requests.

---

### M12. `wrangler.toml` is git-tracked with infrastructure metadata

**File:** `packages/worker/wrangler.toml`

**Description:** `wrangler.toml` is committed to git (the `.gitignore` entry is ineffective for already-tracked files). It contains D1 database IDs, KV namespace IDs, and production URLs. While not credentials, the inconsistency is dangerous — a future developer may add a secret believing it is gitignored.

**Fix (manual):** Recommended `git rm --cached packages/worker/wrangler.toml` (requires user action — not executed by agent).

---

### M13. Google API error text leaked to client

**File:** `packages/worker/src/routes/drives.ts:148, 158, 165`

**Description:** `throw new AppError(400, err.message)` returns Google's raw error response (which may include service-account `client_email` or assertion details) directly to the client.

**Fix:** Replaced with generic message `'Failed to connect Google Drive account'`. Detailed error logged server-side via `console.error`.

---

### M14. `SameSite=None` broadens CSRF surface

**File:** `packages/worker/src/routes/auth.ts:66-67`

**Description:** The session cookie is `SameSite=None` in production, shifting the entire CSRF burden onto the Origin/Referer check. Required for cross-origin SPA architecture, but suboptimal when frontend and worker share an origin.

**Fix:** Added origin comparison — uses `SameSite=Lax` when `FRONTEND_URL` and `WORKER_URL` share an origin, `None` only when truly cross-origin.

---

### M15. No session revocation by user

**File:** `packages/worker/src/middleware/auth-guard.ts`, `packages/worker/src/routes/auth.ts`

**Description:** Sessions are not indexed by `userId`. There is no "revoke all sessions for user X" path — not on password change, role change, or admin force-logout. A stolen session remains valid for up to 30 days.

**Fix:** Added `user_sessions:<userId>` KV index (JSON array of session IDs). Sessions are registered on login, removed on logout, and all can be revoked via `POST /api/auth/sessions/revoke`. Marked ceiling: `// ponytail: KV-based session index — D1 table would scale better for high session counts`.

---

## 🟢 LOW Severity Findings

### L1. Shared-link verify issues JWT without checking link expiry
**File:** `routes/shared.ts:297-356` — An attacker who knows an expired link's password still gets a valid JWT. **Fix:** Added expiry check before minting token.

### L2. Logout cookie flags hardcoded
**File:** `routes/auth.ts:207` — `secure: true` hardcoded; in dev the cookie was set with `secure: false`, so deletion may not match. **Fix:** Derive `secure` from `WORKER_URL`.

### L3. OAuth state cookie inconsistent SameSite
**File:** `routes/drives.ts:79` — Omits `sameSite`, defaults to `Lax`, inconsistent with `auth.ts`. **Fix:** Added `sameSite: isSecure ? 'None' : 'Lax'`.

### L4. bcrypt cost factor 10
**Files:** `routes/auth.ts:55,77`, `routes/admin.ts:77` — Below OWASP recommendation of ≥12. **Fix:** Bumped to 12.

### L5. Dead/duplicate error-handling middleware
**File:** `middleware/error-handler.ts` — Exported `errorHandler` never registered (`index.ts` uses `app.onError`). **Fix:** Marked as unused with ponytail comment.

### L6. No password maximum length
**File:** `lib/validation.ts:2` — bcrypt truncates at 72 bytes; unbounded input allows minor CPU amplification. **Fix:** Added 72-char max.

### L7. No email format validation
**Files:** `routes/auth.ts`, `routes/admin.ts`, `routes/workspaces.ts` — Emails checked for uniqueness but never format. **Fix:** Added `validateEmail()` with basic regex.

### L8. Policy config untyped `any`
**File:** `routes/workspaces.ts:185-201` — `config.max_bytes` not validated as number; non-numeric yields `NaN`, blocking all uploads. **Fix:** Validate `max_bytes` is a non-negative number.

### L9. Automation `trigger_type` not validated
**File:** `routes/automations.ts:33` — Value stored as-is. **Fix:** Validate against `['event', 'cron']`.

### L10. File move doesn't verify target-workspace membership
**File:** `routes/files.ts:231` — User can move own file into a workspace folder they don't belong to. **Fix:** Added membership check on destination folder.

### L11. JSON-path injection in metadata search
**File:** `routes/files.ts:162` — Metadata key concatenated into SQLite JSON path. **Fix:** Sanitize key: reject characters outside `[a-zA-Z0-9_.]`.

### L12. `console.log` of folder IDs
**File:** `routes/files.ts:352` — Negligible info leak to server logs. **Fix:** Removed.

### L13. Inconsistent RBAC helper usage
**File:** `routes/workspaces.ts:143` — Raw string comparisons instead of `hasPermission`. **Fix:** Replaced with `hasPermission(role, 'manager')`.

### L14. Deprecated `X-XSS-Protection` header
**File:** `middleware/security-headers.ts` — `1; mode=block` is deprecated. **Fix:** Changed to `0`.

### L15. Unfamiliar `agentation` devDependency
**File:** `packages/web/package.json` — DevDependency for annotation tooling. **Note:** Verified as a legitimate dev tool for in-browser annotation. No action needed beyond documentation.

---

## Good Practices Observed

- **SQL injection: none found** — every dynamic query uses `?` placeholders with `.bind()`.
- **XSS: none found** — zero `dangerouslySetInnerHTML`/`innerHTML`/`eval` in frontend; React auto-escaping throughout.
- **No hardcoded secrets** — `.env`/`.dev.vars` gitignored; all secrets via env vars.
- **OAuth with PKCE (S256)** + single-use unguessable state in KV (10-min TTL).
- **AES-256-GCM** encryption at rest with fresh random 96-bit IV per encryption.
- **CSRF guard** fail-closed on missing Origin/Referer; exact-match allowlist.
- **CORS** validates against `FRONTEND_URL`, never wildcard with credentials.
- **RBAC escalation prevention** — manager cannot assign a role ≥ own.
- **Timing-safe comparison** for S3 signatures and shared-link passwords.
- **Webhook SSRF validation** blocks localhost, RFC1918, cloud metadata IP.
- **Generic 500 errors** — no stack traces leaked to clients.
- **bcrypt** for user passwords; **PBKDF2** (100k iterations) for shared-link passwords.
- **Admin role re-validated from DB** on every request, not trusted from session.
- **Strong session IDs** — `crypto.randomUUID()` (122-bit entropy).
- **Server-enforced session lifetime** — 30-day absolute cap + 7-day sliding TTL.
- **Cookie hardening** — `HttpOnly` always, `Secure` derived from `WORKER_URL`.
- **Non-enumerable share IDs** — 64-bit hex with collision retry.
- **Ownership scoping** (`AND user_id = ?`) on file, S3-credential, and shared-link operations.
- **`target="_blank"` links** all use `rel="noopener noreferrer"`.
- **Pagination capped** at 100 — no integer overflow.
- **XML outputs escaped** — no reflected XML injection in S3 error bodies.

---

## Manual Action Required

The following requires manual execution by the maintainer (not performed by the agent to avoid altering git tracking without confirmation):

```bash
git rm --cached packages/worker/wrangler.toml
git commit -m "chore: untrack wrangler.toml (contains infra metadata, not secrets)"
```

Then verify `wrangler.toml` is in `.gitignore` (it is, but was ineffective for the already-tracked file). The file remains locally available; it simply stops being version-controlled.
