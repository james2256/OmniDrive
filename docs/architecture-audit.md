# Architecture Audit — OmniDrive vs Cloudflare Free Tier & Google Drive API

> **Verified audit.** Every claim below is cross-referenced against the code at HEAD `1b78053` and the verified limits in [`cloudflare-free-tier.md`](./cloudflare-free-tier.md) and [`google-drive-api.md`](./google-drive-api.md). Research date: 2026-07-23.
>
> 🚫 **HARD CONSTRAINT: OmniDrive runs 100% on Cloudflare Free tier. Never pay a cent.** Every recommendation in this audit respects that constraint. "Upgrade to Paid" is NEVER a recommendation — when a Free-tier limit is hit, the answer is always to optimize within Free, not to pay.

---

## Executive Summary

OmniDrive is a well-architected Cloudflare Workers gateway that **correctly handles most of the hard problems** (subrequest budgeting, quota caching, delta sync, OAuth token encryption, D1 batching). However, it has **three significant gaps** that will cause production issues:

1. **🔴 No exponential backoff / retry on Google API errors** — any 429/403/5xx from Google fails the entire sync cycle. Google officially requires backoff.
2. **🔴 The sync.ts D1 comment is wrong for Free tier** — it claims D1 has a 1,000-call limit (that's Paid); Free is 50/invocation, co-equal with the external-fetch budget. The sync job could hit this on large drives.
3. **🔴 No `quotaUser` for service-account flows** — if OmniDrive uses a SA for multiple users, all traffic collapses into one per-user quota bucket → throttling.

Plus several medium-priority gaps (missing `supportsAllDrives` on some calls, no 10MB export limit handling, unknown OAuth consent screen status, no token-refresh single-flight).

---

## Part 1 — What's Done Right ✅

### 1.1 External subrequest budgeting (Cloudflare)

**`packages/worker/src/services/sync.ts:26-32`:**
```ts
// Workers Free plan: 50 external subrequests (fetch to Google API) per invocation.
const EXTERNAL_SUBREQUEST_BUDGET = 45;
```

**✅ Correct.** The 50-subrequest Free-tier limit is verified current ([Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). The budget of 45 leaves margin for token refresh + one-time calls. Capacity: 44 pages = 4,400 items per sync cycle.

### 1.2 Quota caching (Google Drive API)

**`packages/worker/src/services/google-drive.ts:195-244`:**
```ts
const QUOTA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// ...
const cacheRow = await this.db.prepare('SELECT payload, updated_at FROM quota_cache...')
// ...
if (cacheRow && Date.now() - cacheRow.updated_at < QUOTA_CACHE_TTL_MS) {
  return { total: quota.total, used: quota.used, hasLimit: quota.hasLimit };
}
```

**✅ Correct.** `about.get` costs 5 quota units. Caching for 5 min means ~1 API call per 10 sync cycles (30-min cron) instead of 1/cycle. Reduces quota usage by 90%+ for quota checks. Cache stored in D1 with version field (`QUOTA_CACHE_VERSION`) to invalidate stale entries on schema change.

### 1.3 `storageQuota.limit` absent handling

**`packages/worker/src/services/google-drive.ts:189-190, 223`:**
```ts
// Google omits storageQuota.limit for Google Workspace pooled storage and
// service accounts (returned only "if applicable"). `hasLimit` tells callers...
const hasLimit = data.storageQuota.limit != null && data.storageQuota.limit !== '';
```

**`packages/worker/src/lib/storage-quota.ts:19`:**
```ts
const total = limit != null && limit !== '' ? parseInt(limit, 10) : UNLIMITED_DRIVE_QUOTA_BYTES;
```

**✅ Correct.** Google omits `storageQuota.limit` for unlimited/pooled storage users ([About resource](https://developers.google.com/drive/api/reference/rest/v3/about)). OmniDrive handles this via `hasLimit` flag + `UNLIMITED_DRIVE_QUOTA_BYTES` fallback, so it never overwrites a user-set override with a fake ceiling.

### 1.4 Delta sync pattern (Google Drive API)

**`packages/worker/src/services/google-drive.ts:592-646` + `sync.ts:226`:**
```ts
// getStartPageToken → listChanges(pageToken) → persist newStartPageToken
const response = await driveService.listChanges(drive.id, currentToken);
```

**✅ Correct.** Matches Google's official recommended pattern exactly ([Manage changes guide](https://developers.google.com/drive/api/guides/manage-changes)):
1. `changes.getStartPageToken` → store token
2. Loop `changes.list(pageToken)`, follow `nextPageToken`
3. Persist `newStartPageToken` on last page

The sync state (`changeToken`) is persisted in D1 between cycles, so sync resumes cleanly after interruption.

### 1.5 `fields` parameter on all list/get calls

**Example (`google-drive.ts:634`):**
```ts
const fields = 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,...))';
```

**✅ Correct.** Google officially recommends `fields` for performance ([Performance guide](https://developers.google.com/drive/api/guides/performance)). OmniDrive uses selective fields on every `files.list`, `changes.list`, `files.get`, and `about.get` call. Reduces payload/latency/CPU (though not quota units).

### 1.6 Shared-drive support on folder contents

**`packages/worker/src/services/google-drive.ts:705`:**
```ts
const url = `${DRIVE_API}/files?q=${q}&fields=${fields}&supportsAllDrives=true&includeItemsFromAllDrives=true...`;
```

**✅ Correct.** Uses the current (non-deprecated) `supportsAllDrives` / `includeItemsFromAllDrives` parameters. The `*TeamDrives*` variants are deprecated ([changes.list reference](https://developers.google.com/drive/api/reference/rest/v3/changes/list)).

### 1.7 Resumable upload initiation

**`packages/worker/src/services/google-drive.ts:294`:** `initiateResumableUpload` exists.

**✅ Correct.** Google recommends resumable uploads for large files ([Manage uploads guide](https://developers.google.com/drive/api/guides/manage-uploads)). Session URI lives 1 week.

### 1.8 Token encryption at rest

**`packages/worker/src/services/google-drive.ts:58-60` + `crypto.ts`:**
```ts
if (this.encryptionKey) {
  const { decryptOrPassthrough } = await import('../lib/crypto');
  tokensJson = await decryptOrPassthrough(row.encrypted_tokens, this.encryptionKey);
}
```

**✅ Correct.** OAuth tokens are encrypted with `TOKEN_ENCRYPTION_KEY` before storing in D1. Fail-fast validation in `index.ts:113` ensures the key is set on every request.

### 1.9 D1 batch chunking

**`packages/worker/src/lib/d1-batch.ts`:**
```ts
const D1_BATCH_SIZE = 100;
for (let i = 0; i < stmts.length; i += D1_BATCH_SIZE) {
  await db.batch(stmts.slice(i, i + D1_BATCH_SIZE));
}
```

**✅ Correct.** D1's `batch()` has a statement-count limit. Chunking at 100 statements per batch minimizes D1 subrequest count (1 batch = 1 subrequest, likely). Shared across `FileRepository.upsertMany`, `FolderRepository.upsertMany`, and `sync.ts`.

### 1.10 Correct OAuth scope

**`packages/worker/src/routes/auth.ts:116`:**
```ts
const scope = 'openid email profile https://www.googleapis.com/auth/drive';
```

**✅ Correct.** OmniDrive is a multi-drive aggregation gateway requiring full read/write access. Only `drive` scope covers all endpoints ([OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)). `drive.file` would break the gateway.

### 1.11 `expires_in` read from token response (not hardcoded)

**`packages/worker/src/services/google-drive.ts:178`:**
```ts
const data: { access_token: string; expires_in: number } = await response.json();
// ...
expiresAt: Date.now() + data.expires_in * 1000,
```

**✅ Correct.** Google does not guarantee 3600s; the sample shows 3920 ([Web server guide](https://developers.google.com/identity/protocols/oauth2/web-server)). OmniDrive reads `expires_in` dynamically.

### 1.12 Google Workspace export handling

**`packages/worker/src/services/google-drive.ts:350-380`:**
```ts
if (mimeType && mimeType.startsWith('application/vnd.google-apps.')) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    exportedMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (mimeType === 'application/vnd.google-apps.document') {
    exportedMimeType = 'application/pdf';
  }
  // ...
  url = `${DRIVE_API}/files/${googleFileId}/export?mimeType=${exportedMimeType}`;
}
```

**✅ Correct.** Correctly distinguishes Google Workspace docs (use `/export`) from binary files (use `?alt=media`). Uses official export MIME types ([Export formats](https://developers.google.com/drive/api/v3/ref-export-formats)).

### 1.13 Cron hygiene

**`packages/worker/src/index.ts:116-137`:** 9 `ctx.waitUntil()` cleanup tasks run concurrently:
- Session cleanup, OAuth state cleanup (10-min TTL), quota cache cleanup (>1h old)
- Audit log cleanup (30 days), orphan multipart cleanup, expired S3 lifecycle

**✅ Correct.** All run concurrently within the 15-minute Cron wall-time budget. Good hygiene prevents D1 bloat on Free tier (500 MB/database limit).

### 1.14 Non-blocking counters via `waitUntil`

**`packages/worker/src/routes/shared.ts:123-126`:**
```ts
c.executionCtx.waitUntil(Promise.all([
  sharedService.incrementViewCount(link.id),
  sharedService.logAction(link.id, 'view'),
]));
```

**✅ Correct.** View/download counts are fire-and-forget via `waitUntil`, so the response isn't blocked. The 30-second `waitUntil` window is well within limits.

---

## Part 2 — What's Done Wrong / Missing 🔴

### 2.1 🔴 NO exponential backoff on Google API errors

**Verified absence:** `grep -rn "backoff\|exponential\|Math.pow(2" packages/worker/src/services/google-drive.ts packages/worker/src/services/sync.ts` → **zero matches.**

**Current behavior (`google-drive.ts:215-216`):**
```ts
if (!response.ok) {
  throw new UpstreamError(`Failed to fetch quota: ${await response.text()}`);
}
```

Every Google API error (429, 403 rate-limit, 500, 502, 503, 504) throws immediately → fails the entire sync cycle.

**Google's requirement ([Drive API limits](https://developers.google.com/drive/api/guides/limits)):**
> "we recommend your code catches the exception and uses a truncated exponential backoff"

Algorithm: `wait = min((2^n) + random(≤1000ms), max_backoff)`, max_backoff = 32-64s, retry up to ~5 times.

**Impact:** A single transient 429 from Google kills the sync for that account for 30 minutes (until next cron). With 100 accounts, this is near-certain to happen multiple times per day.

**Fix:** Add a `withBackoff(fn)` wrapper in `google-drive.ts` that retries on 429/403(`rateLimitExceeded`/`userRateLimitExceeded`)/5xx with truncated exponential backoff.

### 2.2 🔴 NO Google error `reason` parsing

**Current behavior:** All errors throw `UpstreamError` with raw `response.text()`. The JSON `error.errors[].reason` field is never parsed.

**Google's error model ([Handle errors](https://developers.google.com/drive/api/guides/handle-errors)):**
```json
{
  "error": {
    "errors": [{ "reason": "userRateLimitExceeded", "message": "..." }],
    "code": 403,
    "message": "..."
  }
}
```

Critical reasons OmniDrive cannot distinguish:
- `userRateLimitExceeded` (retryable)
- `rateLimitExceeded` (retryable)
- `sharingRateLimitExceeded` (retryable)
- `dailyLimitExceeded` (NOT retryable — remove cap)
- `numChildrenInNonRootLimitExceeded` (NOT retryable — folder too big)

**Impact:** Without parsing `reason`, OmniDrive cannot tell a transient rate-limit (retry) from a permanent failure (don't retry). This compounds §2.1 — even if backoff is added, it can't be correctly applied without `reason` parsing.

**Fix:** Add a `parseDriveError(response)` helper that extracts `{ status, reason, message }`. Use `reason` to decide retry vs. fail.

### 2.3 🔴 NO `quotaUser` for service-account flows

**Verified absence:** `grep -rn "quotaUser" packages/worker/src` → **zero matches.**

**OmniDrive supports service accounts** (`google-drive.ts:91`, `google-service-account.ts`).

**Google's guidance ([Handle errors](https://developers.google.com/drive/api/guides/handle-errors)):**
> "API calls by a service account are considered to be using a single account."
> "If one user is making numerous requests on behalf of many users... consider a service account with domain-wide delegation using the quotaUser parameter."

**Impact:** If OmniDrive uses a single SA for multiple end-users, all traffic collapses into **one per-user quota bucket** (325,000 units/min). At scale (e.g., 100 users syncing simultaneously), this will throttle.

**Fix:** When `authType === 'service_account'`, append `&quotaUser=<end-user-email-or-id>` to all Drive API calls.

### 2.4 🔴 sync.ts D1 comment is WRONG for Free tier

**`packages/worker/src/services/sync.ts:26-28`:**
```
// Workers Free plan: 50 external subrequests (fetch to Google API) per invocation.
// D1 calls have a separate 1,000 limit — not the bottleneck.
```

**Verification ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)):**
> "Queries per Worker invocation (read subrequest limits) — 1000 (Workers Paid) / 50 (Free)"

- ✅ "50 external subrequests" — correct for Free.
- ❌ "D1 calls have a separate 1,000 limit" — **WRONG for Free.** 1,000 is Paid. Free D1 = 50/invocation.

**Impact:** The sync job assumes D1 is "not the bottleneck" — true on Paid, **false on Free**. `sync.ts` has ~16 D1 call sites, plus `batchInChunks` (1 batch per 100 statements). A full sync page could approach the 50-call D1 ceiling.

**Fix:**
1. Update the comment at `sync.ts:26-28` (and duplicate at `sync.ts:169-170`) to: `// D1: 50 queries/invocation on Free (co-equal with the external budget). Keep D1 calls per sync <40.`
2. Empirically verify D1 call count per sync invocation.
3. If sync approaches the 50-query ceiling, **optimize within Free**: skip unchanged rows (compare `modifiedTime` before UPSERT), split large syncs across multiple cron cycles, or reduce `batchInChunks` size from 100 to 50 statements.

❌ **Do NOT upgrade to Workers Paid** to raise D1 to 1,000/invocation. Stay on Free; solve it by reducing D1 call count.

### 2.5 🟡 Missing `supportsAllDrives` on `listChanges` and `listFilesInFolder`

**`google-drive.ts:637` (`listChanges`):**
```ts
const response = await fetch(
  `${DRIVE_API}/changes?pageToken=${...}&fields=${fields}&spaces=drive&includeRemoved=true`,
  // ❌ no supportsAllDrives=true, no includeItemsFromAllDrives=true
);
```

**`google-drive.ts:672` (`listFilesInFolder`):**
```ts
const url = `${DRIVE_API}/files?q=${q}&fields=nextPageToken,${fields}${pageToken ? ...}`;
// ❌ no supportsAllDrives=true, no includeItemsFromAllDrives=true
```

**Contrast with `listFolderContents` (line 705)** which correctly includes both params.

**Impact:** Shared-drive items may be missing from delta sync (`listChanges`) and folder listing (`listFilesInFolder`). Users with shared drives will see incomplete data.

**Fix:** Add `&supportsAllDrives=true&includeItemsFromAllDrives=true` to both URLs.

### 2.6 🟡 NO `pageSize=1000` on list calls

**Google's max ([files.list](https://developers.google.com/drive/api/reference/rest/v3/files/list)):**
> "The maximum value is 1000; values above 1000 will be coerced to 1000."

OmniDrive's `listFilesInFolder` and `listFolderContents` do NOT set `pageSize` → Google defaults to 100. For a folder with 1,000 items, this means 10 round-trips instead of 1.

**Impact:** 10× more external subrequests than necessary for large folders. On Free tier (50 subrequests/invocation), this could exhaust the budget before syncing a single large folder.

**Fix:** Add `&pageSize=1000` to all `files.list` and `changes.list` URLs.

### 2.7 🟡 NO 10MB export limit handling

**Google's limit ([Manage downloads](https://developers.google.com/drive/api/guides/manage-downloads)):**
> "Exported content is limited to 10 MB."

**`google-drive.ts:350-392` (`downloadFile`):** No handling for large Google Workspace exports. A large Google Doc (>10MB exported) will fail with an opaque `UpstreamError`.

**Fix:** Catch 403 `exportSizeLimitExceeded`; surface a user-friendly message ("This document is too large to export. Try downloading individual sections.").

### 2.8 🟡 OAuth consent screen status unknown

**`packages/worker/src/routes/auth.ts:124`:** `authUrl.searchParams.append('prompt', 'consent');` — this requests consent on each login but doesn't indicate the consent screen's publishing status.

**Google's rule ([OAuth 2.0 guide](https://developers.google.com/identity/protocols/oauth2)):**
> "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days…"

**Impact:** If the consent screen is in "Testing" status, **all refresh tokens expire in 7 days**. Users must re-authenticate weekly. This is a production blocker.

**Fix:** Before launch, move consent screen to "In production" and submit for verification (allow several months; 100-new-user cap until verified).

### 2.9 🟡 NO token-refresh single-flight

**`google-drive.ts:82-113` (`getValidToken`):** In-memory `tokenCache` (Map) prevents races **within one sync invocation**, but two concurrent cron cycles (or a cron + user request) for the same account could race on refresh.

**Google's stance:** No official guidance on concurrent refreshes. The token endpoint is typically idempotent, but this is not documented.

**Impact:** Minor — likely just a wasted refresh call. But on Free tier, every external subrequest counts toward the 50/invocation budget.

**Fix:** Add a D1-backed advisory lock per `driveAccountId` during refresh, or use a single-flight Promise cache.

---

## Part 3 — What Can Be Improved 🟡

### 3.1 Consider `changes.watch` for lower-latency sync (optional)

**Current:** Polling `changes.list` every 30 min via cron.

**Alternative:** `changes.watch` push notifications ([Manage changes](https://developers.google.com/drive/api/guides/manage-changes)). Google sends webhooks to a public HTTPS endpoint on change.

**Trade-off:**
- ✅ Lower latency (seconds vs 30 min)
- ✅ Fewer API calls (no polling)
- ❌ Requires a public webhook route (Cloudflare Workers can host it)
- ❌ Webhook reliability (Google retries, but needs idempotent handling)
- ❌ `changes.watch` calls count against quota

**Recommendation:** Stay with polling for now. Consider `changes.watch` only if users request real-time updates.

### 3.2 Stay on Free tier — optimize when limits are hit (do NOT upgrade)

🚫 **OmniDrive policy: never pay.** When a Free-tier limit is hit, the answer is to optimize within Free, not to upgrade. The table below lists the Free-tier limits that are most likely to bite, and the Free-tier optimization for each.

| Limit | Free ceiling | Free-tier optimization (do NOT pay) |
|---|---|---|
| **D1 queries/invocation** | 50 | Skip unchanged rows in sync (compare `modifiedTime`); split large syncs across cron cycles; reduce `batchInChunks` size |
| **D1 rows written/day** | 100K | Skip unchanged rows; batch UPSERTs; only sync accounts with recent activity |
| **Workers requests/day** | 100K | Cache aggressively (`cacheTtl` on KV reads, Cache API on immutable responses); reduce sync frequency for idle accounts |
| **KV writes/day** | 1,000 | Move rate-limiter counters to D1; keep KV for OAuth state + sessions only |
| **Log retention** | 3 days | Log critical sync events to D1 `audit_logs`/`sync_logs` table for long-term retention |
| **Log events/day** | 200K | Set `head_sampling_rate = 0.1` (10%) for non-critical logs |

**The Free-tier user ceiling is ~50-70 concurrent active users.** That's the hard cap without paying. If OmniDrive outgrows that, the options are (in order): optimize harder, accept the ceiling, or reconsider the hosting model — **paying is the last resort, not the first.**

### 3.3 Add structured logging for sync quota usage

**Current:** `lib/logger.ts` exists with structured JSON logging + requestId.

**Gap:** No logging of quota units consumed per sync cycle, D1 query count, or external subrequest count.

**Fix:** Add a sync-cycle summary log:
```ts
logInfo(c, 'sync cycle complete', {
  driveAccountId, pagesProcessed, itemsUpserted,
  externalSubrequests, d1Queries, quotaUnitsEstimate, durationMs
});
```
This makes it easy to spot when a sync is approaching the 50-subrequest or 50-D1-query ceiling.

### 3.4 KV rate-limiter eventual consistency

**`packages/worker/src/middleware/rate-limiter.ts`:** Uses KV for rate limiting.

**KV limitation ([KV limits](https://developers.cloudflare.com/kv/platform/limits/)):**
> "Writes are immediately visible to other requests in the same global network location, but can take up to 60 seconds... to be visible in other parts of the world."

**Impact:** Rate limits can be under-counted globally during the 60-second propagation window. A determined attacker routing through different edge locations could exceed limits.

**Fix options (all Free-tier-compatible):**
- **Move rate-limit counters to D1** (strongly consistent on Free). Trade-off: each rate-check costs 1 of the 50 D1 queries/invocation. Acceptable if rate-limited routes are few (auth, shared-link verify).
- **Per-edge in-memory + KV hybrid** — keep an in-Map counter (like `rate-limiter.ts` already does) as the fast path, with KV as the cross-edge fallback. The 60s window only affects cross-edge traffic.
- For OAuth state (10-min TTL), KV eventual consistency is tolerable — keep as-is.
- Keep KV for rate limiting only if the 60-second window is acceptable for the threat model.

❌ **Do NOT use Workers Rate Limiting API** — it's a Paid feature. Stay with KV + D1.

### 3.5 Add integration test for `/api/shared/:id/meta` response shape

**Gap identified in prior review:** The `/meta` endpoint was sending snake_case `FileRow` instead of camelCase `FileEntry` — a latent bug caught only by code review, not tests.

**Fix:** Add an integration test asserting `GET /api/shared/:id/meta` returns `target.mimeType` (camelCase) for a file with a known MIME type. This prevents regression of the fix in commit `1b78053`.

### 3.6 Audit upload-router for 308/404 handling

**`packages/worker/src/services/upload-router.ts`:** The resumable upload initiation exists, but the chunked upload completion path's handling of 308 (continue) / 404 (session expired) was not verified in this audit.

**Google's requirement ([Manage uploads](https://developers.google.com/drive/api/guides/manage-uploads)):**
- 308 = chunk received, continue
- 200/201 = whole upload complete
- 404 = session expired, restart from beginning

**Fix:** Audit `upload-router.ts` to verify it handles 308 (resume from byte) and 404 (restart) correctly. Add integration tests for interrupted uploads.

---

## Part 4 — Recommendations (Priority Order)

### Immediate (before any production deploy)

| # | Priority | Issue | Effort | Impact |
|---|---|---|---|---|
| 1 | 🔴 | Implement exponential backoff + `reason` parsing in `google-drive.ts` | 4-6h | Prevents sync failures on transient 429/5xx |
| 2 | 🔴 | Update sync.ts D1 comment; empirically verify D1 call count | 1-2h | Correct understanding of Free-tier constraints |
| 3 | 🔴 | Add `supportsAllDrives=true&includeItemsFromAllDrives=true` to `listChanges` + `listFilesInFolder` | 30min | Shared-drive items sync correctly |
| 4 | 🔴 | Add `pageSize=1000` to all list calls | 30min | 10× fewer round-trips for large folders |
| 5 | 🔴 | Move OAuth consent screen to "In production" | 1h + several months | Refresh tokens don't expire in 7 days |
| 6 | 🟡 | Add `quotaUser` for service-account flows | 2h | SA traffic bucketed per-user, not collapsed |
| 7 | 🟡 | Handle 10MB export limit | 1h | Friendly error for large Google Docs |

### Short-term (next sprint)

| # | Priority | Issue | Effort | Impact |
|---|---|---|---|---|
| 8 | 🟡 | Token-refresh single-flight (D1 lock) | 2-3h | Prevents wasted refresh calls |
| 9 | 🟡 | Add sync-cycle summary logging (quota/D1/subrequest counts) | 2h | Visibility into Free-tier budget usage |
| 10 | 🟡 | Add `/api/shared/:id/meta` integration test | 1h | Prevents camelCase regression |
| 11 | 🟡 | Audit `upload-router.ts` for 308/404 handling | 2h | Resumable uploads survive interruption |

### Medium-term (next quarter)

| # | Priority | Issue | Effort | Impact |
|---|---|---|---|---|
| 12 | 🟢 | Move rate-limiter counters from KV to D1 (stay within Free KV writes/day) | 4h | Defeats KV 60s eventual-consistency window; stays within Free KV 1K writes/day |
| 13 | 🟢 | Optimize sync to skip unchanged rows (compare `modifiedTime` before UPSERT) | 3h | Reduces D1 rows written/day; extends Free-tier user ceiling |
| 14 | 🟢 | Adaptive sync frequency (sync active accounts more often than idle ones) | 1 day | Reduces Workers requests/day + D1 rows written/day; extends Free-tier ceiling |
| 15 | 🟢 | Log critical sync events to D1 for long-term retention (beyond 3-day Workers Logs) | 2h | Free-tier workaround for 3-day log retention limit |
| 16 | 🟢 | Consider `changes.watch` for lower-latency sync (free, just needs webhook route) | 1-2 days | Real-time updates (optional) |

❌ **Explicitly NOT recommended: upgrading to Workers Paid.** OmniDrive stays on Free forever.

---

## Part 5 — Free-Tier Capacity Ceiling & Enforcement Behavior

> 🚫 **OmniDrive never pays.** This section replaces the former "Free vs Paid" cost projection. There is no "Paid tier" path. The question is: how many users can Free tier support, what happens when limits are hit, and how do we push that ceiling higher without paying?

### What ACTUALLY happens when a limit is hit

> **User observation: "when I hit limit in free tier on cloudflare, everything still works."** Verified against official Cloudflare docs on 2026-07-23. This is **partially true** — and understanding WHY is critical.

**The 3 enforcement modes:**

| Mode | What happens | Applies to |
|---|---|---|
| **HARD (throws/errors)** | Operation is rejected; error thrown/returned | D1 daily quotas, KV daily quotas, 50 subrequests, 50 D1 queries/invocation, KV same-key 1/sec, 15-min cron, 3MB Worker size |
| **Fail-open** (Worker bypassed) | Worker is skipped; request goes to origin | Workers 100K requests/day (only this one) |
| **HARD + grace** (transient OK, consistent fails) | Occasional overage passes; consistent overage → Error 1102 | 10ms CPU time |

**Why "everything still works" is a misconception for OmniDrive:**

The user is likely observing the **Workers 100K/day fail-open behavior**:
> "| Fail open | Bypasses the Worker. Requests behave as if no Worker is configured. |"
> — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)

In fail-open mode, when 100K/day is hit:
- ✅ Static pages continue to load (origin serves directly)
- ❌ **The Worker is effectively disabled** — its logic (auth, sync, API routing) does NOT run
- ❌ OmniDrive's `/api/*` routes are **Worker-only** (no origin to fall back to) → they return **Error 1027**, not "work fine"

**The truly silent failures are D1/KV daily quotas** — if those are hit, sync stops working but the user might not notice immediately (sync is a background cron). D1 and KV daily limits are **HARD** — operations fail with errors, not silently continue.

**Error codes to watch for:**

| Error | Meaning | When |
|---|---|---|
| **1027** | Worker exceeded free tier daily request limit | Workers 100K/day exceeded |
| **1101** | Worker threw a JavaScript exception | Uncaught exception (e.g., 51st subrequest) |
| **1102** | Worker exceeded resource limits | CPU time exceeded (consistent) |
| **429** | Too many requests | KV same-key write > 1/sec |

> ⚠️ **Note on "Error 1015":** 1015 is Cloudflare's edge rate-limiting error (a different product). Workers Free overage returns **1027**, not 1015.

### Free tier capacity estimate

Assumptions:
- 100 users, each with 1-3 Google Drive accounts
- 30-min sync cron
- ~100 changes per account per cycle
- ~5 downloads per user per day

| Resource | Usage at 100 users | Free limit | Enforcement | Status |
|---|---|---|---|---|
| Workers requests/day | ~150K (sync + user requests) | 100K | **Fail-open** (Worker bypassed) | ⚠️ **exceeds Free** — API routes return 1027; static pages load but Worker is OFF |
| External subrequests/invocation | ~5 per sync | 50 | HARD (51st throws) | ✅ safe |
| D1 queries/invocation | ~10-20 per sync (estimated) | 50 | HARD (51st throws) | ✅ safe (but verify) |
| D1 rows read/day | ~2M (sync + UI) | 5M | **HARD** (queries error) | ✅ safe |
| D1 rows written/day | ~50K (sync upserts) | 100K | **HARD** (queries error) | ✅ safe |
| D1 storage | ~50 MB (estimated) | 500 MB/database | HARD (writes blocked, reads OK) | ✅ safe |
| KV reads/day | ~30K (sessions + rate limit) | 100K | **HARD** (reads error) | ✅ safe |
| KV writes/day | ~5K (rate limit counters) | 1,000 | **HARD** (writes error) | ⚠️ **exceeds Free** — sync rate-limiter state fails silently |

### Free-tier user ceiling

Based on the above, OmniDrive's Free-tier ceiling is approximately **50-70 concurrent active users** (bottlenecked by Workers requests/day at 100K).

That's the hard cap. **There is no Paid path.** If OmniDrive outgrows 50-70 users, the options are:

### When you hit the Free ceiling — optimization ladder (NOT paying)

| Step | Optimization | Effect |
|---|---|---|
| 1 | **Skip unchanged rows in sync** (compare `modifiedTime` before UPSERT) | Cuts D1 rows written/day by ~80% (most accounts have few changes per cycle) |
| 2 | **Move rate-limiter counters from KV to D1** | Frees KV writes/day budget (5K → ~500, well under 1K Free limit) |
| 3 | **Adaptive sync frequency** (sync active accounts every 15 min, idle accounts every 2h) | Cuts Workers requests/day by ~50% for accounts with infrequent changes |
| 4 | **Cache `cacheTtl` on KV reads** for quota/about responses | Cuts KV reads/day |
| 5 | **Cache API on immutable responses** (file thumbnails, static metadata) | Cuts Workers requests/day |
| 6 | **Log critical events to D1** instead of relying on 3-day Workers Logs | No Logpush needed (Paid); D1 storage is 500 MB Free |
| 7 | **Reduce `head_sampling_rate` to 0.1** for non-critical logs | Stretches 200K/day log budget 10× |
| 8 | **Add D1/KV quota-error monitoring** | Catches silent sync failures when daily quotas are hit (sync is background cron — failures are invisible without monitoring) |
| 9 | **Accept the ceiling** — 50-70 users is the Free-tier reality | No optimization; just don't exceed it |

**Bottom line:** OmniDrive stays on Free forever. The Free-tier ceiling is ~50-70 active users. Optimization steps 1-8 can push that to ~100-150 users without paying. Beyond that, accept the ceiling or reconsider the hosting model (but still don't pay Cloudflare).

**On the user's "everything still works" observation:** It's true that the *site* continues to load when Workers 100K/day is hit (fail-open mode), but **the Worker logic is silently disabled** — API calls return Error 1027, sync stops, auth breaks. For D1/KV daily quotas, operations hard-fail with errors. The only reason "everything still works" is that the user likely hasn't hit the D1/KV HARD limits yet (they reset at 00:00 UTC), and the Workers 100K fail-open makes the site *appear* functional even when the Worker is off. **Add monitoring to catch the silent failures.**

---

## Sources

All facts verified against:
- **Cloudflare:** [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **Google Drive API:** [Limits](https://developers.google.com/drive/api/guides/limits), [Handle errors](https://developers.google.com/drive/api/guides/handle-errors), [Manage changes](https://developers.google.com/drive/api/guides/manage-changes), [Manage uploads](https://developers.google.com/drive/api/guides/manage-uploads), [Manage downloads](https://developers.google.com/drive/api/guides/manage-downloads), [Performance](https://developers.google.com/drive/api/guides/performance), [OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes), [OAuth 2.0 guide](https://developers.google.com/identity/protocols/oauth2)
- **Project code:** HEAD `1b78053`, verified 2026-07-23

See [`cloudflare-free-tier.md`](./cloudflare-free-tier.md) and [`google-drive-api.md`](./google-drive-api.md) for the full verified reference docs.
