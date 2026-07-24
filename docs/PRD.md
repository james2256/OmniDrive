# OmniDrive — Product Requirements Document

**Project:** OmniDrive
**Version:** 0.9.7
**Status:** Active development
**Owner:** james2256
**License:** MIT
**Last updated:** 2026-06-25

> This PRD describes the **current shipped behavior** of OmniDrive as of `v0.9.7`. It is the canonical product reference; architecture, schema, and design docs dive deeper into the *how*. Where a feature exists in code but is intentionally limited, the limitation is called out explicitly.

---

## 1. Product Overview

### 1.1 What OmniDrive is

OmniDrive is a **unified multi-Google-Drive storage gateway** that runs entirely on the Cloudflare edge. It lets a user connect any number of Google Drive accounts (personal OAuth or shared-drive service accounts) and manage all of them through a single dashboard, a single search box, a single sharing model, and a single S3-compatible API.

The backend is a Hono application on Cloudflare Workers backed by Cloudflare D1 (SQLite) for durable data and Cloudflare KV for short-lived rate-limit counters. The frontend is a React 19 + Vite single-page app. There is no traditional server — Workers handle HTTP, a `*/30 * * * *` cron handles background sync/automation/lifecycle, and all file bytes are streamed directly between the browser and Google Drive through the Worker.

### 1.2 Who it is for

| Audience | Why OmniDrive |
|----------|---------------|
| Individuals with multiple Google accounts (work + personal + side project) | Stop signing in and out of Google; one inbox-style view across all drives |
| Small teams that already live on Google Drive | Add RBAC, audit logs, quotas, and a programmatic S3 API on top of Drive without migrating files |
| Developers / sysadmins | Use the S3-compatible API with rclone / aws-cli / boto3 to push backups or artifacts into Google Drive storage |
| Self-hosters | Docker Compose deployment for running the whole stack on a single VM without a Cloudflare account |

### 1.3 Core value proposition

> **All your Google Drive storage, one pane of glass — browser, sharing, search, S3, automations, workspaces, and admin — with zero servers to maintain.**

Three concrete differentiators:

1. **Multi-drive unification** — connect N drives, browse and search them as one. No other consumer-grade Drive client does this without re-uploading files.
2. **S3-compatible API on top of Google Drive** — each workspace becomes an S3 bucket; existing S3 tooling (rclone, aws-cli, boto3, AWS SDK) works unchanged. Drive storage priced as object storage.
3. **Edge-native, serverless** — runs on the Cloudflare free tier (with optional Docker self-host). No VM to patch, no database server to maintain, no per-user pricing.

---

## 2. Goals & Non-Goals

### 2.1 Goals

| # | Goal | Success metric |
|---|------|----------------|
| G1 | Unify multiple Google Drive accounts into one browsing experience | A user with ≥2 connected drives can browse all files in a single merged view at `/files/root` |
| G2 | Provide a stable S3-compatible API over Google Drive storage | rclone and aws-cli can `ls`, `cp`, `sync`, and run multipart uploads against `/s3` without errors |
| G3 | Enable team collaboration with RBAC, audit logs, and quotas | A workspace owner can add members, assign roles, view audit logs, and set per-workspace storage limits |
| G4 | Offer secure public sharing with revocation and abuse protection | Shared links support password, expiry, download limits, email gating, webhooks, and rate-limited brute-force protection |
| G5 | Stay inside Cloudflare Workers free-tier limits under normal load | <43 subrequests per request, <128 MB memory per request, background sync completes within `*/30` cron budget |
| G6 | Keep file bytes out of Worker memory | Browser streams uploads/downloads directly to/from Google Drive; Worker proxies bytes but does not buffer whole files |
| G7 | Be self-hostable without Cloudflare | Docker Compose deployment runs the Worker on Node + better-sqlite3 + KV polyfill |

### 2.2 Non-Goals (explicitly NOT in scope)

| # | Non-Goal | Rationale |
|---|----------|-----------|
| NG1 | Replace Google Drive's own web UI | OmniDrive layers on top; it does not replicate Docs/Sheets/Slides editing |
| NG2 | Sync files *to* a local filesystem | No desktop client; the product is web + API only |
| NG3 | Support non-Google cloud providers (Dropbox, OneDrive, S3) | Out of scope — see Future Roadmap §10 |
| NG4 | End-to-end encrypt file content | Files live in Google Drive; OmniDrive adds AES-256-GCM *for OAuth tokens only*, not for file bytes |
| NG5 | Real-time collaboration / co-editing | Files are viewed/managed; editing happens via Google's own web view link |
| NG6 | Mobile-native apps | Responsive web only; PWA-friendly but no native iOS/Android |
| NG7 | Native processing of file contents (thumbnails, transcoding, antivirus) | Thumbnails come from Google; no server-side media processing |
| NG8 | Multi-tenant SaaS billing / per-seat pricing | Single-tenant deployment model; admin manages users via invitation codes, not billing |

---

## 3. User Personas

### 3.1 Persona A — "Maya, the multi-account individual"

- **Profile:** Freelance designer. One personal Gmail Drive (15 GB free), one Google Workspace Drive from a client (2 TB pooled), one shared Drive for a side project.
- **Pain:** Constant sign-out / sign-in to swap Google accounts; can never find "that one PDF" because she doesn't remember which account it's in.
- **Wants from OmniDrive:** Connect all three accounts once, see every file in one search box, drag-and-drop uploads auto-routed to whichever drive has the most free space.
- **Key features used:** Multi-drive connect (OAuth + service account), Omnibar search, upload router, dashboard storage hero.

### 3.2 Persona B — "Jordan, the team lead"

- **Profile:** Engineering manager at a 12-person startup. Team uses a Google Workspace shared Drive for project archives, but needs RBAC, audit trails, and per-project quotas.
- **Pain:** Anyone in the Workspace can delete anything; no audit trail; impossible to give a contractor view-only access to a subfolder.
- **Wants from OmniDrive:** Create one workspace per project, add members with viewer/editor/manager roles, set per-workspace storage caps, see who deleted what and when.
- **Key features used:** Workspaces + RBAC, workspace policies (storage_quota + data_retention), audit logs, shared links with expiry.

### 3.3 Persona C — "Sam, the developer / automator"

- **Profile:** Backend dev. Wants to push nightly database backups and CI build artifacts somewhere cheap and S3-compatible.
- **Pain:** Real S3 is expensive; Google Drive is cheap (already paying for Workspace) but has no S3 API.
- **Wants from OmniDrive:** Generate an S3 credential pair, point rclone at it, run `rclone sync ./backups omnidrive:backups` from cron, and never think about it again.
- **Key features used:** S3 Object Storage API (`/s3`), Multipart Upload, Bucket Lifecycle (auto-trash after 90 days), S3 Credentials in Settings.

### 3.4 Persona D — "Priya, the admin / self-hoster"

- **Profile:** IT lead at a small college. Self-hosting OmniDrive on Docker for 30 faculty members.
- **Pain:** Needs to control who can sign up, audit cross-workspace activity, and rotate access when someone leaves.
- **Wants from OmniDrive:** Invitation-code-gated registration, admin panel to create/promote/disable users, global audit log feed, ability to revoke S3 keys and sessions on departure.
- **Key features used:** Admin Panel (users, invitations, audit logs), session revoke, invitation codes, Settings → S3 Credentials tab.

---

## 4. User Stories

Organized by feature area. Each story uses the format **As a `<role>`, I want `<action>` so that `<outcome>`**.

### 4.1 Authentication & Onboarding

- **US-A1** — As a first-time visitor, I want to be redirected to a `/setup` page so I can create the first super-admin account.
- **US-A2** — As the first admin, I want the first registration to require no invitation code so I can bootstrap the system.
- **US-A3** — As an admin, I want subsequent registrations to require a valid invitation code so strangers cannot self-register.
- **US-A4** — As a returning user, I want to log in with username + password and stay logged in for 7 days so I don't have to re-authenticate constantly.
- **US-A5** — As a user, I want to change my password from Settings so I can rotate credentials without admin help.
- **US-A6** — As a user, I want to see and revoke my other active sessions so I can sign out of forgotten devices.
- **US-A7** — As a user, I want to log out from any page via the header menu so my session is destroyed server-side.

### 4.2 Multi-Drive Management

- **US-D1** — As a user, I want to connect a Google Drive account via OAuth so I can browse its files.
- **US-D2** — As a user, I want to connect a Google Drive shared folder via Service Account JSON so I can use Workspace pooled storage.
- **US-D3** — As a user, I want to see all connected drives with their per-drive quota bar so I know which one has free space.
- **US-D4** — As a user, I want to trigger a manual sync per drive so I don't have to wait for the 30-minute cron.
- **US-D5** — As a user, I want to disconnect a drive so its files stop appearing in my unified view.
- **US-D6** — As a user, I want to see a "reconnect needed" badge when a drive's OAuth tokens are expired so I know to re-authenticate.
- **US-D7** — As a user, I want to browse a single drive's folder tree so I can navigate a specific account when needed.

### 4.3 File Browsing & Operations

- **US-F1** — As a user, I want to browse files in a merged view across all drives so I can find files without thinking about which drive they live in.
- **US-F2** — As a user, I want to switch between grid and list view so I can choose density.
- **US-F3** — As a user, I want to drag-and-drop upload files so I can add them without clicking through menus.
- **US-F4** — As a user, I want uploads to be automatically routed to the drive with the most free space so I don't have to pick.
- **US-F5** — As a user, I want to multi-select files with checkbox + shift-click so I can bulk-move or bulk-delete.
- **US-F6** — As a user, I want to rename, star, move, move-between-drive, trash, restore, and permanently delete files.
- **US-F7** — As a user, I want to preview images and documents inline so I don't have to download to verify content.
- **US-F8** — As a user, I want to see trashed files in a Trash page and restore or hard-delete them.
- **US-F9** — As a user, I want to star files and see them on a Starred page.
- **US-F10** — As a user, I want to attach custom string metadata to files (key/value pairs) and filter by it in search.

### 4.4 Workspaces & RBAC

- **US-W1** — As a user, I want to create a workspace so I can organize a project's files separately from My Drive.
- **US-W2** — As a workspace owner, I want to invite members by email so they can access the workspace.
- **US-W3** — As a workspace owner, I want to assign roles (`viewer`, `commenter`, `editor`, `manager`, `auditor`) so members have the right permissions.
- **US-W4** — As a workspace manager, I want to set a per-workspace storage quota so a single project cannot consume all storage.
- **US-W5** — As a workspace manager, I want to set a data retention policy so old files are auto-trashed.
- **US-W6** — As a workspace owner/manager/auditor, I want to view audit logs of who did what so I can investigate incidents.
- **US-W7** — As a workspace editor, I want to add custom metadata to workspace folders so I can tag project structure.
- **US-W8** — As a workspace owner, I want to remove a member (including myself) so departing members lose access.
- **US-W9** — As a user, I want the system to prevent the last owner from leaving or being removed so a workspace never becomes orphaned.
- **US-W10** — As a user, I want the system to prevent role escalation so a `viewer` cannot promote themselves to `owner`.

### 4.5 Sharing

- **US-S1** — As a user, I want to create a public shared link for any file or folder so I can send it to someone without an OmniDrive account.
- **US-S2** — As a user, I want to protect a shared link with a password so only people I give the password to can access it.
- **US-S3** — As a user, I want to set an expiry date on a shared link so it stops working after a deadline.
- **US-S4** — As a user, I want to cap the number of downloads so a link can't be scraped indefinitely.
- **US-S5** — As a user, I want to require an email before viewing so I can capture visitor emails for follow-up.
- **US-S6** — As a user, I want to register a webhook URL so my app gets notified when a link is accessed.
- **US-S7** — As a user, I want to view, edit, and revoke all my shared links from a single page.
- **US-S8** — As a recipient of a shared link, I want to enter the password once and have a session cookie so I don't re-enter it on every download.
- **US-S9** — As a recipient, I want a clear error when a link is expired, password-locked, or has hit its download cap.
- **US-S10** — As a sharer, I want repeated wrong passwords to lock out the link for 15 minutes after 20 attempts so brute force is impractical.

### 4.6 Global Search

- **US-SE1** — As a user, I want to type into the Omnibar and see matching files and folders across all drives so I can find things fast.
- **US-SE2** — As a user, I want to scope a search to a specific workspace so I can narrow results.
- **US-SE3** — As a user, I want to filter search results by custom metadata key/value so I can find tagged files.
- **US-SE4** — As a user, I want folder matches and file matches grouped separately so I can navigate vs open.
- **US-SE5** — As a user, I want a dedicated `/search` page with full results so I can scroll a long list.

### 4.7 S3 Object Storage API

- **US-S3-1** — As a developer, I want to generate an S3 credential pair from Settings so I can configure my S3 client.
- **US-S3-2** — As a developer, I want each workspace to appear as an S3 bucket so I can use standard `ListBuckets` semantics.
- **US-S3-3** — As a developer, I want to use path-style addressing (`/s3/<bucket>/<key>`) so rclone and aws-cli work without virtual-host setup.
- **US-S3-4** — As a developer, I want full Multipart Upload support so I can push large objects (>5 GB) reliably.
- **US-S3-5** — As a developer, I want to Abort an in-progress multipart upload so abandoned uploads don't leak temp files.
- **US-S3-6** — As a developer, I want to set a Bucket Lifecycle rule so objects older than N days are auto-trashed.
- **US-S3-7** — As a developer, I want my S3 keys to be scoped to a specific workspace (optional) so a leaked key can't touch other workspaces.
- **US-S3-8** — As a developer, I want to revoke an S3 key from Settings so I can rotate credentials.

### 4.8 Automation Rules

- **US-AU1** — As a user, I want to create a rule "if filename ends with `.log`, move it to `/var/log` folder" so logs are auto-organized.
- **US-AU2** — As a user, I want a rule "if filename contains `temp`, delete it" so cruft is auto-cleaned.
- **US-AU3** — As a user, I want rules to trigger on file upload (event) so newly-added files are processed immediately.
- **US-AU4** — As a user, I want rules to trigger on cron so existing files are swept periodically.
- **US-AU5** — As a user, I want to enable/disable a rule without deleting it so I can pause automations.
- **US-AU6** — As a user, I want to view execution logs so I can debug why a rule didn't fire.

### 4.9 Admin Panel

- **US-AD1** — As a super admin, I want to list all users so I can see who has access.
- **US-AD2** — As a super admin, I want to create a user with a specific role so I can provision accounts.
- **US-AD3** — As a super admin, I want to create invitation codes (single-use or multi-use) so I can onboard batches of users.
- **US-AD4** — As a super admin, I want to delete expired/used invitation codes so the list stays clean.
- **US-AD5** — As a super admin, I want to view global audit logs across all workspaces so I can investigate cross-workspace incidents.

### 4.10 Dashboard

- **US-DB1** — As a user, I want a storage hero card showing total used / total free across all drives so I know capacity at a glance.
- **US-DB2** — As a user, I want a donut chart breaking down usage by file category (documents, images, videos, audio, archives, other) so I know what's consuming space.
- **US-DB3** — As a user, I want a recent-files tile so I can resume work.
- **US-DB4** — As a user, I want quick-access tiles to My Drive, Starred, Shared, and Workspaces so I can navigate in one click.
- **US-DB5** — As a user, I want a per-drive row with each drive's quota bar so I can spot imbalances.
- **US-DB6** — As a super admin, I want an admin-tools tile on the dashboard so I can jump to user management.

### 4.11 Settings

- **US-ST1** — As a user, I want to update my name, email, and avatar so my profile is current.
- **US-ST2** — As a user, I want to manage connected drives (add, sync, disconnect) so I can maintain my drive fleet.
- **US-ST3** — As a user, I want to create, list, and revoke S3 credentials so I can manage programmatic access.

---

## 5. Functional Requirements

Each requirement has an ID (`FR-<area>-<n>`), a description, and acceptance criteria (AC). Route references point to actual Hono route handlers in `packages/worker/src/routes/`.

### 5.1 Authentication & Onboarding

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-AUTH-1 | First-run setup detection | `GET /api/auth/setup-status` returns `{ isSetup: boolean }`; frontend redirects unauthenticated users to `/setup` when `isSetup === false` and to `/login` otherwise. The response carries `Cache-Control: no-cache, no-store, must-revalidate`. |
| FR-AUTH-2 | First-user bootstrap | `POST /api/auth/register` creates the first user as `is_super_admin = 1` when no users exist. No invitation code is required for the first user. If `BOOTSTRAP_TOKEN` env is set, the first registration must supply it as `invitation_code`. |
| FR-AUTH-3 | Invitation-gated registration | When `isSetup === true`, `POST /api/auth/register` requires a valid `invitation_code`. The code is atomically consumed (no TOCTOU); `used_count` is incremented and bounded by `max_uses`. Expired codes are rejected. |
| FR-AUTH-4 | Password strength | Passwords must be ≥8 chars, contain uppercase, lowercase, and a digit (enforced by `passwordSchema` in `lib/schemas.ts:30`). Hashed with PBKDF2 via Web Crypto (`hashPassword` in `lib/password.ts`). |
| FR-AUTH-5 | Login | `POST /api/auth/login` validates credentials against the PBKDF2 hash, creates a `sessions` row, and sets the `omnidrive_sid` httpOnly cookie. Returns `{ success: true, user: SessionData }`. |
| FR-AUTH-6 | Session model | Sessions are stored in D1 (`sessions` table) with a 7-day sliding TTL. TTL is extended at most once per hour (`touched_at`). Expired rows are deleted by the `*/30` cron. |
| FR-AUTH-7 | Current user | `GET /api/auth/me` returns the authenticated user's `SessionData` or 401. |
| FR-AUTH-8 | Change password | `POST /api/auth/change-password` (auth required) verifies `currentPassword`, accepts `newPassword` (same strength rules), updates the hash. |
| FR-AUTH-9 | Logout | `POST /api/auth/logout` (auth required) deletes the session row and clears the cookie. |
| FR-AUTH-10 | Session revoke | `POST /api/auth/sessions/revoke` (auth required) revokes other active sessions for the user (server-side, immediate). |
| FR-AUTH-11 | Google OAuth for drive connect | `GET /api/auth/google` (auth required) generates a PKCE S256 challenge, stores `code_verifier` + `userId` in `oauth_states` (10-minute TTL), and redirects to Google consent. |
| FR-AUTH-12 | OAuth callback | `GET /api/auth/callback` verifies `state`, exchanges `code` with PKCE verifier, encrypts tokens with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), stores in `drive_tokens`, and creates/updates the `drive_accounts` row. |
| FR-AUTH-13 | Rate limiting | `/api/auth/login`, `/api/auth/register`, and `/shared/:id/verify` are rate-limited by a sliding window (`middleware/rate-limiter.ts`) to mitigate brute force. |
| FR-AUTH-14 | CSRF protection | All mutating `/api/*` requests are validated against `Origin`/`Referer` by `csrfGuard` (`middleware/csrf-guard.ts`). |

### 5.2 Multi-Drive Management

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-DRIVE-1 | OAuth connect | `GET /api/drives/connect` (auth required) initiates the Google OAuth round-trip (delegates to `FR-AUTH-11`/`FR-AUTH-12`). |
| FR-DRIVE-2 | Service account connect | `POST /api/drives/service-account` accepts `{ credentials: <JSON>, folderId: <shared folder id> }`. Parses the JSON, fetches an access token via JWT assertion, verifies access to the shared folder, encrypts the service account key, and stores the drive row with `type = 'service_account'`. |
| FR-DRIVE-3 | List drives | `GET /api/drives` (auth required) returns `{ drives: [...], aggregate: { totalQuota, totalUsed, totalFree, driveCount } }`. Each drive carries `health: 'connected' | 'auth_expired' | 'error'`. Quota is computed via `computeDriveQuota` with the priority chain in `lib/storage-quota.ts`. |
| FR-DRIVE-4 | Manual drive sync | `POST /api/drives/:id/sync` (auth required) runs `syncDriveAccount()` with checkpoint-resume via `next_page_token`. Uses generators (OOM-safe). Respects `getIsShuttingDown()` for graceful termination. |
| FR-DRIVE-5 | Manual folder sync | `POST /api/drives/:driveId/folders/:googleFolderId/sync` and `/force-sync` refresh a single subtree. |
| FR-DRIVE-6 | Folder CRUD on drive | `POST /api/drives/:driveId/folders` creates a Google Drive folder. `PATCH /api/drives/:driveId/folders/:googleFolderId/rename` renames. `PATCH /api/drives/:driveId/move/:googleFileId` moves within a drive. |
| FR-DRIVE-7 | Folder star/trash | `POST /api/drives/:driveId/folders/:googleFolderId/star` and `/unstar` toggle star. `DELETE /api/drives/:driveId/folders/:googleFolderId` trashes; `/restore` restores; `DELETE .../permanent` hard-deletes. |
| FR-DRIVE-8 | Browse drive folder | `GET /api/drives/:driveId/folders/:googleFolderId` returns the folder's children with breadcrumb. |
| FR-DRIVE-9 | External items | `GET /api/drives/external` returns items you own not in My Drive (computer backups + shared territory). `GET /api/drives/:driveId/external-folders/:googleFolderId` drills in. |
| FR-DRIVE-10 | Disconnect drive | `DELETE /api/drives/:id` (auth required) removes the drive and cascades to `drive_tokens` (ON DELETE CASCADE). |
| FR-DRIVE-11 | Quota cache | Quota is cached in `quota_cache` (5-minute TTL, `QUOTA_CACHE_VERSION`-tagged for schema invalidation). |
| FR-DRIVE-12 | Background sync | `*/30 * * * *` cron triggers `runScheduledSync()` which runs incremental sync via the Google Drive Changes API using `change_token` from `sync_state`. |

### 5.3 File Browsing & Operations

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-FILE-1 | Browse unified files | `GET /api/folders/:id?` and `GET /api/folders/tree` return the merged folder view across all the user's drives + workspaces. |
| FR-FILE-2 | Folder CRUD | `POST /api/folders` (creates a workspace folder with optional `parentId`, `icon`, `color`). `PUT /api/folders/:id` updates. `DELETE /api/folders/:id` deletes. |
| FR-FILE-3 | Folder star | `POST /api/folders/:id/star` and `/unstar` toggle folder star. |
| FR-FILE-4 | Add files to folder | `POST /api/folders/:id/files` accepts `{ fileIds: string[] }` and attaches files to a workspace folder. |
| FR-FILE-5 | Recent files | `GET /api/files/recent` (auth required) returns recent files accessible via ownership OR workspace membership (EXISTS check in repository SQL). |
| FR-FILE-6 | Category overview | `GET /api/files/category-overview` returns bytes grouped by MIME category (documents/images/videos/audio/archives/other) for the dashboard donut. |
| FR-FILE-7 | Rename | `PATCH /api/files/:id/rename` accepts `{ name }`, validates length 1–255, updates both D1 and Google Drive. |
| FR-FILE-8 | Move within workspace | `PATCH /api/files/:id/move` accepts `{ workspaceFolderId }`. Workspace RBAC enforced via `FileService.assertCanMutate`. |
| FR-FILE-9 | Move between drives | `POST /api/files/:id/move-drive` accepts `{ targetDriveId }`, copies the file via Google Drive API, deletes the original, updates D1 rows atomically. |
| FR-FILE-10 | Trash / restore / permanent-delete | `DELETE /api/files/:id` trashes. `POST /api/files/:id/restore` restores. `DELETE /api/files/:id/permanent` hard-deletes (also revokes active shared links). |
| FR-FILE-11 | Star | `POST /api/files/:id/star` and `/unstar` toggle star. `GET /api/files/starred` lists starred. |
| FR-FILE-12 | Trash list | `GET /api/files/trash` lists trashed files for the user. |
| FR-FILE-13 | Custom metadata | `PATCH /api/files/:id/metadata` accepts `{ metadata: Record<string, string> }` and stores as JSON in `files.metadata`. |
| FR-FILE-14 | Preview | `GET /api/files/:id/preview` returns preview data (image URL / web view link). |
| FR-FILE-15 | Download | `GET /api/files/:id/download` streams the file from Google Drive to the browser. |
| FR-FILE-16 | Upload — init | `POST /api/files/upload/init` accepts `{ name, mimeType, size, parentFolderId?, workspaceId?, driveAccountId? }`. Verifies workspace RBAC + quota. Uses `UploadRouter` to pick the drive with most free space (or the requested one, with spillover). Returns a Google resumable upload URL + the resolved `driveAccountId` + `googleFolderId`. |
| FR-FILE-17 | Upload — proxy | `PUT /api/files/upload/proxy` streams the request body to Google's resumable URL with `duplex: 'half'` (no buffering). Strips CORS headers from Google's response. |
| FR-FILE-18 | Upload — finalize | `POST /api/files/upload/finalize` accepts `{ googleFileId, driveAccountId, parentFolderId?, workspaceFolderId?, workspaceId? }`, fetches file metadata from Google, inserts the `files` row, updates workspace storage counter, invalidates the quota cache, and triggers the `AutomationEngine.processEventTrigger()` via `waitUntil`. |
| FR-FILE-19 | Bulk operations | Frontend `BulkActionBar` (file selection via `useSelectionStore`) supports bulk Move, Delete, Add to Workspace, Move Drive. |

### 5.4 Workspaces & RBAC

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-WS-1 | Create workspace | `POST /api/workspaces` accepts `{ name }`. The creating user is inserted as `owner`. The workspace `id` is also used as the S3 bucket name. |
| FR-WS-2 | List workspaces | `GET /api/workspaces` returns workspaces the user is a member of, with their role. |
| FR-WS-3 | Add member | `POST /api/workspaces/:id/members` accepts `{ email, role }`. `role` must be one of `viewer | commenter | editor | manager | auditor` (NOT `owner` — assignable only at creation). Caller must be `manager`+ and cannot assign a role higher than their own. |
| FR-WS-4 | Remove member | `DELETE /api/workspaces/:id/members/:targetUserId`. Caller must be `manager`+ (or self-removal). System prevents removing the last `owner`. |
| FR-WS-5 | Audit logs | `GET /api/workspaces/:id/audit-logs` — caller must be `owner`, `manager`, or `auditor`. Returns `audit_logs` rows for the workspace. Logs auto-cleaned after 30 days by cron. |
| FR-WS-6 | Policies — list | `GET /api/workspaces/:id/policies` — caller must be `manager`+. Returns `workspace_policies` rows. |
| FR-WS-7 | Policies — create | `POST /api/workspaces/:id/policies` accepts `{ targetType, targetId?, policyType, config }`. `policyType` is `storage_quota` (must target `workspace`, requires `config.max_bytes: number ≥ 0`) or `data_retention`. |
| FR-WS-8 | Policies — delete | `DELETE /api/workspaces/:id/policies/:policyId` — manager required. |
| FR-WS-9 | Folder metadata | `PATCH /api/workspaces/:id/folders/:folderId/metadata` accepts `{ metadata: Record<string,string> }` — editor required. |
| FR-WS-10 | RBAC role hierarchy | `owner > manager > auditor > editor > commenter > viewer`. `hasPermission(role, action)` in `middleware/rbac.ts` enforces the hierarchy. Role escalation is prevented: a `viewer` cannot call `addMember` with role `manager`. |
| FR-WS-11 | RBAC on file mutations | `FileService.assertCanMutate(userId, file)` checks workspace membership + role before any file mutation. IDOR (Insecure Direct Object Reference) is prevented: a user cannot access another user's files by guessing the ID. |

### 5.5 Sharing

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-SHARE-1 | Create shared link | `POST /api/shared` (auth required) accepts `{ targetType: 'file' \| 'folder', targetId, password?, expiresAt?, allowDownloads?, allowUploads?, maxDownloads?, requireEmail?, webhookUrl? }`. Returns `{ id, url }`. `allowUploads = true` is currently rejected (not yet implemented — returns 400). |
| FR-SHARE-2 | List my links | `GET /api/shared` (auth required) returns links owned by the caller. |
| FR-SHARE-3 | Update link | `PUT /api/shared/:id` (auth required) accepts any subset of the create fields. Password can be cleared by passing `null`. |
| FR-SHARE-4 | Delete link | `DELETE /api/shared/:id` (auth required) revokes the link. |
| FR-SHARE-5 | Public metadata | `GET /api/shared/:id/meta` (public) returns target metadata + flags `requiresPassword` / `requiresEmail` if applicable. Returns 410 if expired. |
| FR-SHARE-6 | Password verify | `POST /api/shared/:id/verify` (public) accepts `{ password }`. Sets a `shared_session_<id>` JWT cookie on success. After 20 failed attempts within 15 minutes, the link is locked out (KV counter `shared_verify_lock:<id>`, 15-min TTL). |
| FR-SHARE-7 | Email gate | `POST /api/shared/:id/email` (public) accepts `{ email }`, sets a `shared_email_<id>` JWT cookie. Required when `requireEmail = true`. |
| FR-SHARE-8 | Public download | `GET /api/shared/:id/download` (public) streams the file. Enforces `allowDownloads`, `maxDownloads`, expiry, password, and email gates. Increments `view_count` and `download_count`. Fires the webhook (SSRF-validated URL) on access. |
| FR-SHARE-9 | Webhook validation | `webhookUrl` is validated by `validateWebhookUrl()` (`lib/validation.ts`) against SSRF (private IPs, localhost, metadata endpoints). |
| FR-SHARE-10 | Access logs | Each access logs a row in `shared_link_logs` (`action`, `visitor_email`, `created_at`). |

### 5.6 Global Search

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-SEARCH-1 | Omnibar search | `GET /api/files/search?q=<query>&workspaceId=<optional>&metadata=<optional>` returns `{ folders: [...], files: [...] }`. Searches across all the user's drives + workspaces they're a member of. |
| FR-SEARCH-2 | Scope by workspace | `?workspaceId=<id>` restricts results to a single workspace. |
| FR-SEARCH-3 | Metadata filter | `?metadata=<key:value>` filters files where `files.metadata->>key == value`. Multiple filters AND together. |
| FR-SEARCH-4 | Grouped results | Response groups folder matches and file matches so the frontend Omnibar can render them in separate sections. |
| FR-SEARCH-5 | Frontend Omnibar | `Omnibar` (`components/layout/Omnibar.tsx`) hits `/api/files/search` on input, renders grouped dropdown. Selecting a folder navigates; selecting a file opens the preview modal. |

### 5.7 S3 Object Storage API

Endpoint: `https://<worker-url>/s3`. Auth: AWS Signature V4 (`s3-auth` middleware). Path-style addressing (`/s3/<bucket>/<key>`).

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-S3-1 | ListBuckets | `GET /s3/` returns an XML `<ListAllMyBucketsResult>` containing every workspace the user is a member of as a `<Bucket>`. |
| FR-S3-2 | PutBucket | `PUT /s3/:bucket` creates a workspace (currently used to create new buckets/workspaces from S3 clients). |
| FR-S3-3 | DeleteBucket | `DELETE /s3/:bucket` removes an empty workspace. |
| FR-S3-4 | ListObjectsV2 | `GET /s3/:bucket?list-type=2` returns `<ListBucketResult>` with object keys, sizes, ETAGs, last-modified. Prefix and delimiter supported for virtual folder navigation. |
| FR-S3-5 | HeadObject | `HEAD /s3/:bucket/:key` returns 200 + metadata (Content-Length, Content-Type, ETag, Last-Modified) or 404. |
| FR-S3-6 | GetObject | `GET /s3/:bucket/:key` streams the object body from Google Drive. Supports `Range` header for partial reads. |
| FR-S3-7 | PutObject (single-part) | `PUT /s3/:bucket/:key` streams the request body to a Google Drive file. Object key path segments become folder names. Returns ETag (MD5). |
| FR-S3-8 | DeleteObject | `DELETE /s3/:bucket/:key` trashes the Google Drive file (recoverable ~30 days) and removes the D1 row. |
| FR-S3-9 | Initiate Multipart Upload | `POST /s3/:bucket/:key?uploads` creates an `s3_multipart_uploads` row and a `.omnidrive_multipart_<uploadId>` temp folder in Google Drive. Returns `<InitiateMultipartUploadResult>` with `UploadId`. |
| FR-S3-10 | UploadPart | `PUT /s3/:bucket/:key?partNumber=N&uploadId=X` streams the part as a separate file inside the temp folder. Records `s3_multipart_parts` row with `google_file_id`, `etag`, `size`. No part is buffered in Worker memory. |
| FR-S3-11 | CompleteMultipartUpload | `POST /s3/:bucket/:key?uploadId=X` accepts `<CompleteMultipartUploadResult>` XML, stream-concatenates the parts into a final Google Drive file, deletes the temp folder. |
| FR-S3-12 | AbortMultipartUpload | `DELETE /s3/:bucket/:key?uploadId=X` trashes the temp folder and removes `s3_multipart_uploads`/`s3_multipart_parts` rows. |
| FR-S3-13 | Bucket Lifecycle — Put | `PUT /s3/:bucket?lifecycle` accepts `<LifecycleConfiguration>` XML (regex-parsed, no XML dep). Stores rules in `s3_lifecycle_rules` (`prefix`, `expiration_days`, `enabled`). `UNIQUE(workspace_id, prefix)`. |
| FR-S3-14 | Bucket Lifecycle — Get | `GET /s3/:bucket?lifecycle` returns the current XML configuration. |
| FR-S3-15 | Bucket Lifecycle — Delete | `DELETE /s3/:bucket?lifecycle` removes all rules for the bucket. |
| FR-S3-16 | Lifecycle enforcement | `*/30` cron calls `runLifecycleExpiration()` which trashes (NOT hard-deletes) objects older than `expiration_days` per rule. Objects are recoverable ~30 days via Google Drive. |
| FR-S3-17 | SigV4 verification | `s3-auth` middleware (`middleware/s3-auth.ts`) verifies the AWS SigV4 Authorization header with timing-safe comparison and ±15-minute clock-skew tolerance. |
| FR-S3-18 | Workspace scoping | S3 credentials may be `workspace_id = NULL` (global, all workspaces the user can access) or scoped to a single workspace. The middleware enforces the scope on every request. |

### 5.8 Automation Rules

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-AUTO-1 | Create rule | `POST /api/automations` accepts `{ name, trigger_type: 'event' \| 'cron', trigger_config?, conditions?, actions? }`. All conditions/actions are JSON. |
| FR-AUTO-2 | List rules | `GET /api/automations` returns rules owned by the user. |
| FR-AUTO-3 | Toggle rule | `PATCH /api/automations/:id/toggle` accepts `{ is_active: boolean }` to pause/resume without deleting. |
| FR-AUTO-4 | Event trigger | `AutomationEngine.processEventTrigger(file, ctx)` is invoked after file upload via `c.executionCtx.waitUntil()`. Loads all active `event` rules for the user and evaluates each file against the rule's conditions. |
| FR-AUTO-5 | Cron trigger | `AutomationEngine.processCronTrigger()` runs on `*/30` cron, loads all active `cron` rules, and processes files in batches of 100 (`BATCH_SIZE`). |
| FR-AUTO-6 | Condition operators | `evaluateCondition()` supports `endswith`, `contains`, `equals` against `name` or `extension` (extension auto-derived from filename). |
| FR-AUTO-7 | Actions | Supported actions: `move` (move file to a target folder) and `delete` (trash the file). |
| FR-AUTO-8 | Execution logs | Each execution writes an `automation_logs` row with `status` (`success` / `failed`) and `details` JSON. |
| FR-AUTO-9 | Graceful failure | Malformed rules (bad JSON) are skipped (`parseRule` returns `null`); they do not crash the engine or block other rules. |

### 5.9 Admin Panel

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-ADMIN-1 | Super-admin guard | Every `/api/admin/*` route requires `authGuard` + a super-admin check (`is_super_admin = 1`). Non-admins get 403. |
| FR-ADMIN-2 | List users | `GET /api/admin/users` returns `{ users: [...] }` with `id, username, email, name, avatarUrl, role, status`. |
| FR-ADMIN-3 | Create user | `POST /api/admin/users` accepts `{ username, password, name?, email?, role }` (role ∈ `member`, `super_admin`). Duplicate username/email → 400. |
| FR-ADMIN-4 | List invitations | `GET /api/admin/invitations` returns all invitation codes with `max_uses`, `used_count`, `expires_at`. |
| FR-ADMIN-5 | Create invitation | `POST /api/admin/invitations` accepts `{ code?, max_uses? }`. If `code` is omitted, a high-entropy code is generated. User-supplied codes must be ≥12 chars. Default `max_uses = 1`. |
| FR-ADMIN-6 | Delete invitation | `DELETE /api/admin/invitations/:id` removes a code (used or unused). |
| FR-ADMIN-7 | Global audit logs | `GET /api/admin/audit-logs` returns recent `audit_logs` rows across all workspaces. |
| FR-ADMIN-8 | Frontend admin page | `/admin/users` (`AdminUsersPage`) is gated by `user.role === 'super_admin'`. The Users nav item only appears for super admins. |

### 5.10 Dashboard

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-DASH-1 | Storage hero | Bento cell `lg:col-span-2` shows total `% used` (5xl/6xl), free/used totals, `QuotaBar`, drive count badge. |
| FR-DASH-2 | Category donut | Bento cell `lg:col-span-2 lg:row-span-2` — Recharts donut of bytes by MIME category (documents, images, videos, audio, archives, other). Top-4 legend with percentages. `used` total centered in donut hole. Data from `GET /api/files/category-overview`. |
| FR-DASH-3 | Quick access | Bento cell `lg:col-span-2` — 2×2 tile grid: My Drive, Starred, Shared, Workspaces. Each tile is a `<button>` that `navigate()`s. Hover lift. |
| FR-DASH-4 | Connected drives | Bento cell `lg:col-span-4` — per-drive card with color avatar (`getDriveColor(i)`), email, type, per-drive `QuotaBar`, usage %. |
| FR-DASH-5 | Recent files | Bento cell `lg:col-span-3` — inline `FileGrid` (list view) of recent files + folders. "View all" → `/files/root`. Data from `GET /api/files/recent`. |
| FR-DASH-6 | Admin tools tile | Bento cell `lg:col-span-1` — super admin only. Hidden for non-admins. |
| FR-DASH-7 | Empty state | When `drives.length === 0`, the bento grid is replaced by a centered "No drives connected" card with a CTA to Settings. |
| FR-DASH-8 | Loading skeleton | 3-cell pulsing skeleton matching the bento shape while drives query loads. |
| FR-DASH-9 | Reveal animation | Every bento cell gets `bento-reveal` class with staggered `animationDelay` (60→360ms). `prefers-reduced-motion: reduce` collapses to static reveal. |

### 5.11 Settings

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-SET-1 | Account tab | `SettingsAccountTab` — edit name/email/avatar, change password (`POST /api/auth/change-password`), revoke sessions. |
| FR-SET-2 | Drives tab | `SettingsDrivesTab` — list connected drives as `DriveAccountCard`s with quota bar, health badge, Sync + Disconnect buttons. Add-drive entry point. |
| FR-SET-3 | S3 credentials tab | `SettingsS3Tab` — `POST /api/s3-credentials` to create a key (returns `accessKeyId` + `secretAccessKey` once with a "store this now" warning), `GET /api/s3-credentials` to list, `DELETE /api/s3-credentials/:id` to revoke. Each key has optional `description` and optional `workspaceId` scope. |
| FR-SET-4 | S3 key format | Access key IDs are prefixed `OMNI` followed by 16 uppercase hex chars. Secret keys are 64-char random strings, encrypted at rest with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-1 | Worker request budget | Stay within Cloudflare's 30-second CPU limit and 50-subrequest budget per request. Documented budget: 43 subrequests max (`docs/adr/0007-subrequest-budget-43.md`). |
| NFR-PERF-2 | Worker memory | Stay within 128 MB per request. Files are never buffered whole — uploads and downloads use streaming `duplex: 'half'` bodies; multipart parts are buffered as Drive files, not in memory. |
| NFR-PERF-3 | Sync OOM safety | Initial sync uses generator-based iteration (`iterateAllFilesAndFolders`) — never loads the entire Drive file list into memory. Resume-able across restarts via `next_page_token` in `sync_state`. |
| NFR-PERF-4 | Dashboard load | Lazy-load all post-login pages (`lazyWithRetry`) so login/public shells don't pull recharts + file UI (~900 KB) into the LCP path. |
| NFR-PERF-5 | Quota cache | Drive quota is cached 5 min in `quota_cache` to avoid hitting Google's `storageQuota` endpoint on every dashboard load. Cache is versioned (`QUOTA_CACHE_VERSION`) so schema changes auto-invalidate. |
| NFR-PERF-6 | Session TTL throttling | Session TTL extension is throttled to at most once per hour (`touched_at`) to avoid D1 write quota exhaustion. |
| NFR-PERF-7 | Atomic upserts | Sync engine uses atomic `INSERT ... ON CONFLICT DO UPDATE` for files/folders instead of select-then-insert. |

### 6.2 Security

| ID | Requirement | Implementation |
|----|-------------|----------------|
| NFR-SEC-1 | OAuth token encryption | AES-256-GCM at rest in `drive_tokens` (key: `TOKEN_ENCRYPTION_KEY`). |
| NFR-SEC-2 | Password hashing | PBKDF2 via Web Crypto (not bcrypt — `docs/adr/0002-pbkdf2-not-bcrypt.md`). |
| NFR-SEC-3 | OAuth PKCE | Drive-connect flow uses PKCE S256 (`lib/pkce.ts`). |
| NFR-SEC-4 | CSRF | `csrfGuard` validates `Origin`/`Referer` on all mutating `/api/*` requests. |
| NFR-SEC-5 | Rate limiting | Sliding-window limiter on `/api/auth/login`, `/api/auth/register`, `/shared/:id/verify`. Global 100 req/min default. |
| NFR-SEC-6 | Brute-force lockout | Shared-link password attempts locked for 15 minutes after 20 failures (KV counter `shared_verify_lock:<id>`). |
| NFR-SEC-7 | IDOR prevention | All file/folder/workspace/shared-link reads scoped by `user_id` or workspace membership. `FileService.assertCanMutate` enforces. |
| NFR-SEC-8 | Role escalation prevention | Workspace roles assigned via API cannot include `owner` (`ASSIGNABLE_WORKSPACE_ROLES`). `hasPermission(role, action)` enforces hierarchy. |
| NFR-SEC-9 | SSRF prevention | `validateWebhookUrl()` rejects private IPs, localhost, and cloud metadata endpoints. |
| NFR-SEC-10 | Session hijack mitigation | `omnidrive_sid` cookie is `httpOnly`. Sessions are server-side in D1 (revocable). 7-day sliding TTL. |
| NFR-SEC-11 | S3 signature verification | `s3-auth` uses timing-safe comparison and ±15-min clock-skew tolerance. |
| NFR-SEC-12 | Security headers | `securityHeaders` middleware sets `X-Content-Type-Options`, CSP, etc. |
| NFR-SEC-13 | Input validation | `zValidator` + centralised Zod schemas (`lib/schemas.ts`) on every mutating route. ADR-0005. |
| NFR-SEC-14 | Graceful shutdown | `getIsShuttingDown()` (SIGTERM handler) prevents concurrent syncs and lets in-flight syncs checkpoint. |

### 6.3 Reliability

| ID | Requirement | Implementation |
|----|-------------|----------------|
| NFR-REL-1 | Resume-able sync | `next_page_token` checkpoint in `sync_state` lets a sync resume across Worker restarts. |
| NFR-REL-2 | Quota fallback | `computeDriveQuota` falls back through `quota_override` → Google `storageQuota.limit` → cached `total_quota` → 1 TiB `UNLIMITED_DRIVE_QUOTA_BYTES`. |
| NFR-REL-3 | Upload routing | `UploadRouter.selectDriveForUpload(size, preferredDriveId)` picks the drive with most free space; spillover if preferred is full. |
| NFR-REL-4 | Idempotent migrations | Wrangler native migrations track applied files in `d1_migrations`; `0001_initial_schema.sql` is `IF NOT EXISTS` idempotent. `tests/migrations.test.ts` fails if `schema.sql` and migrations drift. |
| NFR-REL-5 | Cron resilience | `*/30` cron runs sync, automation, audit cleanup, retention, and S3 lifecycle. Each job is independent — a failure in one does not block the others. |
| NFR-REL-6 | Automation engine resilience | Malformed rules are skipped (`parseRule` → `null`); batched processing (`BATCH_SIZE = 100`) prevents long-running transactions. |

### 6.4 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SCALE-1 | Single-tenant target | Designed for a single team / family / small org (≤ ~100 users, ≤ ~50 drives). Not multi-tenant SaaS. |
| NFR-SCALE-2 | D1 row budget | Be mindful of D1's per-day row-read/write quotas. Quota cache (5 min) and session TTL throttle (1 hr) are the main mitigations. |
| NFR-SCALE-3 | Background sync fan-out | `runScheduledSync()` iterates drives sequentially within the cron window. Drives beyond ~50 may need sharding (see Future Roadmap §10). |
| NFR-SCALE-4 | Frontend bundle | Lazy-load every post-login page; bento dashboard + recharts (~900 KB) is split out of the login path. |

### 6.5 Maintainability

| ID | Requirement | Implementation |
|----|-------------|----------------|
| NFR-MAINT-1 | Strict TypeScript | `tsconfig.base.json` enables `strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`. |
| NFR-MAINT-2 | Zod on all routes | `zValidator` on every mutating route (ADR-0005). Centralised schemas in `lib/schemas.ts`. |
| NFR-MAINT-3 | Repository pattern | All SQL lives in `repositories/*` (ADR-0003). Routes are thin orchestrators; services own business logic + RBAC. (Deferred: `routes/s3.ts` — see `// ponytail:` marker.) |
| NFR-MAINT-4 | Test coverage | 370 tests across worker unit (246), worker integration (65, real D1 via Miniflare), and web (59). |
| NFR-MAINT-5 | ADRs | Architecture decisions recorded in `docs/adr/` (10 ADRs to date). |

---

## 7. Technical Constraints

| Constraint | Detail |
|------------|--------|
| **Runtime: Cloudflare Workers** | The backend is a Hono app on Cloudflare Workers. This imposes: 128 MB memory per request, 30-second CPU limit, 50-subrequest budget (OmniDrive targets 43 max — ADR-0007), no native Node APIs (`fs`, `child_process`), no long-lived processes. |
| **Database: Cloudflare D1 (SQLite)** | D1 is SQLite at the edge. No triggers, no stored procedures. Single writer. Migrations via `wrangler d1 migrations apply` from `packages/worker/migrations/`. 23 tables, schema documented in `docs/SCHEMA.md`. |
| **Cache: Cloudflare KV** | KV is eventually consistent across regions. Used only for shared-link rate-limit counters (low-volume, TTL-friendly). OAuth tokens, PKCE state, and quota cache live in D1 (not KV) since migration `0010`. |
| **No traditional server** | The deployment is Workers + Pages on Cloudflare, or Docker Compose (`omnidrive-unified` image running `node-server.ts` + `better-sqlite3` + KV polyfill). There is no Express/Fastify server, no PostgreSQL, no Redis. |
| **Frontend: React 19 + Vite** | SPA only. Pages lazy-loaded via `lazyWithRetry`. Routing via React Router v7. State via Zustand (client) + TanStack Query (server). Tailwind CSS 4 with CSS-first `@theme` config (no `tailwind.config.js`). |
| **Auth: Google OAuth 2.0 only** | Drive connection requires Google OAuth (PKCE) or a Service Account JSON. There is no other cloud provider integration (Dropbox, OneDrive, etc.). |
| **Cron: `*/30 * * * *`** | A single 30-minute cron handles sync, automation, audit cleanup, retention, and S3 lifecycle. All background work must fit within this single trigger. |
| **File bytes never touch D1** | Files live in Google Drive. D1 stores only metadata. The Worker streams bytes between browser and Google Drive via `duplex: 'half'` (no buffering). |
| **Language: TypeScript 6 strict** | All packages share `tsconfig.base.json` strict settings. No `any` outside explicit `// ponytail:` exceptions. |
| **License: MIT** | Permissive; fork-friendly. The repo has `origin` (asmaraputra/OmniDrive) and `upstream` (james2256/OmniDrive) remotes. |

### 7.1 Environment Variables (`packages/worker/src/types/env.ts`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DB` | yes | D1 binding |
| `KV` | yes | KV binding (shared-link rate limits) |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret |
| `FRONTEND_URL` | yes | Frontend origin (CORS + share URL base) |
| `WORKER_URL` | yes | Worker origin (OAuth callback) |
| `JWT_SECRET` | yes | HS256 signing key for shared-link session/email JWTs (≥32 chars) |
| `TOKEN_ENCRYPTION_KEY` | yes | AES-256-GCM key for OAuth tokens and S3 secrets (32 chars) |
| `BOOTSTRAP_TOKEN` | no | Optional token required for first-user registration |

---

## 8. API Surface

All routes are mounted under `/api/*` (REST, cookie session) or `/s3/*` (AWS SigV4). Full route table:

### 8.1 `/api/auth` — `routes/auth.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/setup-status` | Public | First-run detection |
| POST | `/api/auth/register` | Public* | Register (first user = super admin; subsequent = invitation-gated) |
| POST | `/api/auth/login` | Public | Username + password login |
| GET | `/api/auth/google` | Required | Start Google OAuth (PKCE) |
| GET | `/api/auth/callback` | Public | OAuth callback |
| GET | `/api/auth/me` | Required | Current user |
| POST | `/api/auth/change-password` | Required | Change password |
| POST | `/api/auth/logout` | Required | End session |
| POST | `/api/auth/sessions/revoke` | Required | Revoke other sessions |

\* `register` becomes invitation-gated once `isSetup === true`.

### 8.2 `/api/drives` — `routes/drives.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/drives/connect` | Required | Initiate OAuth connect |
| GET | `/api/drives/external` | Required | Items I own not in My Drive |
| GET | `/api/drives/:driveId/external-folders/:googleFolderId` | Required | Drill into external folder |
| GET | `/api/drives` | Required | List drives + quota aggregate |
| POST | `/api/drives/service-account` | Required | Connect service-account drive |
| GET | `/api/drives/:driveId/folders/:googleFolderId` | Required | Browse drive folder |
| POST | `/api/drives/:id/sync` | Required | Manual drive sync |
| POST | `/api/drives/:driveId/folders/:googleFolderId/sync` | Required | Manual folder sync |
| DELETE | `/api/drives/:driveId/folders/:googleFolderId` | Required | Trash folder |
| POST | `/api/drives/:driveId/folders/:googleFolderId/restore` | Required | Restore folder |
| DELETE | `/api/drives/:driveId/folders/:googleFolderId/permanent` | Required | Hard-delete folder |
| POST | `/api/drives/:driveId/folders` | Required | Create Google folder |
| POST | `/api/drives/:driveId/folders/:googleFolderId/star` | Required | Star folder |
| POST | `/api/drives/:driveId/folders/:googleFolderId/unstar` | Required | Unstar folder |
| PATCH | `/api/drives/:driveId/folders/:googleFolderId/rename` | Required | Rename folder |
| PATCH | `/api/drives/:driveId/move/:googleFileId` | Required | Move within drive |
| DELETE | `/api/drives/:id` | Required | Disconnect drive |

### 8.3 `/api/folders` — `routes/folders.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/folders/tree` | Required | Folder tree (workspaces + drives) |
| GET | `/api/folders/:id?` | Required | List folder contents (merged) |
| POST | `/api/folders` | Required | Create workspace folder |
| PUT | `/api/folders/:id` | Required | Update folder |
| POST | `/api/folders/:id/star` | Required | Star folder |
| POST | `/api/folders/:id/unstar` | Required | Unstar folder |
| DELETE | `/api/folders/:id` | Required | Delete folder |
| POST | `/api/folders/:id/files` | Required | Attach files to folder |
| POST | `/api/folders/:id/sync` | Required | Folder sync |
| POST | `/api/folders/:id/force-sync` | Required | Force folder sync |

### 8.4 `/api/files` — `routes/files.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/files/recent` | Required | Recent files |
| GET | `/api/files/category-overview` | Required | Bytes by MIME category |
| GET | `/api/files/search` | Required | Search (q, workspaceId, metadata) |
| GET | `/api/files/starred` | Required | Starred files |
| DELETE | `/api/files/:id` | Required | Trash file |
| PATCH | `/api/files/:id/rename` | Required | Rename file |
| PATCH | `/api/files/:id/move` | Required | Move within workspace |
| POST | `/api/files/:id/move-drive` | Required | Move to another drive |
| PUT | `/api/files/upload/proxy` | Required | Stream upload bytes to Google |
| POST | `/api/files/upload/init` | Required | Start resumable upload |
| POST | `/api/files/upload/finalize` | Required | Finalize upload (insert D1 row, trigger automation) |
| GET | `/api/files/trash` | Required | List trashed files |
| POST | `/api/files/:id/restore` | Required | Restore file |
| POST | `/api/files/:id/star` | Required | Star file |
| POST | `/api/files/:id/unstar` | Required | Unstar file |
| DELETE | `/api/files/:id/permanent` | Required | Hard-delete file |
| PATCH | `/api/files/:id/metadata` | Required | Set custom metadata |
| GET | `/api/files/:id/preview` | Required | Preview data |
| GET | `/api/files/:id/download` | Required | Stream file from Google |

### 8.5 `/api/workspaces` — `routes/workspaces.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/workspaces` | Required | List my workspaces |
| POST | `/api/workspaces` | Required | Create workspace |
| POST | `/api/workspaces/:id/members` | Required (manager+) | Add member |
| DELETE | `/api/workspaces/:id/members/:targetUserId` | Required (manager+ or self) | Remove member |
| GET | `/api/workspaces/:id/audit-logs` | Required (owner/manager/auditor) | Audit logs |
| GET | `/api/workspaces/:id/policies` | Required (manager+) | List policies |
| POST | `/api/workspaces/:id/policies` | Required (manager+) | Create policy |
| DELETE | `/api/workspaces/:id/policies/:policyId` | Required (manager+) | Delete policy |
| PATCH | `/api/workspaces/:id/folders/:folderId/metadata` | Required (editor+) | Update folder metadata |

### 8.6 `/api/shared` — `routes/shared.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/shared` | Required | Create shared link |
| GET | `/api/shared` | Required | List my links |
| PUT | `/api/shared/:id` | Required | Update link |
| DELETE | `/api/shared/:id` | Required | Delete link |
| GET | `/api/shared/:id/meta` | Public | Public metadata |
| POST | `/api/shared/:id/verify` | Public | Verify password |
| POST | `/api/shared/:id/email` | Public | Submit email (gated links) |
| GET | `/api/shared/:id/download` | Public | Public download |

### 8.7 `/api/automations` — `routes/automations.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/automations` | Required | List rules |
| POST | `/api/automations` | Required | Create rule |
| PATCH | `/api/automations/:id/toggle` | Required | Enable/disable rule |

### 8.8 `/api/admin` — `routes/admin.ts` (super admin only)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/invitations` | Super admin | List invitations |
| POST | `/api/admin/invitations` | Super admin | Create invitation |
| DELETE | `/api/admin/invitations/:id` | Super admin | Delete invitation |
| GET | `/api/admin/audit-logs` | Super admin | Global audit logs |
| GET | `/api/admin/users` | Super admin | List users |
| POST | `/api/admin/users` | Super admin | Create user |

### 8.9 `/api/s3-credentials` — `routes/s3-credentials.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/s3-credentials` | Required | Create S3 key (optional workspaceId scope) |
| GET | `/api/s3-credentials` | Required | List my S3 keys |
| DELETE | `/api/s3-credentials/:id` | Required | Revoke S3 key |

### 8.10 `/s3` — `routes/s3.ts` (AWS SigV4)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/s3/` | ListBuckets |
| PUT | `/s3/:bucket` | PutBucket |
| DELETE | `/s3/:bucket` | DeleteBucket |
| GET | `/s3/:bucket?lifecycle` | GetBucketLifecycleConfiguration |
| PUT | `/s3/:bucket?lifecycle` | PutBucketLifecycleConfiguration |
| DELETE | `/s3/:bucket?lifecycle` | DeleteBucketLifecycleConfiguration |
| GET | `/s3/:bucket?list-type=2` | ListObjectsV2 |
| GET | `/s3/:bucket/:key` | GetObject (supports Range) |
| HEAD | `/s3/:bucket/:key` | HeadObject |
| PUT | `/s3/:bucket/:key` | PutObject (single-part) |
| DELETE | `/s3/:bucket/:key` | DeleteObject |
| POST | `/s3/:bucket/:key?uploads` | InitiateMultipartUpload |
| PUT | `/s3/:bucket/:key?partNumber=N&uploadId=X` | UploadPart |
| POST | `/s3/:bucket/:key?uploadId=X` | CompleteMultipartUpload |
| DELETE | `/s3/:bucket/:key?uploadId=X` | AbortMultipartUpload |

### 8.11 `/api/health`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | Public | Health check |

---

## 9. Data Model Summary

Full schema in `docs/SCHEMA.md`. 23 tables grouped by domain:

### 9.1 Users & Auth

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Local + Google OAuth accounts | `id`, `username` (unique), `password_hash` (PBKDF2 or `'oauth_only_user'`), `google_id`, `email`, `is_super_admin` |
| `sessions` | Login sessions (D1, 7-day sliding TTL) | `id` (cookie value), `user_id`, `data` (JSON `SessionData`), `expires_at`, `touched_at` |
| `oauth_states` | PKCE verifier + userId (10-min TTL) | `state` (PK), `code_verifier`, `user_id`, `created_at` |
| `invitation_codes` | Registration invitations | `code` (unique), `created_by`, `max_uses`, `used_count`, `expires_at` |

### 9.2 Drives & Sync

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `drive_accounts` | Connected Google Drive accounts | `id`, `user_id`, `google_account_id`, `type` (`oauth` / `service_account`), `is_primary`, `root_folder_id`, `total_quota`, `used_quota` |
| `drive_tokens` | Encrypted OAuth tokens (AES-256-GCM) | `drive_account_id` (PK, ON DELETE CASCADE), `encrypted_tokens`, `updated_at` |
| `drive_folders` | Read-only cache of Google folder tree | `drive_account_id`, `google_folder_id`, `google_parent_id`, `name` |
| `sync_state` | Per-drive sync state | `drive_account_id` (PK), `change_token`, `next_page_token` (resume checkpoint), `status` |
| `quota_cache` | Google `storageQuota` cache (5-min TTL) | `drive_account_id` (PK), `payload` (JSON), `updated_at` |

### 9.3 Workspaces & RBAC

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `workspaces` | Team collaboration spaces (also S3 buckets) | `id` (= S3 bucket name), `name`, `owner_id`, `used_bytes`, `sync_ttl_minutes` |
| `workspace_members` | Membership + RBAC | `workspace_id`, `user_id`, `role` (`viewer`/`commenter`/`editor`/`manager`/`auditor`/`owner`) |
| `workspace_folders` | Internal OmniDrive folder structure (NOT Google folders) | `workspace_id`, `name`, `parent_id` (self-FK), `icon`, `color`, `is_starred`, `metadata` (JSON) |
| `workspace_policies` | Quota & retention policies | `workspace_id`, `target_type`, `target_id`, `policy_type` (`storage_quota`/`data_retention`), `config` (JSON) |
| `audit_logs` | Workspace action audit trail (30-day retention) | `workspace_id`, `actor_id`, `action_type`, `resource_id`, `metadata` (JSON) |

### 9.4 Files

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `files` | File metadata synced from Google Drive | `id`, `user_id`, `drive_account_id`, `google_file_id`, `workspace_id` (nullable), `workspace_folder_id` (nullable), `name`, `mime_type`, `size`, `is_trashed`, `is_starred`, `metadata` (JSON). Indexes on `user_id+workspace_id`, `workspace_folder_id`, `drive_account_id`, `name`, `google_parent_id`. Unique on `(drive_account_id, google_file_id)`. |

### 9.5 Sharing

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `shared_links` | Public file/folder sharing links | `id`, `user_id`, `target_type` (`file`/`folder`), `target_id`, `password_hash`, `expires_at`, `allow_downloads`, `allow_uploads`, `max_downloads`, `require_email`, `webhook_url`, `view_count`, `download_count` |
| `shared_link_logs` | Per-access logs | `shared_link_id`, `action`, `visitor_email`, `created_at` |

### 9.6 S3

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `s3_credentials` | Per-user S3 API keys | `id`, `user_id`, `access_key_id` (unique, `OMNI...` prefix), `secret_key_enc`, `description`, `workspace_id` (nullable = global) |
| `s3_multipart_uploads` | Active multipart uploads (buffered in Drive) | `upload_id` (PK), `user_id`, `workspace_id`, `key`, `drive_account_id`, `temp_folder_id` |
| `s3_multipart_parts` | Individual parts of a multipart upload | `upload_id`, `part_number`, `google_file_id`, `etag` (MD5), `size`. PK: `(upload_id, part_number)`. |
| `s3_lifecycle_rules` | Bucket lifecycle rules | `workspace_id` (FK, cascade), `prefix`, `expiration_days`, `enabled`. Unique: `(workspace_id, prefix)`. |

### 9.7 Automations

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `automation_rules` | File automation rules | `id`, `user_id`, `name`, `trigger_type` (`event`/`cron`), `trigger_config` (JSON), `conditions` (JSON array), `actions` (JSON array), `is_active` |
| `automation_logs` | Execution logs | `rule_id`, `status` (`success`/`failed`), `details` (JSON), `executed_at` |

### 9.8 KV (Not D1)

| Key pattern | Content |
|-------------|---------|
| `shared_verify_lock:{linkId}` | Lockout flag after 20 wrong password attempts (15-min TTL) |
| `shared_verify_fail:{linkId}` | Failed attempt counter (15-min TTL) |

> All other previously-KV data (sessions, oauth_states, drive_tokens, quota_cache) has been migrated to D1 since migration `0010`.

---

## 10. Future Roadmap

These items are **not committed** — they are candidates the maintainers have considered. Inclusion here does not imply a timeline.

### 10.1 Storage provider expansion

- **Additional cloud providers** — Dropbox, OneDrive, Box, S3-compatible backends (Backblaze B2, Wasabi, MinIO) as alternative storage targets alongside Google Drive. The `drive_accounts.type` enum would extend; the unified browsing/search/S3-layer abstractions would remain.
- **Local filesystem mount** (self-hosted only) — let Docker self-hosters expose an attached volume as a "drive".

### 10.2 Sharing

- **`allowUploads` on shared links** — the column exists (`shared_links.allow_uploads`) but the route currently refuses it with a 400 (`// ponytail:` marker). Implementing it would let recipients drop files into a shared folder (e.g. for assignment submission, photo collection).
- **External items view** — a `/external` page for items you own that live outside My Drive (computer backups + files/folders you created inside someone else's shared folder).

### 10.3 S3 API

- **Virtual-hosted-style addressing** — `<bucket>.s3.<worker-url>` in addition to the current path-style. Some legacy S3 clients expect this.
- **Server-side encryption headers** (`x-amz-server-side-encryption`) — currently a no-op since files live in Drive.
- **S3 Select / Glacier restore** — out of scope for Drive-backed storage, but the API surface could be stubbed.
- **Per-prefix lifecycle rules UI** — currently lifecycle is set only via the S3 XML API; a Settings tab could expose it.

### 10.4 Sync & background jobs

- **Per-drive sync frequency** — currently every drive syncs on the same `*/30` cron. Letting admins set per-drive intervals (e.g. busy drive every 10 min, archive drive every 6 hours) would balance D1 quota.
- **Webhook on sync completion** — let users register a URL to be notified when a drive finishes syncing (similar to shared-link webhooks).
- **Sync sharding** — for deployments with >50 drives, shard the cron across multiple Workers via Durable Objects or queues.

### 10.5 Auth & identity

- **SSO (SAML / OIDC)** — for enterprise self-hosters who want to federate identity.
- **MFA / TOTP** — second factor on login.
- **Email verification** — current `users.email` is unverified; an opt-in verification flow would harden invitation-by-email.

### 10.6 Admin

- **User disable / soft-delete** — `users.status` is implicitly `active` today; a `disabled` status would let admins suspend without deleting.
- **Per-user storage caps** — quota is workspace-scoped today; per-user caps across all their drives would help multi-tenant scenarios.
- **Audit log export** — CSV/JSON export of audit logs for compliance.

### 10.7 UX

- **Dark mode** — the design system is light-only. Tokens would need a dark variant (DESIGN.md anti-pattern #3 explicitly defers this).
- **Native mobile apps** — currently responsive web only.
- **Offline mode** — Service Worker caching for recently-viewed files.
- **Bulk metadata edit** — set metadata on multiple files at once from the `BulkActionBar`.

### 10.8 Developer experience

- **JavaScript/TypeScript SDK** — a thin client wrapper over the REST API (the S3 layer already serves rclone/aws-cli/boto3).
- **Webhooks for file events** — let developers register a URL to be notified on file upload/delete/move (extends the current shared-link webhook).
- **OpenAPI spec** — generate an OpenAPI 3 schema from the Hono routes for client codegen.

### 10.9 Operability

- **Structured logging + request IDs** — the `maintainability-research` task (worklog `2026-06-25`) flagged this as the top operability gap. Adding a request-ID middleware + JSON logger would unblock production debugging.
- **Metrics endpoint** — `/api/metrics` exposing sync lag, quota usage, error counts in Prometheus format.
- **CI** — the same research task recommended landing CI (test + lint + typecheck on every PR) as a quick win.

---

## Appendix A — Glossary

| Term | Definition |
|------|------------|
| **Drive** | A connected Google Drive account (OAuth or service account). One OmniDrive user can have many. |
| **Workspace** | A team collaboration space. Replaces the older "virtual folder" concept. Also doubles as an S3 bucket. |
| **Workspace folder** | An OmniDrive-internal folder (`workspace_folders` table), NOT a Google Drive folder. Used for organizing files within a workspace. |
| **Drive folder** | A real Google Drive folder, mirrored in `drive_folders` (read-only cache). |
| **Shared link** | A public URL (`/shared/:id`) that grants access to a file or folder, optionally with password / expiry / download cap / email gate / webhook. |
| **S3 credential** | An `OMNI...` access key + secret pair, generated per user, optionally scoped to a workspace. Used to authenticate `/s3` requests via AWS SigV4. |
| **Multipart upload** | The S3 protocol for uploading large objects in parts. OmniDrive buffers each part as a separate Google Drive file inside a `.omnidrive_multipart_<uploadId>` temp folder, then stream-concatenates on Complete. |
| **RBAC** | Role-Based Access Control. Workspace roles in descending order: `owner > manager > auditor > editor > commenter > viewer`. |
| **PKCE** | Proof Key for Code Exchange (RFC 7636) — used in the Google OAuth flow to protect against authorization-code interception. |
| **Cron** | Cloudflare Workers scheduled trigger. OmniDrive uses `*/30 * * * *` (every 30 minutes) for sync, automation, audit cleanup, retention, and S3 lifecycle. |

## Appendix B — Cross-Reference Index

| Topic | Document |
|-------|----------|
| System architecture, request pipeline, services, middleware | `docs/ARCHITECTURE.md` |
| Database schema, migrations, KV | `docs/SCHEMA.md` |
| UI design system, bento grid, Tailwind 4 | `docs/DESIGN.md` |
| AI agent guide, dev workflow | `docs/AGENTS.md` |
| Architecture Decision Records (10 ADRs) | `docs/adr/` |
| S3 compatibility design | `docs/superpowers/specs/2026-06-21-s3-object-storage-compatibility-design.md` |
| Workspace-scoped S3 keys design | `docs/superpowers/specs/2026-06-23-workspace-s3-keys-design.md` |
| Deploy script design | `docs/superpowers/specs/2026-06-22-deploy-script-improvement-design.md` |
| Change history | `CHANGELOG.md` |
| Maintainability research (2026-06-25) | `worklog.md` (Task `maintainability-research`) |
