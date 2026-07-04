# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Mobile responsiveness (web SPA <768px):** sidebar & InfoPanel kini drawer overlay di mobile (sebelumnya inline fixed-width yang makan layar / overflow horizontal), Header & Omnibar wrap + sembuny di very-small viewport, BulkActionBar wrap + touch target ≥44px (sebelumnya `min-w-[500px]` fixed yang pasti overflow di phone), FilesPage toolbar wrap + filter collapse, FileGrid list view sembunyikan kolom Size/Modified di mobile, WorkspaceSidebar drawer + toggle button di WorkspaceMainView, padding halaman responsif (`p-4 sm:p-6`), Dialog width `calc(100%-1rem)` + padding responsif, AdminUsersPage tabel `overflow-x-auto`, AutomationsPage dikonversi dari inline-style CSS-var (yang tak terdefinisi di Tailwind setup ini) ke Tailwind classes. Store `useUIStore` tambah state `mobileSidebarOpen` terpisah dari desktop collapse `isSidebarOpen`.

- **Redesign halaman Home (`DashboardPage`) — Bento Dashboard (Konsep 3):** grid asimetris 4-kolom dengan cell span varied (hero storage `col-span-2 row-span-2`, donut kategori `col-span-2`, quick-access `col-span-2` tinted `bg-surface`, drives full-width `col-span-4`, recent `col-span-3`, admin `col-span-1`). Hero storage menampilkan persen besar (5xl/6xl) + `QuotaBar`. Breakdown per tipe file kini donut chart (Recharts `PieChart` innerRadius 62% dengan label `formatFileSize(totalUsed)` di tengah) + legend top-4, ganti stacked bar horizontal. Empty state saat belum ada drive terhubung + CTA Settings. Loading skeleton match bento shape. Reveal stagger CSS-driven (`.bento-reveal` keyframe `bento-fade-up`, `animation-delay` cascade, honor `prefers-reduced-motion`). Hover lift `-translate-y-[1px]` pada quick-link. Tanpa dep baru (Recharts sudah ada, motion CSS-only).

- **Drive identity colors (`--drive-1`..`--drive-5`):** token CSS didefinisikan di `index.css` `:root`. Sebelumnya `getDriveColor(index)` merujuk `var(--drive-N)` yang tak pernah didefinisikan, sehingga tile drive di Dashboard & Settings render tanpa warna latar. Warna: blue (brand primary), teal, amber, red, green — round-robin per index drive.

- **Recalibrasi palette brand (Opsi B — Cobalt accent):** `primary` `#0B57D0` (Google Blue) → `#2563EB` (electric blue, Tailwind `blue-600`) dan `surface` `#F0F4F9` (abu biru hangat) → `#F1F5F9` (cool gray slate) di `tailwind.config.js`. Drive-1 identity color ikut `#2563EB`. Hardcoded `bg-blue-600`/`text-blue-600` di 10 file (Button, FileGrid selection, InfoPanel, Header avatar, Omnibar, dsb) sudah match tanpa ubah. Tujuan: visual lebih "premium SaaS", kurang Google-Drive literal, tetap satu accent konsisten. Token-driven: 2 titik perubahan, propagasi ke semua 7 file pemakai `bg-primary`/`bg-surface`.

### Removed

- **Pembersihan artefak dev/testing:** hapus skrip smoke-test production (`scripts/prod-browser-test*.mjs`, `scripts/prod-upload-test.mjs`), skrip one-off migrasi/rename (`replace_terms.mjs`, `packages/worker/refactor*.js`, `packages/worker/scripts/add_sync_cache_columns.sql`), skrip debug SQLite (`query.cjs`, `query2.cjs`), dump diff (`full_diff.txt`), dan artefak lokal hasil test (`.prod-auth-state.json`, `.prod-test-files/`). Hapus `console.log` debug di `sync.ts` dan `index.ts` (cron handler); pertahankan `console.error` untuk error handling.

### Changed

- **S3 bucket lifecycle rules (Option A — trash, bukan hard delete):** endpoint S3 baru `PutBucketLifecycleConfiguration` / `GetBucketLifecycleConfiguration` / `DeleteBucketLifecycleConfiguration` via subresource `?lifecycle` di route `/:bucket` (kompatibel aws-cli/rclone). Rule `Expiration/Days` per prefix disimpan di tabel baru `s3_lifecycle_rules` (migrasi `0008`). Cron `*/30` yang sudah ada menjalankan `runLifecycleExpiration`: file yang lebih tua dari `expiration_days` di-**trash** ke Google Drive (`trashFile`, recoverable ~30 hari) + `is_trashed = 1`, **bukan** hard delete. Parser XML pakai regex (tanpa dep baru, ikut pola multipart). Test: `tests/s3-lifecycle.test.ts`.

- **Account health badge di Settings > Connected Drives:** `DriveAccountCard` kini menampilkan badge `· reconnect needed` (token OAuth hilang/expired) atau `· unreachable` (quota API gagal saat cek terakhir). Sinyal `health` diturunkan dari cabang yang sudah dijalankan `/api/drives` GET (`auth_expired` bila tak ada token di KV, `error` bila fetch quota gagal, `connected` bila sukses) — tanpa kolom DB baru atau cron. Badge hanya muncul untuk state bermasalah (connected = tanpa clutter).

- **Upload spillover saat preferred drive penuh:** `UploadRouter.selectDriveForUpload` dulu `throw` "Insufficient quota in preferred drive" bila drive pilihan user tak muat. Sekarang fallback (spillover) ke drive dengan free space terbanyak; hanya `throw` "Insufficient overall quota" bila tak ada drive yang muat file. Auto-select tanpa preferensi tak berubah (tetap pilih paling lapang). Cross-drive split (striping) di luar scope.

- **Rebrand OmniDrive → AzaDrive (string UI + domain production):** ganti brand string yang terlihat user di `index.html` (title + meta description), `Header.tsx`, `LoginPage.tsx`, `SetupPage.tsx`, `FilesPage.tsx`, `SettingsPage.tsx`, `Omnibar.tsx`, `DriveAccountCard.tsx`, dan `Header.test.tsx`. `FRONTEND_URL` di `packages/worker/wrangler.toml` diarahkan ke `https://azadrive.my.id`. **Infra identifier TIDAK diubah** (nama folder tetap OmniDrive, cookie `omnidrive_sid`, worker `omnidrive-api`, D1 `omnidrive`, KV, HKDF salt `omnidrive-token-v1`, prefix multipart `.omnidrive_multipart_`) karena mengubahnya memutus session/enkripsi/binding production yang sudah berjalan.

- **Pindah editor kapasitas storage manual dari Dashboard ke Settings:** tombol gear + form input override (`quota_override`) sekarang ada di `DriveAccountCard` (halaman Settings > Connected Drives), bukan lagi inline di kartu drive Dashboard. Dashboard "Connected Drives" kembali read-only (bar + badge `· manual` saja). Logic edit/save quota (`startEditQuota`/`saveQuota`/`parseSizeToBytes`) dipindah ke `DriveAccountCard` dengan callback `onQuotaSaved` untuk refresh drives; `SettingsPage` mewire `onQuotaSaved={fetchDrives}`.

- **Hapus AI-slop visual di halaman auth & Dashboard:** `LoginPage`, `SetupPage`, dan banner "Total Storage" di `DashboardPage` sebelumnya memakai gradient (`bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100`, dsb), floating blur blob, glassmorphism (`bg-white/80 backdrop-blur-sm`), dan palet indigo yang tidak dipakai di mana pun lagi di app inti (inkonsistensi accent). Diseragamkan ke bahasa visual app inti: `bg-surface` (#F0F4F9), card `bg-white border border-gray-200 rounded-2xl shadow-sm`, accent `primary` (#0B57D0), radius `rounded-lg`, input focus `ring-primary`. Ganti `min-h-screen` → `min-h-[100dvh]` (viewport stability). Copy hero login "Your unified Google Drive gateway" → "Sign in to your account".

### Fixed

- **Kapasitas storage per akun tidak akurat:** `parseStorageQuota` memakai `storageQuota.usage` dari Google Drive API, yang mencakup **seluruh akun Google** (Drive + Gmail + Photos), bukan hanya pemakaian Drive akun tersebut. Diperbaiki untuk memakai `storageQuota.usageInDrive` (Drive-only) dengan fallback ke `usage` bila `usageInDrive` tidak ada (mis. beberapa shared folder service account). Cache KV quota diberi `QUOTA_CACHE_VERSION` agar entri lama (angka akun-wide) otomatis diabaikan dan angka langsung akurat tanpa menunggu TTL 5 menit.

### Added

- **Manual storage capacity override per drive:** Google Drive API **tidak** mengekspos `storageQuota.limit` untuk Google Workspace pooled storage dan service account (hanya "if applicable"), sehingga drive-drive terebut selalu menampilkan 1 TiB (fallback `UNLIMITED_DRIVE_QUOTA_BYTES`) alih-alih kapasitas asli (mis. 5 TiB). Tambah kolom DB `drive_accounts.quota_override` (migrasi `0007`), endpoint `PATCH /api/drives/:id/quota`, dan tombol pengaturan (ikon gear) di kartu drive Dashboard untuk set kapasitas manual sekali. Override diprioritaskan di `computeDriveQuota` di atas nilai live API dan fallback. Saat Google omit limit, route tidak lagi menimpa `total_quota` DB dengan 1 TiB. Helper frontend `parseSizeToBytes` mendukung input seperti "5 TB", "500 GB".

- **Dokumentasi proyek diperkuat untuk AI agent:** `AGENTS.md` sekarang memuat peta navigasi dokumen (kapan baca, section utama, anchor) untuk `ARCHITECTURE.md`, `DESIGN.md`, `SCHEMA.md`, `CHANGELOG.md` agar agent baru tidak kesusahan menemukan komponen dan hemat token. Keempat dokumen di-update dengan status terkini proyek (kolom `quota_override` + migrasi `0007` di SCHEMA, alur quota/override di ARCHITECTURE, capacity editor di DESIGN).

- **Agentation integration:** wired `<Agentation>` component into `main.tsx` (dev-only via `import.meta.env.DEV`) for in-browser annotation feedback during development
- **Smooth expand/collapse animations across the web app:** installed `tailwindcss-animate` plugin and added transitions to 15 components:
  - **Sidebar:** animated width transition between expanded (w-64, icons+labels) and collapsed (w-16, icon rail) with fixed-width inner wrapper so icons stay put
  - **InfoPanel:** curtain `transition-[width]` pattern (w-80 ↔ w-0), always-mounted; also fixes a pre-existing React hooks violation
  - **6 custom modals migrated to Radix Dialog:** UploadModal, FilePreviewModal, ShareModal, EditShareModal, AddToWorkspaceModal, AddUserModal — now get enter+exit fade/zoom/slide, focus trap, Escape close, backdrop click
  - **3 accordions:** ShareModal & EditShareModal "Advanced Settings", SettingsPage "Service Account" form — `grid-rows-[1fr]/[0fr]` transition
  - **WorkspaceTreeNode:** tree expand/collapse via `grid-rows` transition
  - **Omnibar:** advanced search panel + results dropdown — `animate-in fade-in-0 slide-in-from-top-2`
  - **BulkActionBar:** `animate-in slide-in-from-bottom-5` enter animation
  - **Toast:** enter + exit animation via delayed-unmount pattern in `toastStore` (`removing` flag + 300ms delayed removal)
  - **Bonus:** existing Radix Dialog/DropdownMenu/ContextMenu classes (`animate-in`, `fade-in-0`, `zoom-in-95`, etc.) now produce actual CSS since the plugin was previously missing

### Changed

- **Production deploy (Cloudflare):** D1/KV resource akun `asmaraputra`, `wrangler.toml` + `.env.production` diarahkan ke Worker (`omnidrive-api.asmara-putra.workers.dev`) dan Pages (`omnidrive-ajm.pages.dev`)
- **Google Drive move:** perbaikan logika move file/folder di `google-drive.ts` beserta test

### Fixed

- **Dialog/popup warna gelap saat OS dark mode:** shadcn components (Dialog, DropdownMenu, ContextMenu, Button) dan `SidebarStorage` memuat `dark:*` utilities yang, karena `tailwind.config.js` tidak menetapkan `darkMode`, memakai default Tailwind v3 `'media'` — sehingga aktif otomatis mengikuti `prefers-color-scheme: dark` OS dan membuat dialog/pop-up tampak hitam meski proyek tidak punya dark mode. Ditambah `darkMode: 'class'` agar `dark:*` hanya aktif under eksplisit `.dark` ancestor (yang tidak pernah ditambahkan app), mematikan efek gelap di seluruh dialog/form/pop-up sekaligus.
- **Login "Too many requests" (429) prematur:** `rateLimiter` memakai satu `Map` shared level modul untuk semua instance. Karena `POST /api/auth/login` cocok dengan dua middleware sekaligus — limiter login (`10/60s`) dan limiter global `/api/*` (`100/60s`) — keduanya menulis ke bucket IP yang sama, sehingga satu request login terhitung dua kali (5 × 2 = 10 → 429). Di `wrangler dev`, semua request dari `127.0.0.1` juga berbagi satu bucket, sehingga traffic API lain menghabiskan budget login. Diperbaiki dengan memberi setiap instance `rateLimiter` `Map`-nya sendiri sehingga bucket tiap limiter independen — tidak ada double-counting maupun collision antar limiter. Ditambah test regresi untuk skenario overlap route.
- **New Folder / New Workspace memakai modal browser (`prompt()`):** button "New Folder" di FilesPage dan "New Workspace"/"New Folder" di WorkspacesPage sebelumnya memanggil `prompt()` browser asli, yang tidak konsisten dengan UI lain dan tidak bisa di-style. Dibuat komponen `CreateFolderModal` (Radix Dialog, mengikuti pola `EditShareModal`) dengan text input, loading state, error display, dan toast. Modal ini reusable — menangani baik pembuatan folder maupun workspace via `api.createFolder(name, parentId)` (parentId `null` = root workspace, string = subfolder).
- **Security audit — 36 temuan diperbaiki (6 HIGH, 15 MEDIUM, 15 LOW):**
  - **H1/H2/H6 — IDOR di workspace folders & shared-link creation:** semua endpoint folder/workspace-scoped (`GET/PUT/DELETE/star/unstar`, share-link create untuk folder) sekarang memverifikasi keanggotaan `workspace_members` sebelum query/mutasi. Sebelumnya user terautentikasi bisa membaca/mengubah/menghapus folder atau membuat share-link untuk workspace yang bukan miliknya.
  - **H3 — S3 RBAC bypass:** handler S3 di `routes/s3.ts` sekarang retrieve `wm.role` dan enforce — read ops (`GET/HEAD/LIST`) butuh `viewer`+; write ops (`PUT/POST/DELETE`) butuh `editor`+. `POST /api/s3-credentials` tanpa `workspaceId` butuh role `manager` di minimal satu workspace (sebelumnya tanpa cek).
  - **H4 — S3 signature oracle:** error response XML tidak lagi membocorkan `CanonicalRequest`/`StringToSign`/`err.message` ke client. Server-side `console.error` tetap ada untuk debugging.
  - **H5 — Content-Security-Policy:** ditambahkan CSP strict di `securityHeaders` middleware (`default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; ...`).
  - **M1/M2 — Rate limiting:** `app.use('/s3/*', rateLimiter(...))` + dedicated limiter untuk shared-link download (`/api/shared/:id/download`).
  - **M3 — TOCTOU di `maxDownloads`:** diganti dengan atomic conditional `UPDATE ... WHERE max_downloads IS NULL OR download_count < max_downloads RETURNING ...` — concurrent download tidak bisa double-count.
  - **M4 — `requireEmail`/`allowUploads` enforcement:** `requireEmail` sekarang benar-benar dicek di `meta`/`download` (return 403 kalau belum verifikasi email). `allowUploads` ditolak saat create/update karena belum ada public upload endpoint — tidak menyimpan false sense of security.
  - **M5 — KDF untuk at-rest encryption:** `getKey()` di `lib/crypto.ts` diganti dari truncate+zero-pad ke **HKDF-SHA256 via Web Crypto `deriveKey`**. Ciphertext di-prefix `v1:` untuk forward-compat key rotation.
  - **M6 — `decryptOrPassthrough`:** fallback plaintext hanya dengan explicit `plain:` marker — bare plaintext ditolak (no more silent downgrade).
  - **M7 — Manager dapat remove owner:** hanya `owner` yang boleh remove `owner`; tolak kalau target adalah owner terakhir (mencegah orphan workspace).
  - **M8 — Bootstrap token:** optional `BOOTSTRAP_TOKEN` env var. Kalau di-set, registrasi super-admin pertama butuh token (mencegah race claim unclaimed instance). `setup-status` tetap publik tapi tidak reveal apakah token required.
  - **M9 — SSRF webhook validation:** `validateWebhookUrlAsync` resolve DNS via Cloudflare DoH, block IPv6 ULA/link-local, CGNAT, `0.0.0.0/8`. DNS rebinding belum fully mitigated (Workers runtime tidak expose socket-level IP pinning).
  - **M10 — S3 PUT/POST body commitment:** wajib `x-amz-content-sha256`; tidak terima `UNSIGNED-PAYLOAD` untuk write ops.
  - **M11 — HSTS:** `Strict-Transport-Security: max-age=31536000; includeSubDomains` di HTTPS.
  - **M13 — Google API error leak:** raw `err.message` dari Google API tidak lagi di-return ke client; diganti generic `'Failed to connect Google Drive account'`.
  - **M14 — `SameSite=None` cookie:** `Lax` kalau `FRONTEND_URL` & `WORKER_URL` share origin; `None` hanya kalau truly cross-origin.
  - **M15 — Session revocation:** ditambahkan `user_sessions:<userId>` KV index; sessions didaftarkan saat login, dihapus saat logout, dan bisa direvoke semua via `POST /api/auth/sessions/revoke`.
  - **L1–L15:** shared-link expiry check di verify, logout cookie `secure` flag derived, OAuth state cookie `sameSite`, bcrypt cost 10→12, error-handler dead code marked, password max 72 chars, `validateEmail` (regex), `policy.config.max_bytes` numeric check, automation `trigger_type` whitelist (`event`/`cron`), file-move target-workspace check, JSON-path injection sanitization, removed unused `console.log` of folder IDs, consistent `hasPermission` usage, `X-XSS-Protection: 0` (modern best practice).
  - **Tests:** 148/148 pass. `crypto.test.ts` (HKDF round-trip + `plain:` marker), `security-headers.test.ts` (CSP assertions), `s3-api.test.ts` (mock pattern updated for `wm.role` queries, auto-default `role:'owner'` agar S3 behavior test tidak crash oleh RBAC).
  - Lihat `SECURITY_AUDIT.md` untuk laporan lengkap semua 36 finding + lokasi + perubahan.

### Notes

- Fork dari [`abilfida/OmniDrive`](https://github.com/abilfida/OmniDrive) v0.9.7
- Maintainer: `asmaraputra` — remote `origin` → `asmaraputra/OmniDrive`
- Upstream opsional: `abilfida/OmniDrive` via `git fetch upstream`

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

### Changed (UI)

- **Aesthetics & Usability:**
  - Improved file and folder icons for a more polished and enterprise look
  - Increased spacing between icons and file names for better readability
  - Ensured the navigation toolbar remains visible during active file selection

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
