# Cloudflare Free Tier — Verified Limits Reference

> **Editing context for OmniDrive.** All numbers verified against official Cloudflare docs on 2026-07-23. Each entry cites the source URL and quotes the doc. Use this when modifying Workers/D1/KV usage or the sync budget.
>
> 🚫 **HARD CONSTRAINT: OmniDrive must run 100% on Cloudflare Free tier. Never pay a cent.** Every design decision, every optimization, every recommendation in this doc assumes Free tier only. The "Paid" column in tables below is shown **for reference only** — it is NOT an upgrade path. All bottlenecks must be solved within Free limits.

## TL;DR — The limits that actually constrain OmniDrive (Free tier only)

| Resource | Free limit | Enforcement | Bottleneck risk | Free-tier mitigation |
|---|---|---|---|---|
| **Workers requests** | 100,000/day | **Fail-open** (Worker bypassed, origin serves) | Medium at scale | Keep sync lightweight; cache aggressively |
| **Workers CPU time** | 10 ms/invocation | HARD + grace (Error 1102 on consistent overage) | Low | Sync is I/O-bound, not CPU |
| **External subrequests** | **50/invocation** | **HARD** (51st throws) | **Medium** | Sync budget is 45 ✅ already correct |
| **D1 queries per invocation** | **50/invocation** | **HARD** (51st throws) | **HIGH** | Keep D1 calls per sync <40; use `db.batch()` |
| **D1 rows read** | 5 million/day | **HARD** (queries error) | Low | Add indexes; avoid `SELECT *` scans |
| **D1 rows written** | 100,000/day | **HARD** (queries error) | Low-medium | Batch upserts; skip unchanged rows |
| **D1 storage** | 500 MB/database | **HARD** (writes blocked, reads OK) | Low | Cron cleanup of old logs/sessions ✅ already done |
| **KV reads** | 100,000/day | **HARD** (reads error) | Low | — |
| **KV writes** | 1,000/day | **HARD** (writes error) | **Medium** | Move rate-limiter counters to D1 (see §KV) |
| **KV same-key writes** | 1/sec | **HARD** (429 throws) | Low | Backoff on 429 |
| **KV storage** | 1 GB | HARD (writes blocked) | Low | — |
| **Cron triggers** | 5/account, min 1-min interval | HARD (deploy rejects) | Low | OmniDrive uses 1 (every 30 min) |
| **Cron wall time** | 15 min/invocation | **HARD** (killed at 15 min) | Low | Sync budget is 45 pages; well under 15 min |
| **Workers Logs** | 200K events/day, **3-day retention** | UNKNOWN at 200K cap | Medium | Log critical events to D1 for long-term retention |
| **Workers Builds** | 3,000 min/month, 1 concurrent | HARD (build queues/rejects) | Low | — |

---

## 🚦 What ACTUALLY happens when you hit a limit (enforcement behavior)

> **User observation: "when I hit limit in free tier on cloudflare, everything still works."** This is **partially true** — and understanding WHY is critical. Verified against official Cloudflare docs on 2026-07-23.

### The 3 enforcement modes

| Mode | What happens | User-visible result |
|---|---|---|
| **HARD (throws/errors)** | The operation is rejected; an error is thrown or returned | Request fails with an error code |
| **Fail-open** (Workers requests/day only) | The Worker is **bypassed**; the request goes straight to the origin | Site appears to load, but **Worker logic is silently OFF** |
| **HARD + grace** (CPU time only) | Occasional overages pass silently; consistent overage is terminated | Intermittent errors under sustained load |

### Why "everything still works" — the likely explanation

The user's observation is almost certainly because of the **Workers 100K requests/day limit in fail-open mode**:

> "When a Worker exceeds this limit, Cloudflare returns Error 1027."
> "| Fail open | Bypasses the Worker. Requests behave as if no Worker is configured. |"
> — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)

In fail-open mode, when the 100K/day limit is hit:
- ✅ The site continues to load (the origin serves the request directly)
- ❌ **The Worker is effectively disabled** — its logic (auth, sync, API routing) does NOT run
- ❌ API calls to `/api/*` will likely fail (no origin to fall back to — they're Worker-only routes)

**This is NOT "everything still works."** It's "static pages still load, but the dynamic Worker is off."

### The limits that HARD-fail (these DO break things)

These limits are **HARD** — when exceeded, operations fail with errors. The user likely has NOT hit these yet (they reset at midnight UTC):

| Limit | What fails | Error | Source |
|---|---|---|---|
| **D1 5M rows read/day** | All D1 queries error | "D1 API will return errors indicating daily limits exceeded" | [D1 pricing FAQ](https://developers.cloudflare.com/d1/platform/pricing/#frequently-asked-questions) |
| **D1 100K rows written/day** | All D1 queries error | Same as above | Same |
| **D1 500MB database size** | INSERTs/CREATE/ALTER fail | "Exceeded maximum DB size" | [D1 error list](https://developers.cloudflare.com/d1/observability/debug-d1/#error-list) |
| **KV 100K reads/day** | KV reads throw | "further operations of that type will fail with an error" | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers-kv) |
| **KV 1K writes/day** | KV writes throw | Same as above | Same |
| **KV 1K deletes/day** | KV deletes throw | Same as above | Same |
| **KV 1 write/sec same key** | Second write throws | `"KV PUT failed: 429 Too Many Requests"` | [KV write API](https://developers.cloudflare.com/kv/api/write-key-value-pairs/) |
| **50 subrequests/invocation** | 51st fetch/KV/D1 call throws | Runtime JS exception (1101 if uncaught) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests) |
| **50 D1 queries/invocation** | 51st D1 query throws | D1_ERROR | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| **10ms CPU (consistent)** | Request terminated | Error 1102 "Worker exceeded resource limits" | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) |
| **15-min Cron wall time** | Cron killed at 15 min | In-flight work lost (may retry) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#wall-time-limits-by-invocation-type) |

### Error code reference (for debugging)

| Error code | Meaning | When |
|---|---|---|
| **1027** | Worker exceeded free tier daily request limit | Workers 100K/day exceeded |
| **1101** | Worker threw a JavaScript exception | Uncaught exception (e.g., from 51st subrequest) |
| **1102** | Worker exceeded resource limits | CPU time exceeded (consistent) |
| **10021** | Script startup exceeded CPU time limit | Deploy-time validation (1s startup) |
| **413** | Request entity too large | KV value > 25 MiB |
| **429** | Too many requests | KV same-key write > 1/sec |

> ⚠️ **Note on "Error 1015":** Many people confuse this with Workers Free overage. **1015 is Cloudflare's edge rate-limiting error** (a different product). Workers Free overage returns **1027**, not 1015.

### What this means for OmniDrive

- **If the user sees "everything still works"**: they're either (a) under the D1/KV daily quotas (which reset at 00:00 UTC), or (b) hitting Workers 100K/day in fail-open mode (static pages load, but `/api/*` routes are broken).
- **OmniDrive's `/api/*` routes are Worker-only** (no origin to fail-open to) — so if Workers 100K/day is hit, **API calls will return Error 1027**, not "work fine."
- **The truly silent failures are D1/KV daily quotas** — if those are hit, sync stops working but the user might not notice immediately (sync is a background cron).

**Action:** Add monitoring that logs when D1/KV errors are encountered, so silent sync failures are caught. OmniDrive's `lib/logger.ts` already supports structured logging — extend it to flag D1/KV quota errors specifically.

---

## ⚠️ Critical: The sync.ts D1 comment is WRONG for Free tier

**`packages/worker/src/services/sync.ts:26-28`** says:
```
// Workers Free plan: 50 external subrequests (fetch to Google API) per invocation.
// D1 calls have a separate 1,000 limit — not the bottleneck.
```

**Verification:**
- ✅ "50 external subrequests per invocation" — **CORRECT** for Free.
- ❌ "D1 calls have a separate 1,000 limit" — **WRONG for Free.** 1,000 is the **Paid** limit. On **Free, D1 = 50 queries per invocation** — the same magnitude as the external budget.

**Source (D1 limits page):**
> "Queries per Worker invocation (read subrequest limits) — 1000 (Workers Paid) / 50 (Free)"
> — https://developers.cloudflare.com/d1/platform/limits/

**Impact:** `sync.ts` has ~16 D1 call sites, and `batchInChunks` sends 1 `db.batch()` per 100 statements (each batch = 1 D1 subrequest). A full sync page (1 external fetch + 1 batch upsert + ~3-5 `sync_state`/token calls) sits close to the 50-call D1 ceiling. **D1 is NOT "not the bottleneck" on Free — it's co-equal with the external budget.**

**Action:** Re-validate D1 call count per sync invocation empirically. Update the comment at `sync.ts:26-28` (and the duplicate at `sync.ts:169-170`) to reflect the Free-tier D1 limit of 50.

---

## Workers (Free plan) — full verified limits

Source: https://developers.cloudflare.com/workers/platform/limits/ *(Last updated Jul 5, 2026)*

| Limit | Free | Paid ($5/mo) |
|---|---|---|
| Requests | **100,000/day** (resets midnight UTC) | 10M/month included + $0.30/M |
| CPU time (HTTP request) | **10 ms** | 30M CPU-ms/month + $0.02/M; max 5 min/invocation |
| CPU time (Cron Trigger) | **10 ms** | max 30s (<1hr interval) |
| Wall time (HTTP) | Unlimited (while client connected); `waitUntil` extends 30s after response | same |
| Wall time (Cron) | **15 minutes** | 15 minutes |
| **External subrequests/invocation** | **50** | 10,000 (up to 10M) |
| Subrequests to internal services (KV/R2) | 1,000 | 10,000 (default) |
| Memory | 128 MB | 128 MB |
| Worker size (compressed) | **3 MB** | 10 MB |
| Worker size (uncompressed) | 64 MB | 64 MB |
| Env vars per Worker (secrets + text) | 64 | 128 |
| Env var size | 5 KB | 5 KB |
| Startup time | 1 second | 1 second |
| Cron triggers per account | **5** | 250 |
| Workers per account | 100 | 500 |
| Simultaneous open connections | 6 (fetch/KV/D1/R2/WebSockets) | 6 |
| Log data per request | 256 KB | 256 KB |
| Request body size | 100 MB | 100 MB |

**On the "10 ms vs 50 ms" confusion:** The 50 ms figure is the **deprecated Bundled plan**, not Free. Bundled plans are "deprecated and no longer available for new accounts." **Free = 10 ms.**

**What counts as a subrequest?**
> "A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1. Each subrequest in a redirect chain counts against this limit."
> — Workers limits page

---

## D1 (Free tier) — full verified limits

Sources:
- Limits: https://developers.cloudflare.com/d1/platform/limits/ *(Last updated Apr 21, 2026)*
- Pricing: https://developers.cloudflare.com/d1/platform/pricing/ *(Last updated Apr 21, 2026)*

| Limit | Free | Paid |
|---|---|---|
| Storage per account | **5 GB** | 1 TB |
| Max database size | **500 MB** | 10 GB (cannot be increased further) |
| Databases per account | **10** | 50,000 |
| **Queries per Worker invocation** | **50** | 1,000 |
| Simultaneous connections per invocation | 6 | 6 |
| Rows read / day | **5 million** | 25B/month included + $0.001/M |
| Rows written / day | **100,000** | 50M/month included + $1.00/M |
| Max SQL statement length | 100 KB | 100 KB |
| Max bound parameters | 100 | 100 |
| Max query duration | 30 seconds | 30 seconds |
| Max columns per table | 100 | 100 |
| Max string/BLOB/row | 2 MB | 2 MB |
| Time Travel retention | 7 days | 30 days |

**"Rows read" definition:**
> "Rows read measure how many rows a query reads (scans), regardless of the size of each row."
> — D1 pricing page

**No "1,000 rows written per query" hard limit exists.** The 1,000 figure is a *batching guideline*, not a limit. Hard per-query limits are: 100 KB statement, 100 bound params, 30s duration.

**Does `db.batch(100 statements)` count as 1 or 100 toward the 50-query Free cap?**
The Workers limits page defines a subrequest as "any request... to D1" (implying 1 batch call = 1 subrequest), and the KV page explicitly says "A bulk request... counts for 1 request." D1 has no equally explicit statement. **Most likely interpretation: 1 `db.batch()` = 1 query/subrequest** — but this should be verified empirically.

---

## KV (Free tier) — full verified limits

Sources:
- Limits: https://developers.cloudflare.com/kv/platform/limits/ *(Last updated Apr 21, 2026)*
- Pricing: https://developers.cloudflare.com/kv/platform/pricing/ *(Last updated Apr 21, 2026)*
- Write API: https://developers.cloudflare.com/kv/api/write-key-value-pairs/ *(Last updated Jun 22, 2026)*

| Limit | Free | Paid |
|---|---|---|
| Reads | **100,000/day** | 10M/month + $0.50/M |
| Writes | **1,000/day** | 1M/month + $5.00/M |
| Deletes | **1,000/day** | 1M/month + $5.00/M |
| List requests | **1,000/day** | 1M/month + $5.00/M |
| Storage | **1 GB** | 1 GB + $0.50/GB-mo |
| Keys per namespace | Unlimited | Unlimited |
| Key size | 512 bytes | 512 bytes |
| Key metadata | 1,024 bytes | 1,024 bytes |
| Value size | **25 MiB** | 25 MiB |
| Operations per Worker invocation | 1,000 | 1,000 |
| Writes to same key | 1 per second | 1 per second |
| `expirationTtl` minimum | **60 seconds** | 60 seconds |
| `cacheTtl` minimum (read-side cache) | 30 seconds | 30 seconds |

**⚠️ KV eventual consistency (critical for OmniDrive's rate-limiter + OAuth state):**
> "Writes are immediately visible to other requests in the same global network location, but can take up to 60 seconds... to be visible in other parts of the world."
> — KV limits page

OmniDrive uses KV for:
- **OAuth state** (10-min TTL) — eventual consistency is tolerable ✅
- **Rate limiting** (`rate-limiter.ts`) — ⚠️ eventual consistency means rate limits can be **under-counted** globally during the 60-second propagation window. A determined attacker could exceed limits by routing requests through different edge locations.

**Free-tier-only mitigations for rate-limiter consistency:**
1. **Move rate-limit counters to D1** (strongly consistent on Free). Trade-off: each rate-check costs 1 of the 50 D1 queries/invocation. Acceptable if rate-limited routes are few (auth, shared-link verify).
2. **Keep KV but accept the 60s window** — tolerate minor over-counting for low-stakes limits (e.g., search). Use D1 for high-stakes limits (login attempts, shared-link password attempts — OmniDrive already does this at `routes/shared.ts:151-159` with a KV lockout key, but the *counter* could move to D1).
3. **Per-edge in-memory + KV hybrid** — keep an in-Map counter (like `rate-limiter.ts` already does) as the fast path, with KV as the cross-edge fallback. The 60s window only affects cross-edge traffic.

❌ **Do NOT use Workers Rate Limiting API** — it's a Paid feature. Stay with KV + D1.

---

## Workers Observability / Logs

Sources:
- Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/ *(Last updated Jun 9, 2026)*
- Traces: https://developers.cloudflare.com/workers/observability/traces/ *(Last updated Jun 16, 2026)*

| Limit | Free | Paid |
|---|---|---|
| Log events written / day | **200,000** | 20M/month included + $0.60/M |
| Log retention | **3 days** | 7 days |
| Max logs per account / day | 5 billion (then 1% head-sampling) | same |
| Max single log size | 256 KB | 256 KB |
| Traces | Free during beta (shares 200K/day budget) | Free during beta |
| Logpush | ❌ Paid only | 10M/month + $0.05/M |

**OmniDrive's `wrangler.example.toml`** sets:
```toml
[observability.logs]
enabled = true
head_sampling_rate = 1
persist = true
invocation_logs = true

[observability.traces]
enabled = false
```
On Free, this persists logs for **3 days** at 100% sampling, capped at **200K events/day**.

**Free-tier-only mitigation for 3-day retention:**
- **Log critical sync events to D1** for long-term retention. OmniDrive already has an `audit_logs` table (30-day cleanup at `index.ts:125`) — extend it (or add a `sync_logs` table) to persist sync-cycle summaries (driveAccountId, pagesProcessed, itemsUpserted, errors, durationMs). D1 storage is 500 MB/database on Free — plenty for text logs.
- **Reduce sampling** for non-critical logs: set `head_sampling_rate = 0.1` (10%) to stretch the 200K/day budget if needed.
- ❌ **Do NOT use Logpush** — it's Paid only.

---

## Cron Triggers

Source: https://developers.cloudflare.com/workers/configuration/cron-triggers/ *(Last updated Jun 20, 2026)*

- **5 Cron Triggers per account (Free)** / 250 (Paid)
- **Minimum interval: 1 minute** (cron expression `* * * * *` is supported)
- **Wall time: 15 minutes per invocation** (Free and Paid)
- **CPU time: 10 ms (Free)** / up to 30s (Paid, <1hr interval)
- Propagation delay: "Changes such as adding/updating/deleting a Cron Trigger may take several minutes (up to 15 minutes) to propagate."

**OmniDrive's cron:** `*/30 * * * *` (every 30 min) — well within limits.

**OmniDrive's scheduled handler** (`index.ts:116-137`) runs 7 `ctx.waitUntil()` tasks:
1. `runScheduledSync` (Drive delta sync)
2. `runLifecycleExpiration` (S3 lifecycle)
3. `cleanupOrphanMultipartUploads`
4. `AutomationEngine.processCronTrigger`
5. `AuditService.cleanupOldLogs(30)`
6. `PolicyService.processAutoDeleteRetentionPolicies`
7. Session cleanup (DELETE expired sessions)
8. OAuth state cleanup (10-min TTL)
9. Quota cache cleanup (>1h old)

All run concurrently via `waitUntil` within the 15-minute wall-time budget. ✅ Good design.

---

## Cloudflare Pages (frontend deployment)

Source: https://developers.cloudflare.com/pages/platform/limits/ *(Last updated Jul 16, 2026)*

| Limit | Free |
|---|---|
| Builds | 500/month, 1 concurrent, 20-min timeout |
| Files per site | 20,000 |
| File size | 25 MiB |
| Projects per account | 100 |
| Custom domains per project | 100 |
| Preview deployments | Unlimited |
| Static asset requests | **Free & unlimited** |
| Pages Functions requests | Count toward **Workers 100K/day** quota |
| Bandwidth | Not listed (effectively unlimited for static assets) |

**OmniDrive's frontend** deploys via Pages Functions (`packages/web/functions/api/[[path]].ts` + `packages/web/functions/s3/[[path]].ts`). These proxy API requests to the Worker — each proxied request counts toward the 100K/day Workers quota.

---

## Workers Builds (CI/CD)

Source: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ *(Last updated May 29, 2026)*

| Limit | Free | Paid |
|---|---|---|
| Build minutes | **3,000/month** | 6,000/month + $0.005/min |
| Concurrent builds | 1 | 6 |
| Build timeout | 20 minutes | 20 minutes |
| CPU | 2 vCPU | 4 vCPU |
| Memory | 8 GB | 8 GB |
| Disk | 20 GB | 20 GB |

---

## ❌ What Workers Paid would unlock — FOR REFERENCE ONLY (DO NOT UPGRADE)

> 🚫 **OmniDrive policy: stay on Free tier forever.** This section exists only so maintainers know what they're **not** getting. Every limitation below must be solved within Free constraints, not by paying.

Source: https://developers.cloudflare.com/workers/platform/pricing/ *(Last updated Jul 7, 2026)*

### What Free tier does NOT give you (and how to live without it)

| # | Limit | Free (what you have) | Paid (what you're NOT getting) | Free-tier workaround |
|---|---|---|---|---|
| 1 | **D1 queries/invocation** | **50** | 1,000 | Keep D1 calls per sync <40 via `db.batch()` chunking; split large syncs across multiple cron cycles |
| 2 | Log retention | **3 days** | 7 days + Logpush | Log critical events to D1 `audit_logs`/`sync_logs` table (30-day cleanup already exists) |
| 3 | CPU time (Cron) | **10 ms** | 30s | Sync is I/O-bound (fetch + D1), so 10ms CPU is fine; avoid heavy JSON parsing in the hot path |
| 4 | Requests/day | **100K** | 10M/month | Cache aggressively; throttle sync frequency if needed; accept that 100K/day caps ~70 concurrent users |
| 5 | Subrequests/invocation | **50** | 10,000 | Sync budget is 45 ✅ already correct |
| 6 | Durable Objects | ❌ | ✅ | Use D1 row-level locking for single-writer coordination (e.g., sync lock per drive account) |
| 7 | KV writes/day | **1,000** | 1M/month | Move rate-limiter counters to D1; keep KV for OAuth state + sessions only |
| 8 | D1 rows written/day | **100K** | 50M/month | Skip unchanged rows in sync upserts (compare `modifiedTime` before UPSERT) |

**Bottom line: OmniDrive stays on Free forever.** The D1 50-queries-per-invocation limit is the tightest constraint — solve it by keeping D1 calls per sync invocation under 40 (not by paying). The 100K requests/day limit caps the app at roughly 50-70 concurrent active users — that's the Free-tier ceiling, and it's acceptable.

---

## Free-tier capacity ceiling (what OmniDrive can support without paying)

Based on the Free limits above, here's the maximum scale OmniDrive can reach **without paying a cent**:

| Metric | Free ceiling | Assumption |
|---|---|---|
| **Concurrent active users** | ~50-70 | 100K requests/day ÷ ~1,500 requests/user/day (sync + UI + downloads) |
| **Google Drive accounts** | ~150-200 | Each account syncs every 30 min; ~5 external subrequests + ~15 D1 queries per sync |
| **D1 database size** | 500 MB | Cron cleanup of logs/sessions/sessions already in place ✅ |
| **D1 rows written/day** | 100K | Sync upserts ~500 rows/account × 200 accounts = 100K ⚠️ at ceiling |
| **KV writes/day** | 1,000 | Must move rate-limiter counters to D1; keep KV for OAuth state only |
| **Sync latency** | 30 min | Cron `*/30 * * * *`; cannot go lower without exceeding cron budget at scale |

**If OmniDrive outgrows these ceilings, the answer is NOT to pay — it's to:**
1. Optimize sync to skip unchanged rows (compare `modifiedTime` before UPSERT)
2. Move more state to D1 (strongly consistent, higher per-invocation query budget than KV writes)
3. Reduce sync frequency for idle accounts (adaptive cron — sync accounts with recent activity more often)
4. Cache more aggressively at the edge (use `cacheTtl` on KV reads, `cache` API on immutable responses)
5. Accept that Free tier has a hard user ceiling — if you genuinely need more, that's the signal to reconsider the project's hosting model, but paying is the last resort, not the first

---

## Items that could NOT be fully verified

1. **Whether `db.batch()` (100 statements) counts as 1 or 100 toward the 50-query Free cap** — docs are ambiguous. Most likely 1, but verify empirically. **Critical for Free-tier planning** — if it counts as 100, sync must batch at ≤50 statements, not 100.
2. **Whether D1's 50-free budget is shared with the external-fetch 50 budget, or separate** — docs don't state this explicitly. Most defensible reading: **separate budgets** (50 external + 50 D1). If shared, sync would be far more constrained and must reduce both to a combined ~45.
3. **Pages bandwidth** — not listed on the limits page (implies unlimited for static assets); could not find an explicit "unlimited" sentence.

---

*All URLs verified live on 2026-07-23. Cloudflare docs show 2026 last-updated dates (sandbox clock is forward-dated). Content is from the current Cloudflare documentation.*
