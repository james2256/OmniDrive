# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Drive account badges (`DriveBadge`) in the file browser: colored label with shortened username, optional **Drive** column when multiple accounts are connected, and **Stored on** field in the details panel; full email shown on hover.
- Image preview via `GET /api/files/:id/preview` and updated `FilePreviewModal` in Workspaces, Trash, and Starred.
- AzaDrive logo and optimized favicon assets for Google OAuth brand verification.
- Public pages `/home`, `/privacy`, and `/terms` for OAuth consent screen requirements.
- Mobile-responsive layout: drawer sidebar and info panel, wrapped toolbars, and touch-friendly bulk actions.
- Home dashboard bento grid redesign with storage hero, category donut chart, and quick-access tiles.
- Drive identity color tokens (`--drive-1` through `--drive-5`).
- S3 bucket lifecycle configuration API; cron moves expired objects to trash instead of hard-deleting.
- `tailwindcss-animate` plugin with expand/collapse and modal enter/exit animations across 15 components.
- Dev-only Agentation annotation component in `main.tsx`.
- AI agent documentation navigation map in `AGENTS.md`.
- Linux Mint dual-boot setup: `scripts/setup-linux.sh`, `scripts/sync-config-from-windows.sh`, `LINUX-SETUP.md` (agent prompt + maintainer guide), and `.gitattributes` (`eol=lf`) for Windows HDD + Linux SSD workflow.

### Changed

- Migrated D1 schema management to wrangler native migrations (`wrangler d1 migrations apply`) with a single idempotent baseline (`0001_initial_schema.sql`), removing dead numbered migrations and resolving the duplicate `0008` numbering collision.
- Migrated OAuth state, encrypted tokens, and quota cache from KV to D1 (`0009`, `0010`); KV retained only for shared-link rate limits.
- Migrated session storage from KV to D1; existing KV sessions expire within 7 days (one-time re-login required).
- Rebranded user-facing strings from OmniDrive to AzaDrive; production frontend URL set to `https://azadrive.my.id` (infrastructure identifiers unchanged).
- Recalibrated brand palette to cobalt accent (`#2563EB`) and cool slate surface (`#F1F5F9`).

### Fixed

- Production `/api/*` and `/s3/*` requests silently returned the SPA's `index.html` instead of the Worker's JSON response: `_redirects` cannot proxy external domains (Cloudflare Pages limitation), so the `*.workers.dev` proxy rules never took effect. Replaced with Cloudflare Pages Functions (`functions/api/[[path]].ts`, `functions/s3/[[path]].ts`) that forward the request to the Worker, scoped via `_routes.json` so only those two paths invoke a Function.
- Restored the `sessions` table to the schema baseline (`schema.sql` and `0001_initial_schema.sql`); it was missing after the migration consolidation, which would break authentication on a fresh install.
- Upload router falls back to the drive with the most free space when the preferred drive is full.
- Account health badges (`reconnect needed`, `unreachable`) on connected drives in Settings.
- Unified auth and dashboard visuals to match core app design tokens.
- Password hashing switched from bcrypt to PBKDF2 (Web Crypto) for Workers CPU limits.
- Production deploy targets updated for Cloudflare Worker and Pages under the `asmaraputra` account.
- Google Drive file/folder move logic and tests.

### Removed

- Dead code and local artifacts: unused `AdvancedShareModal`, `DriveFolderBrowser`, legacy `DriveService`, unused `errorHandler` middleware, unused `listAllFilesAndFolders` in `GoogleDriveService`, stale API client methods (`getRootContents`, `getAdminAuditLogs`, `syncDriveFolder`), `bcryptjs`/`@radix-ui/react-popover` dependencies, one-off `optimize-logo.mjs`, and scratch files (diff dumps, DB export, agent run dirs).
- Manual storage capacity override UI and `PATCH /api/drives/:id/quota` endpoint (`quota_override` column kept read-only for compatibility).
- Dev smoke-test scripts, one-off migration scripts, debug `console.log` calls, and local test artifacts.

### Fixed

- `PATCH /api/files/:id/move` now reads `workspaceFolderId` from the request body (matching the frontend API client) instead of the mismatched `folderId` field that silently ignored folder targets.
- Google Drive sync generators refresh OAuth tokens per page (`iterateAllFilesAndFolders`, `listFolderContents`, `listFilesInFolder`) so long-running syncs survive token expiry mid-stream.
- Shared-link password hashing unified in `password.ts` (`hashSharedPassword` / `verifySharedPassword`): new links use 10k PBKDF2 iterations with `shared:<iterations>:<salt>:<hash>` format; legacy `salt:hash` (100k) hashes still verify.
- `require_email` shared-link gate cookies are now signed JWTs (`shared_email_<id>`) instead of raw email strings, preventing forged cookie bypass.
- Upload finalize error responses no longer leak internal Google file or drive account IDs to clients (details remain in server logs only).
- Upload proxy (`PUT /api/files/upload/proxy`) streams the request body straight to Google instead of buffering it with `arrayBuffer()`, avoiding the Worker 128MB memory limit crash on large files.
- IDOR/quota abuse on uploads: `POST /api/files/upload/init` and `POST /api/files/upload/finalize` now require the caller to be an editor of the `workspaceId` in the request body before checking quota or attaching a file, preventing users from inflating or writing to workspaces they don't belong to.
- Orphan S3 multipart uploads (never Completed/Aborted) are now reaped by the cron: `cleanupOrphanMultipartUploads` deletes the temp Google Drive folder and the `s3_multipart_uploads` row (parts cascade) for uploads older than 24h, preventing leaked temp folders and stale D1 rows.
- Admin-created users could not log in: `POST /api/admin/users` now hashes passwords with PBKDF2 (same as register/login) instead of bcrypt.
- Registration invitation codes: atomic consume after username/email validation (no race on `max_uses`, no slot burned on duplicate username).
- Shared link downloads: `download_count` increments only after Google fetch succeeds, so failed downloads no longer consume `maxDownloads` quota.
- Workspace `force-sync` background job now runs real drive sync via `syncDriveAccount` (was a no-op stub).
- Drive sync and lazy folder sync use D1 `batch()` for upserts (per Cloudflare docs: fewer round-trips, transactional chunks of 100 statements).
- **Session hilang setelah tab ditutup (~5 menit):** frontend production memanggil API langsung ke `*.workers.dev` sementara SPA di `azadrive.my.id`, sehingga cookie `omnidrive_sid` menjadi third-party dan sering dihapus browser. Perbaikan: proxy same-origin `/api` dan `/s3` lewat Cloudflare Pages `_redirects`, `VITE_API_URL` kosong (relative path), cookie session `SameSite=Lax`, dan Vite dev proxy untuk `/api` + `/s3`. Session D1 tetap 7 hari.
- Login failed with HTTP 500 when the `is_super_admin` column was missing from migrated databases (`0008` migration).
- Login failed with HTTP 500 due to bcrypt CPU timeout on Cloudflare Workers.
- Upload failed with HTTP 500 from invalid `workspace_folder_id` foreign key; uploads now use `parentFolderId` and correct `google_parent_id`.
- Upload failed on service accounts and shared drives missing `supportsAllDrives=true`.
- Per-drive storage display used account-wide Google quota instead of Drive-only usage.
- Rate limiter double-counted login requests against the global API bucket (premature HTTP 429).
- New folder and workspace creation used browser `prompt()`; replaced with `CreateFolderModal`.
- Dialogs appeared dark when the OS used dark mode despite the app having no dark theme (`darkMode: 'class'`).

### Security

- Remediated 36 findings from the security audit (6 high, 15 medium, 15 low), including IDOR in workspace folders, S3 RBAC bypass, CSP and HSTS headers, HKDF-based encryption, session revocation, and related hardening. See `SECURITY_AUDIT.md` for the full report.

## [0.9.7] - 2026-06-24

### Fixed

- **S3 Signature Accept-Encoding Header Normalization:** Fixed S3 signature mismatch error (`SignatureDoesNotMatch`) when external clients (such as Go S3/AWS SDKs) include `Accept-Encoding` in their `SignedHeaders`. Cloudflare Workers automatically normalizes/modifies the incoming `Accept-Encoding` header value (e.g. appending brotli/`br`), which breaks strict SigV4 validation. Implemented header permutation fallbacks to try signature verification against original/typical client `Accept-Encoding` values (like `gzip`, `gzip, deflate`, etc.) when the signature fails.

## [0.9.6] - 2026-06-24

### Added

- **S3 HeadBucket API Route:** Implemented the `HEAD /s3/:bucket` (HeadBucket) endpoint. This allows external tools like Portainer to verify that a bucket (Workspace) exists and is accessible before launching backups, resolving connection validation failures.

## [0.9.5] - 2026-06-24

### Fixed

- Fixed S3 signature verification mismatch (`SignatureDoesNotMatch`) error on `PutObject` requests from external clients like Portainer. Implemented path-fallback signing verification to support client requests that compute the signature either with or without the `/s3` endpoint sub-path prefix. Added detailed XML error response outputs and server logging for S3 signature failures to aid in troubleshooting.

## [0.9.4] - 2026-06-24

### Fixed

- Added missing D1 database migration (`0006_add_sync_cache_columns.sql`) to add caching/sync tracking columns (`sync_ttl_minutes`, `last_synced_at`, `sync_status`) to the existing database in the production environment. These columns were referenced in backend code but omitted from the master schema definition.

## [0.9.3] - 2026-06-24

### Fixed

- Added missing D1 database migration (`0005_add_workspace_id_to_s3_credentials.sql`) to add `workspace_id` to the existing `s3_credentials` table in the production environment.

## [0.9.2] - 2026-06-24

### Added

- **Workspace-Scoped S3 API Keys:**
  - S3 credentials can now be scoped to a specific workspace, restricting bucket and object access to that workspace only.
  - New `workspace_id` column on `s3_credentials` table — `NULL` for global keys, populated for workspace-scoped keys.
  - Backend role-based authorization: only workspace `manager` or `owner` roles can create scoped keys.
  - S3 auth middleware propagates `s3WorkspaceId` context for downstream enforcement.
  - All 7 S3 object routes (ListBuckets, ListObjects, HeadObject, GetObject, PutObject, DeleteObject, Multipart) enforce workspace isolation when a scoped key is used.
  - Frontend S3 API Key management UI in Settings page with workspace selector, creation modal, one-time secret key copy, and delete confirmation.
  - API client methods: `getWorkspaces()`, `getS3Credentials()`, `createS3Credential()`, `deleteS3Credential()`.

- **Deploy Script Self-Update:**
  - `deploy.sh` now checks for upstream updates on startup using `git fetch` + `git rev-list`.
  - Interactive prompt to pull latest changes with uncommitted work protection via `git stash`.
  - Automatic stash recovery after pull, with conflict detection and rollback support.
  - Script auto-restarts after a successful update to run the latest version.

### Fixed

- Fixed CORS issues in production by setting `FRONTEND_URL` variable for the CORS middleware in `wrangler.toml`.
- Tracked `.env.production` so the web frontend builds with the correct `VITE_API_URL` on deploy.
- Fixed Safari/WebKit date parsing issue with SQLite `datetime('now')` format by normalizing to ISO 8601.

## [0.9.1] - 2026-06-21

### Fixed

- Fixed Cloudflare Workers production deploy failing with `No such module "node:crypto"` ([error 10021](https://developers.cloudflare.com/workers/observability/errors/#validation-errors-10021)) by upgrading compatibility flag from `nodejs_compat` (polyfill mode) to `nodejs_compat_v2` (actual Node.js built-ins), required for `compatibility_date >= 2024-09-23`.
- Untracked `wrangler.toml` from `.gitignore` so deployment configuration is now version-controlled and reproducible across environments.

## [0.9.0] - 2026-06-21

### Added

- **S3 Object Storage Compatibility Layer:**
  - Full S3-compatible API exposed at `/s3/*` using path-style access (`/s3/<bucket>/<key>`)
  - Each Omnidrive workspace maps as one S3 bucket
  - New credentials API (`POST/GET/DELETE /api/s3-credentials`) to generate per-user Access Key ID & Secret Access Key
  - AWS Signature Version 4 (SigV4) authentication middleware with clock skew validation (±15 min), presigned URL support, and timing-safe signature comparison
- **S3 Endpoints implemented:**
  - `GET /s3/` — ListBuckets
  - `GET /s3/:bucket` — ListObjectsV2 with prefix and delimiter support (folder simulation)
  - `HEAD /s3/:bucket/:key` — HeadObject
  - `GET /s3/:bucket/:key` — GetObject (streamed)
  - `PUT /s3/:bucket/:key` — PutObject (single-part, direct stream to Google Drive)
  - `DELETE /s3/:bucket/:key` — DeleteObject
  - `POST /s3/:bucket/:key?uploads` — Initiate Multipart Upload
  - `PUT /s3/:bucket/:key?uploadId=&partNumber=` — Upload Part (buffered in Google Drive temp folder)
  - `POST /s3/:bucket/:key?uploadId=` — Complete Multipart Upload (stream-concatenates parts)
  - `DELETE /s3/:bucket/:key?uploadId=` — Abort Multipart Upload
- **Google Drive Buffering**: Multipart upload parts are stored as temporary files in a Google Drive folder, then stream-concatenated on completion — no memory limit for large file uploads
- **S3-compliant ETag**: Single-part uploads use MD5 hex; multipart uses `md5(concat(part_md5s))-N` format
- **XML Error Responses**: All S3 errors returned as proper XML (`<Code>`, `<Message>`) with correct HTTP status codes
- **New DB Tables**: `s3_credentials`, `s3_multipart_uploads`, `s3_multipart_parts`
- **Compatible clients**: rclone, aws-cli, boto3, AWS SDK (with `endpoint_url` and `force_path_style=true`)
- **Tests**: 33 new tests covering SigV4 auth, all CRUD operations, multipart sequence, error paths, XML escaping, and presigned URLs

### Fixed

- Fixed `GetObject` and `DeleteObject` returning plain-text `"Object not found"` instead of S3-compliant `<Code>NoSuchKey</Code>` XML error — caused S3 clients to crash instead of gracefully handling missing keys
- Fixed `copyFile` in Google Drive service to include `md5Checksum` in API fields for accurate ETag tracking

## [0.8.15] - 2026-06-14

### Added

- Added file input UI to the upload modal when the upload queue is empty, allowing users to select files directly.

### Changed

- Renamed "Recent" navigation menu to "Home" and moved it to the top of the sidebar.
- Redesigned the storage overview in the sidebar to use a single stacked progress bar.
- Reordered the "Settings" menu to be below "Users".

### Removed

- Removed the "Manage Storage" button from the sidebar.

### Fixed

- Fixed the `allDone` logic in the upload modal to correctly handle an empty queue.

## [0.8.14] - 2026-06-14

### Changed

- Moved the storage category overview visualization to the sidebar for a more integrated experience.
- Redesigned the category overview as a horizontal stacked bar chart, matching the style of native Google Drive.
- Improved the file categorization accuracy to correctly identify and group Google Workspace mime-types (Docs, Sheets, Slides, Photos).

## [0.8.13] - 2026-06-14

### Added

- Implemented a storage category overview endpoint to aggregate file sizes by category (Images, Videos, Documents, Audio, Archives, Others).
- Integrated `recharts` to render interactive charts.

## [0.8.12] - 2026-06-14

### Changed

- Unified file double-click behavior to always display the preview modal, including for Google Workspace native files (Docs, Sheets).
- Changed the 'Users' sidebar menu icon to a more relevant user management icon (`UserCog`).
- Stopped auto-assigning Google profile data (email, name, avatar) to user accounts when linking a Google Drive.

### Removed

- Removed the placeholder 'Computers' menu from the sidebar.
- Removed the 'New' button from the sidebar.

## [0.8.10] - 2026-06-14

### Added

- **Docker Sync Resilience:**
  - Implemented chunked initial sync with checkpointing and state lock
  - Added `next_page_token` to `sync_state` schema to support resume-able syncs
  - Added OOM-safe generator based `iterateAllFilesAndFolders` to GoogleDriveService
  - Implemented startup DB cleanup and graceful shutdown handling (e.g. SIGTERM)
- **Agent Skills & Documentation:**
  - Added `publish-release` skill definition, design, and plan
  - Added Docker Sync Resilience plan and design specifications

### Fixed

- **Sync Stability:**
  - Improved sync logic and atomic upserts based on code review
  - Integrated `getIsShuttingDown` check into sync loops to prevent concurrent syncs
  - Refined Google Drive generator and cron behavior based on feedback


## [0.6.0] - 2026-06-12

### Added

- **File Selection & Bulk Actions:**
  - Added shift-click range selection and improved hit areas in the File Grid
  - Connected bulk "Move Drive" functionality to FilesPage, SearchPage, and DashboardPage
  - Upgraded `MoveDriveModal` to robustly handle bulk file operations
  - Refactored `BulkActionBar` to a new floating pill design
  - Added `selectMultiple` support to the selection store

### Fixed

- **Stability & Error Handling:**
  - Handled preview image error to prevent application crashes
  - Resolved double toast notifications and inconsistent error logic in `MoveDriveModal`
  - Corrected `MoveDriveModal` success logic to properly handle "all-skipped" edge cases
  - Fixed an issue where selection mode wouldn't automatically close upon location change
  - Fixed redundant logic in `handleItemClick` during file selection
  - Removed stray closing div causing build errors in `FilesPage`
  - Fixed broken and orphaned tests in `InviteUserModal` and `WorkspaceTabs` to ensure test suite integrity

### Changed

- Improved file and folder icons for a more polished and enterprise look.
- Increased spacing between icons and file names for better readability.
- Ensured the navigation toolbar remains visible during active file selection.

## [0.5.0] - 2026-06-11

### Added

- **Performance & Load Optimization:**
  - Implemented keyset pagination (cursor-based) for folders API
  - Added infinite scroll fetching logic in workspace page
  - Implemented stale-while-revalidate caching for folders
  - Added hover prefetch and caching endpoint integration in `useMergedDrive`
- **User Management Refactoring:**
  - Updated backend auth and admin routes
  - Refactored `AdminUsersPage` and removed deprecated components
  - Hid current user actions in `AdminUsersPage` for safety
  - Updated sidebar and login page designs
- **Sync Tracking & Info Panel:**
  - Added sync tracking columns to the database/types
  - Added manual sync button and "last synced" info to the InfoPanel

### Fixed

- Resolved workspace race conditions and preserved infinite scroll on deletion
- Refactored `getFolderContents` and added limit support
- Addressed various TypeScript type errors in `useMergedDrive` and `InfoPanel`
- Reverted `getFolderContents` for native drive folders to `getDriveFolderContents`
- Enforced hiding of current user actions using username fallback in `AdminUsersPage`
- Correctly checked current user id in `AdminUsersPage`
- Removed unused `useAuthStore` in SettingsPage

## [0.4.0] - 2026-06-10

### Security

- **Comprehensive Security Hardening:**
  - Implemented CSRF guard middleware with Origin/Referer validation on all mutating API endpoints
  - Added in-memory sliding window rate limiting for authentication, shared link verification, and global APIs
  - Added security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, CSP)
  - Fixed IDOR vulnerabilities in shared link creation and downloading by enforcing ownership scoping
  - Hardened JWT signing by using a dedicated `JWT_SECRET` key and enforcing token expiration
  - Added AES-256-GCM encryption for Google OAuth tokens at rest in KV storage
  - Integrated PKCE (Proof Key for Code Exchange) S256 into the OAuth flow
  - Enforced strong password complexity requirements
  - Prevented SSRF (Server-Side Request Forgery) via webhook URL validation
  - Tightened CORS policy to strictly limit localhost access during development
  - Sanitized API error messages to prevent internal details leakage
  - Prevented role escalation when assigning workspace members
  - Enforced a 30-day absolute session lifetime limit

## [0.3.0] - 2026-06-10

### Added

- **User & Team Management:**
  - Dynamic user profile display in Header based on authentication state
  - Global `AdminUsersPage` for managing all users (restricted to admins)
  - Features to invite, block/unblock, and delete users
  - Proper UI components for invitations (`InviteUserModal`) and routing guards (`SetupGuard`)

### Fixed

- **Role Management:**
  - Standardized user roles to `super_admin` and `member` across backend and frontend.
  - Ensured new users correctly default to `member` role upon registration.
  - Prevented non-admin users from viewing or interacting with the "Admin: Invitation Codes" component in the settings page.

## [0.2.0] - 2026-06-09

### Added

- **Enterprise Workspace:**
  - Team Workspaces with Role-Based Access Control (RBAC)
  - Workspace Quotas and Data Retention Policies
  - Automated cron jobs for data retention and audit log cleanup
  - Comprehensive Audit Logging for workspace actions
  - Notion-style hierarchical workspace sidebar and tabbed interface
- **Search & Metadata (Phase 3):**
  - Unified Global Search with metadata filtering
  - Custom file metadata properties and editor
  - Visual metadata badges in the File Grid
- **Bulk Actions:**
  - Checkboxes for multiple file selection in Grid and List views
  - Bulk Move, Delete, and Add to Workspace operations
- **Database Management:**
  - `make reset-local` and `make reset-remote` for complete factory reset of D1 and KV data

### Changed

- Replaced Virtual Folders with the new Enterprise Workspace system in the frontend UI

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

[unreleased]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.7...HEAD
[0.9.7]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/asmaraputra/OmniDrive/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/asmaraputra/OmniDrive/compare/v0.8.15...v0.9.0
[0.8.15]: https://github.com/asmaraputra/OmniDrive/compare/v0.8.14...v0.8.15
[0.8.14]: https://github.com/asmaraputra/OmniDrive/compare/v0.8.13...v0.8.14
[0.8.13]: https://github.com/asmaraputra/OmniDrive/compare/v0.8.12...v0.8.13
[0.8.12]: https://github.com/asmaraputra/OmniDrive/compare/v0.8.10...v0.8.12
[0.8.10]: https://github.com/asmaraputra/OmniDrive/compare/v0.6.0...v0.8.10
[0.6.0]: https://github.com/asmaraputra/OmniDrive/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/asmaraputra/OmniDrive/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/asmaraputra/OmniDrive/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/asmaraputra/OmniDrive/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/asmaraputra/OmniDrive/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/asmaraputra/OmniDrive/releases/tag/v0.1.0
