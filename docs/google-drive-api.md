# Google Drive API v3 — Verified Limits & Best Practices Reference

> **Editing context for OmniDrive.** All facts verified against official `developers.google.com` docs on 2026-07-23. Each entry cites the source URL. Use this when modifying `google-drive.ts`, `sync.ts`, or any Drive API integration.
>
> 💚 **Google Drive API has no paid tier for OmniDrive's use case.** The API is free; quotas are generous (325K units/min/user, ~104 units/sync-cycle). The constraints that matter are Cloudflare's Free-tier limits (see [`cloudflare-free-tier.md`](./cloudflare-free-tier.md)), not Google's. All recommendations here stay within Google's free quotas — no GCP billing required.

## ⚠️ HEADLINE: The quota model changed on May 1, 2026

The legacy "1,000 queries / 100 sec / user" and "1 billion queries / day" numbers are **no longer current for new projects.** They were superseded by a **quota-unit** model.

> "As of May 1, 2026, the usage limits for this API were updated. Google Cloud projects that made any use of this API between November 2025 and April 2026 will continue with their previously set usage quotas. Cloud projects created on or after May 1, 2026 are subject to the new API quotas."
> — https://developers.google.com/drive/api/guides/limits

**If OmniDrive's Google Cloud project was created on/after May 1, 2026, it's on the new model.** Legacy projects keep old quotas until further notice.

---

## 1. Quotas (new model, current)

Source: https://developers.google.com/drive/api/guides/limits

| Limit | Value |
|---|---|
| Per minute per project | **1,000,000 quota units** |
| Per minute per user per project | **325,000 quota units** |
| Per day per project (billing threshold) | **400,000,000 quota units** (cannot be increased) |
| Per day per project (egress) | **1 TB** before charges apply |
| Max file upload size | **5 TB** |
| Max file copy size | **750 GB** |
| Per-user daily upload cap | **750 GB/day** (My Drive + shared drives + copies) |
| Max items per folder | **500,000** |

> "Provided you stay within the per-minute quotas, there's no limit to the number of requests you can make per day."
> — Drive API limits page

### Per-method quota cost (critical for budgeting)

| Action | Example endpoint | Quota units |
|---|---|---|
| Read items | `files.get`, `about.get` | **5** |
| List items | `files.list`, `changes.list` | **100** (per page) |
| Download items | `files.get?alt=media`, `files.download` | **200** |
| Edit items | `files.update`, `files.patch` | **50** |
| Other actions | `files.generateIds` | **5** |

**OmniDrive cost examples (per account, per 30-min sync cycle):**
- `changes.list` (1 page, ~100 changes) = 100 units
- `about.get` (quota, cache 5 min → ~1/10 cycles) = 5 units (amortized ~0.5 units/cycle)
- `getStartPageToken` (1/cycle when token exhausted) = ~5 units
- **Total per cycle: ~105 units** — far below the 325,000/min/user budget ✅

**For downloads:** each `alt=media` download = 200 units. 325,000 / 200 = **1,625 downloads/min/user** before throttling.

---

## 2. OAuth Scopes

Source: https://developers.google.com/identity/protocols/oauth2/scopes

### Drive API v3 scopes

| Scope | Access level |
|---|---|
| `https://www.googleapis.com/auth/drive` | **Full**: see, edit, create, delete all Drive files |
| `https://www.googleapis.com/auth/drive.file` | Per-file: only files created/opened by this app |
| `https://www.googleapis.com/auth/drive.appdata` | App-specific hidden config folder |
| `https://www.googleapis.com/auth/drive.metadata` | View + manage file metadata |
| `https://www.googleapis.com/auth/drive.metadata.readonly` | Read file metadata |
| `https://www.googleapis.com/auth/drive.readonly` | Read + download all files |
| `https://www.googleapis.com/auth/drive.apps.readonly` | View Drive apps |
| `https://www.googleapis.com/auth/drive.photos.readonly` | View Google Photos |
| `https://www.googleapis.com/auth/drive.scripts` | Modify Apps Script behavior |

### OmniDrive's current scope

**`packages/worker/src/routes/auth.ts:116`:**
```ts
const scope = 'openid email profile https://www.googleapis.com/auth/drive';
```

**✅ Correct.** OmniDrive is a multi-drive aggregation gateway (list, move, trash, rename, copy, share, upload, download across arbitrary files). Only **full `drive` scope** covers all endpoints. `drive.file` would break the gateway (limits to app-created files). `drive.readonly` excludes all mutations.

**Note:** The `changes` API alone would accept `drive.readonly`, but OmniDrive's write operations require full `drive`.

### OAuth verification (critical for production)

> "Sensitive scopes, indicated in the Google Cloud Console, require review by Google."
> "Public applications using scopes that access user data must complete a verification process."
> — https://developers.google.com/identity/protocols/oauth2/scopes

> "Depending on the sensitivity of the data being requested, verification might require several months for the app to complete."
> — https://support.google.com/cloud/answer/7454865

> "If your app remains unverified, the unverified app screen will be displayed before the consent screen, and your app will be limited to 100 new users until it is verified."
> — https://support.google.com/cloud/answer/7454865

> "Apps requesting restricted scopes data need to complete 're-verification' annually."
> — https://support.google.com/cloud/answer/13463073

**Action items:**
1. Move OAuth consent screen from "Testing" to "In production" before public launch.
2. Submit for verification (allow **several months**).
3. Until verified: **100 new-user cap** + **refresh tokens expire in 7 days** (see §4).

---

## 3. Delta Sync (Changes API) — best practices

Source: https://developers.google.com/drive/api/guides/manage-changes

### Official recommended pattern (OmniDrive matches this ✅)

1. `changes.getStartPageToken` → store token
2. Loop `changes.list(pageToken)`, follow `nextPageToken`
3. On last page, persist `newStartPageToken` for next cycle

> "If the nextPageToken is listed, it can be used to gather the next page of changes. If it's not listed, the client application should store the newStartPageToken in the response for future use."
> — Manage changes guide

### Polling frequency

> ⚠️ **No explicit interval is published.** Google says to "save this token for the next polling interval" but gives no number.

OmniDrive's 30-min cron is within reasonable bounds. For lower latency, consider `changes.watch` push notifications (requires a public HTTPS webhook; Cloudflare Workers can host it).

### `includeItemsFromAllDrives` / `supportsAllDrives`

✅ **Still current and required for shared-drive support.** The deprecated variants are `includeTeamDriveItems` / `supportsTeamDrives` / `teamDriveId`.

> "includeItemsFromAllDrives: Whether both My Drive and shared drive items should be included in results."
> "supportsTeamDrives: Deprecated: Use supportsAllDrives instead."
> — https://developers.google.com/drive/api/reference/rest/v3/changes/list

**OmniDrive status:** `listFolderContents` (google-drive.ts:705) uses `supportsAllDrives=true&includeItemsFromAllDrives=true` ✅. But `listChanges` (line 637) and `listFilesInFolder` (line 672) do **NOT** pass these params — ⚠️ shared drive items may be missing from sync and folder-listing. **Action: add to all `files.list` / `changes.list` calls.**

### `spaces=drive` vs `spaces=appDataFolder`

Source: https://developers.google.com/drive/api/guides/appdata

- **`drive`** = user's My Drive + shared drives (where OmniDrive user files live) ✅
- **`appDataFolder`** = hidden per-app isolated folder for app-specific config data. Requires `drive.appdata` scope. Deleted when user uninstalls app.

**OmniDrive uses `spaces=drive`** (google-drive.ts:637) ✅ — correct for user-file aggregation. `appDataFolder` is unnecessary since OmniDrive persists state in D1.

### `fields` parameter (partial responses)

> "For better performance, you can ask the server to send only the fields you really need and get a partial response instead."
> — https://developers.google.com/drive/api/guides/performance

**OmniDrive uses `fields` on all list/get calls** ✅ — e.g., `changes(fileId,removed,file(id,name,mimeType,...))` at google-drive.ts:634. This is Google's recommended pattern.

**Note:** `fields` does NOT reduce quota units (a `files.list` = 100 units regardless), but reduces payload/latency/CPU.

### Pagination — max page size = 1000

> "pageSize: The maximum number of files to return… The maximum value is 1000; values above 1000 will be coerced to 1000."
> — https://developers.google.com/drive/api/reference/rest/v3/files/list

**OmniDrive's `listFilesInFolder` and `listFolderContents`** paginate via `nextPageToken` loop ✅. They do NOT explicitly set `pageSize=1000` — Google defaults to 100. **Action: add `pageSize=1000` to reduce round-trips for large folders.**

---

## 4. Token Refresh

Source: https://developers.google.com/identity/protocols/oauth2

### Refresh token expiration — tokens CAN expire

Official reasons:
> - "The user has revoked your app's access."
> - "The refresh token has not been used for six months." ✅ confirms 6-month idle rule
> - "The user changed passwords and the refresh token contains Gmail scopes."
> - "The user account has exceeded a maximum number of granted (live) refresh tokens."
> - "The user granted time-based access to your app and the access expired."
> — OAuth 2.0 guide

**Limit: 100 refresh tokens per Google Account per client ID** (newest invalidates oldest). Service accounts exempt.

> "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days…"
> — OAuth 2.0 guide

**⚠️ Critical for OmniDrive:** If the OAuth consent screen is in "Testing" status, **all refresh tokens expire in 7 days**. Users would need to re-authenticate weekly. Move to "In production" before launch.

### Access token lifetime — read `expires_in`, don't hardcode

> "expires_in — The remaining lifetime of the access token in seconds."
> — https://developers.google.com/identity/protocols/oauth2/web-server

The docs do NOT pin a hard "1 hour" constant; the sample response shows `"expires_in": 3920` (~65 min). The widely-cited "~3600s / 1 hour" is typical, **not guaranteed**.

**OmniDrive status:** ✅ `refreshToken` (google-drive.ts:178) reads `data.expires_in * 1000` correctly — does not hardcode 3600.

### Token revocation

Endpoint: `POST https://oauth2.googleapis.com/revoke` with token as form param.

> "The token can be an access token or a refresh token. If the token is an access token and it has a corresponding refresh token, the refresh token will also be revoked."
> — Web server guide

> ⚠️ "Revocation removes all OAuth 2.0 scopes previously granted to a project, invalidating any issued access or refresh tokens for all clients registered under that project."

**Gotcha:** Revoking one token nukes the **whole user grant** for the project. Don't call revoke casually per-file.

### Concurrent refresh race condition

> ⚠️ **No official guidance found.** Google's token endpoint is typically idempotent for refreshes (returns same access token + same refresh token), but this is not officially documented.

**Action:** Serialize refresh per account (D1-backed lock or single-flight) to avoid races. OmniDrive's `tokenCache` (in-memory Map per instance) partially addresses this within a single sync invocation, but cross-invocation races are possible if two cron cycles overlap.

---

## 5. Resumable Uploads

Source: https://developers.google.com/drive/api/guides/manage-uploads

### Session URI expiration

> "A resumable session URI expires after one week."
> "Upload sessions also expire after one week of inactivity."

### Chunk size

> "Create chunks in multiples of 256 KB (256 x 1024 bytes) in size, except for the final chunk that completes the upload. Keep the chunk size as large as possible so that the upload is efficient."

**Preferred approach when feasible:** single-request upload (1 chunk = whole file):
> "Upload content in a single request… This approach is best because it requires fewer requests and results in better performance."

### Status codes

| Status | Meaning |
|---|---|
| **308 Resume Incomplete** | Chunk received, continue uploading |
| **200 OK / 201 Created** | Whole upload complete |
| **404 Not Found** | Session expired, restart from beginning |

**Resume after interruption:** query status with empty PUT + `Content-Range: */<total>`, read `Range` header for resume byte.

**OmniDrive status:** `initiateResumableUpload` (google-drive.ts:294) exists ✅. Need to verify the chunked upload completion path in `upload-router.ts` handles 308/404 correctly (not verified in this audit).

---

## 6. Download / Export

Source: https://developers.google.com/drive/api/guides/manage-downloads

### `alt=media` vs `files.export` vs `exportLinks`

| Method | Use case | Limit |
|---|---|---|
| `files.get?alt=media` | Download blob/binary content (non-Google-Workspace) | No size cap |
| `files.export` | Export Google Workspace docs (Docs/Sheets/Slides) to chosen MIME | **10 MB** |
| `files.download` (newer) | Alternative to `alt=media` | No size cap |
| `exportLinks` | Browser-facing export URLs | N/A |

**OmniDrive status:** `downloadFile` (google-drive.ts:350-392) ✅ correctly distinguishes:
- Google Workspace (`application/vnd.google-apps.*`) → uses `/export?mimeType=...`
- Other files → uses `?alt=media`

**Export mappings (OmniDrive):**
- `google-apps.spreadsheet` → `.xlsx` (Excel)
- `google-apps.document` → `.pdf`
- `google-apps.presentation` → `.pdf`
- Fallback (drawing/script/etc.) → `.pdf`

**⚠️ Gap:** OmniDrive does NOT handle the **10 MB export limit**. Large Google Docs will fail with an opaque error. **Action: catch 403 `exportSizeLimitExceeded` and surface a user-friendly message.**

### Export MIME types (official table)

Source: https://developers.google.com/drive/api/v3/ref-export-formats

| Source type | Target format | MIME type |
|---|---|---|
| Documents | Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Documents | PDF | `application/pdf` |
| Documents | Markdown | `text/markdown` |
| Documents | Plain Text | `text/plain` |
| Spreadsheets | Excel | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Spreadsheets | PDF | `application/pdf` |
| Spreadsheets | CSV (first sheet) | `text/csv` |
| Presentations | PowerPoint | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| Presentations | PDF | `application/pdf` |
| Drawings | PDF/JPEG/PNG/SVG | (as above) |
| Apps Script | JSON | `application/vnd.google-apps.script+json` |
| Google Vids | MP4 | `video/mp4` |

Fetch the live list via `about.get?fields=exportFormats`.

---

## 7. Error Handling & Retries

Source: https://developers.google.com/drive/api/guides/handle-errors

### Error types

| HTTP | `error.errors[].reason` | Meaning | Fix |
|---|---|---|---|
| 403 | `userRateLimitExceeded` | Per-user limit hit | Exponential backoff + `quotaUser` (for SAs) |
| 403 | `rateLimitExceeded` | Project rate limit hit | Exponential backoff |
| 403 | `sharingRateLimitExceeded` | Sharing limit (often email-linked) | Backoff + reduce sharing rate |
| 403 | `dailyLimitExceeded` | Manual "Queries per day" cap set | Remove the cap in Cloud Console |
| 429 | `rateLimitExceeded` | Sent too many too fast | Exponential backoff |
| 403 | `numChildrenInNonRootLimitExceeded` | Folder > 500,000 items | Restructure |

### Exponential backoff (officially recommended)

Source: https://developers.google.com/drive/api/guides/limits

> "we recommend your code catches the exception and uses a truncated exponential backoff"

**Algorithm (verbatim from docs):**
```
wait = min((2^n) + random_number_milliseconds, maximum_backoff)
```
- `n` increments per retry
- `random_number_milliseconds` = random ≤ 1000 ms (recalculated each retry)
- `maximum_backoff` = typically 32 or 64 seconds
- Continue retrying up to a max number of retries; don't increase wait beyond `maximum_backoff`

**Recommended for:** `403 rateLimitExceeded`, `403 userRateLimitExceeded`, `429 rateLimitExceeded`, and `500/502/503/504`.

### `X-RateLimit-*` and `Retry-After` headers — NOT used

> ❌ **Not documented.** The Drive API uses HTTP status + JSON `error` body with `domain`/`reason`/`message` — NOT GCP-style `X-RateLimit-*` headers. `Retry-After` appears **0 times** in the Drive API docs.

**Action:** Parse JSON `error.errors[].reason`, not headers. OmniDrive's current error handling (`throw new UpstreamError(...response.text())`) does not parse the reason — ⚠️ **cannot distinguish rate-limit errors from real failures.**

### `dailyLimitExceeded` reset timing

> ⚠️ **"Resets at midnight Pacific" — NOT confirmed.** Docs describe daily limits as a "24-hour period" (rolling window), not a clock reset.

> "within a 24-hour period before charges apply"
> — Drive API limits page

Treat the daily quota as a **rolling 24h window**; do not assume a midnight-PST reset.

---

## 8. Service Accounts

Source: https://developers.google.com/drive/api/guides/limits

> "API calls by a service account are considered to be using a single account."

> "If one user is making numerous requests on behalf of many users of a Google Workspace account, consider a service account with domain-wide delegation using the quotaUser parameter."
> — https://developers.google.com/drive/api/guides/handle-errors

> "Service accounts don't have storage quota and can't own any files."
> — Handle errors guide

**OmniDrive status:**
- ✅ Supports service accounts (`google-drive.ts:91`, `google-service-account.ts`)
- ❌ Does NOT use `quotaUser` parameter — **all SA traffic collapses into one per-user quota bucket → throttling risk.**

**Action:** If using a SA for multiple end-users, add `quotaUser=<end-user-id>` to all Drive API calls to bucket traffic per-user.

---

## 9. OmniDrive-Specific Cost Analysis

### Per 30-min sync cycle (per account, new quota model)

| Call | Count | Units each | Units total |
|---|---|---|---|
| `changes.list` (1 page, ~100 changes) | 1 | 100 | 100 |
| `about.get` (quota, cached 5 min → 1/10 cycles) | 0.1 | 5 | 0.5 |
| `getStartPageToken` (1/cycle when token exhausted) | ~0.1 | 5 | 0.5 |
| Token refresh (1/hour) | ~0.5 | 5 | 2.5 |
| **Total per cycle** | | | **~103.5 units** |

**Budget:** 325,000 units/min/user. OmniDrive uses ~104 units per 30-min cycle = **0.03% of per-minute budget**. ✅ Extremely safe.

### For 100 accounts syncing every 30 min

- 100 accounts × 104 units = 10,400 units per 30-min window
- Per-minute project budget: 1,000,000 units
- **0.01% of project budget** ✅

**Caveat:** This assumes each account's OAuth token buckets traffic to that user (true for per-user OAuth). If using a single service account without `quotaUser`, all 100 accounts collapse into one per-user bucket (325,000 units/min) — still safe at 10,400 units/30min, but riskier at scale.

---

## 10. Action Items for OmniDrive (priority order)

| # | Priority | Issue | Fix |
|---|---|---|---|
| 1 | 🔴 High | NO exponential backoff on 429/403/5xx | Implement truncated backoff (2ⁿ + ≤1000ms jitter, max 32-64s, max 5 retries) |
| 2 | 🔴 High | NO `error.errors[].reason` parsing | Parse JSON error reason; distinguish rate-limit from real failure |
| 3 | 🔴 High | NO `quotaUser` for service-account flows | Add `quotaUser=<end-user-id>` when using SA |
| 4 | 🟡 Medium | `listChanges` + `listFilesInFolder` missing `supportsAllDrives`/`includeItemsFromAllDrives` | Add to all `files.list`/`changes.list` calls |
| 5 | 🟡 Medium | NO `pageSize=1000` on list calls | Add to reduce round-trips for large folders |
| 6 | 🟡 Medium | NO 10MB export limit handling | Catch 403 `exportSizeLimitExceeded`; surface friendly message |
| 7 | 🟡 Medium | OAuth consent screen status unknown | Move to "In production" before launch (else 7-day refresh-token expiry) |
| 8 | 🟡 Medium | NO token refresh single-flight | Serialize refresh per account to avoid races |
| 9 | 🟢 Low | Only polling `changes.list` (no push) | `changes.watch` is free (just needs a public webhook route) but adds complexity — polling every 30 min is adequate for OmniDrive's scale |
| 10 | 🟢 Low | Upload chunk 308/404 handling unverified | Audit `upload-router.ts` for resume/restart logic |

---

## 11. Items that could NOT be fully verified

| Claim | Status |
|---|---|
| Legacy "1,000 q/100s/user", "1B/day", "10 QPS/user" | **Superseded** by 1-May-2026 quota-unit model. Could not fetch archived copy. |
| Hard "permissions per file" max (e.g. 200) | **Not found** in official docs. Only concurrency + sharing-rate limits documented. |
| `Retry-After` header behavior | **Not documented** (0 occurrences). Use exponential backoff. |
| Access token exactly 3600s/1h | Docs return `expires_in`; sample shows 3920. ~1h typical, not guaranteed. |
| Concurrent token-refresh race guidance | **No official guidance.** Use single-flight/locking. |
| `dailyLimitExceeded` resets at midnight Pacific | **Not confirmed.** Docs say "24-hour period" (rolling). |
| Per-scope sensitive vs restricted label | Not in public scopes table; shown only in Cloud Console. |

---

*All URLs verified live on 2026-07-23. Every `developers.google.com/drive/...` URL 302-redirects to `developers.google.com/workspace/drive/...`; both resolve to the same page. The `/drive/` form remains the stable canonical link.*
