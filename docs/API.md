# OmniDrive API Reference

OmniDrive's API is served by a single Cloudflare Worker (or, in the Docker self-hosted
build, a Node.js process via `packages/worker/src/node-server.ts`). All routes are
registered in `packages/worker/src/index.ts:91-101`:

| Prefix            | Router file                        | Auth requirement                              |
|-------------------|------------------------------------|-----------------------------------------------|
| `/api/auth`       | `routes/auth.ts`                   | Mixed — see [Auth](#1-auth)                   |
| `/api/drives`     | `routes/drives.ts`                 | Cookie session                                |
| `/api/files`      | `routes/files.ts`                  | Cookie session                                |
| `/api/folders`    | `routes/folders.ts`                | Cookie session                                |
| `/api/workspaces` | `routes/workspaces.ts`             | Cookie session (role-escalation checks)       |
| `/api/shared`     | `routes/shared.ts`                 | Mixed — see [Shared Links](#5-shared-links)   |
| `/api/automations`| `routes/automations.ts`            | Cookie session                                |
| `/api/admin`      | `routes/admin.ts`                  | Cookie session + super admin                  |
| `/api/s3-credentials` | `routes/s3-credentials.ts`     | Cookie session                                |
| `/s3`             | `routes/s3.ts`                     | AWS SigV4 (`s3AuthMiddleware`)                |
| `/api/health`     | inline (`index.ts:104-106`)        | None                                          |

## Conventions

### Base URL

- **Local dev (Vite proxy):** `http://localhost:8999/api/*` (Vite proxies to Worker on `:8888`)
- **Local dev (direct):** `http://localhost:8888/api/*`
- **Docker unified:** `http://localhost:8080/api/*`
- **Cloudflare production:** `https://<worker>.workers.dev/api/*` (or your custom domain)

### Authentication

Authenticated endpoints require the `omnidrive_sid` cookie set by `/api/auth/login`
or `/api/auth/register`. The cookie is `HttpOnly`, `SameSite=Lax`, `Secure` (when
`FRONTEND_URL` is HTTPS), and has a **7-day sliding TTL** (`SESSION_TTL_MS`,
`lib/session-cookie.ts:3`). TTL is only refreshed if the session hasn't been touched
in the last hour (`auth-guard.ts:54-59`).

The guard (`middleware/auth-guard.ts`) loads the session from D1 on every request,
instantiates per-request services, and exposes them via `c.get()`. Missing/expired
cookies return `401` `{"error":"Not authenticated"|"Session expired"}`.

### CSRF Protection

`csrf-guard.ts` is applied to all `/api/*` routes. Non-safe methods (`POST`, `PUT`,
`PATCH`, `DELETE`) must send an `Origin` (or `Referer`) header that matches
`FRONTEND_URL` or `WORKER_URL`. Exempt paths: `/api/auth/google/callback`,
`/api/auth/login`, `/api/auth/register`, and `GET`/`POST /verify` on shared links.

### Rate Limits

Applied via `rate-limiter.ts` (sliding-window in-memory, per isolate). Limits
defined in `index.ts:67-89`:

| Path                        | Window   | Max | Key                         |
|-----------------------------|----------|-----|-----------------------------|
| `POST /api/auth/login`      | 60 s     | 10  | IP                          |
| `POST /api/auth/register`   | 600 s    | 10  | IP                          |
| `POST /api/shared/:id/verify`| 60 s    | 5   | `IP:linkId`                 |
| `GET /api/shared/:id/download`| 60 s   | 20  | `IP:linkId`                 |
| `/api/*` (catch-all)        | 60 s     | 100 | IP                          |
| `/s3/*`                     | 60 s     | 100 | IP                          |

When limited, response is `429 {"error":"Too many requests"}` with a `Retry-After`
header (seconds until oldest timestamp in the window expires).

### Validation

All request bodies are validated with `@hono/zod-validator` using the centralized
schemas in `lib/schemas.ts`. Validation failures return `400` with a single
`{"error":"<joined messages>"}` payload (`zodErrorHook`, `schemas.ts:18-26`).

### Error Responses

JSON errors share one shape:

```json
{ "error": "Human-readable message" }
```

Status codes used: `400` (bad request / validation), `401` (not authenticated),
`403` (forbidden / RBAC), `404` (not found), `409` (conflict), `410` (gone / link
expired), `415` (unsupported media type), `429` (rate limited), `500` (server
error), `502` (Google Drive upstream failure).

For `/s3/*` routes, errors are XML (`<Error><Code>…</Code><Message>…</Message></Error>`)
with S3-specific codes (`NoSuchBucket`, `NoSuchKey`, `AccessDenied`, `SignatureDoesNotMatch`,
etc.) — see [S3 API](#10-s3-object-storage-api).

---

## 1. Auth

**Base path:** `/api/auth` · **Router:** `routes/auth.ts` · **Auth:** mixed (per-endpoint)

| Method | Path                  | Auth required | Description                                    |
|--------|-----------------------|---------------|------------------------------------------------|
| `GET`  | `/setup-status`       | None          | Whether any user exists (first-run wizard)     |
| `POST` | `/register`           | None          | Register first user (open) or via invitation   |
| `POST` | `/login`              | None          | Username + password login                      |
| `GET`  | `/google`             | Cookie        | Get Google OAuth URL (Drive-connect flow)      |
| `GET`  | `/callback`           | None          | Google OAuth callback (state via cookie + DB)  |
| `GET`  | `/me`                 | Cookie        | Current session user                           |
| `POST` | `/change-password`    | Cookie        | Change password (revokes other sessions)       |
| `POST` | `/logout`             | Cookie        | Revoke current session                         |
| `POST` | `/sessions/revoke`    | Cookie        | Revoke all sessions                            |

### `POST /api/auth/register`

**Body** (`registerSchema`):

```json
{
  "username": "alice",
  "password": "Hunter2pass",
  "name": "Alice",
  "email": "alice@example.com",
  "invitation_code": "abc123..."
}
```

`password` must be ≥8 chars and contain uppercase, lowercase, and a digit.
`invitation_code` is required if any user already exists; if no user exists yet
and `BOOTSTRAP_TOKEN` env var is set, `invitation_code` must equal it.

**201 / 200** — sets `omnidrive_sid` cookie:

```json
{
  "success": true,
  "user": {
    "userId": "uuid",
    "username": "alice",
    "email": "alice@example.com",
    "name": "Alice",
    "avatarUrl": null,
    "role": "super_admin",        // "member" if not first user
    "createdAt": 1719300000000
  },
  "isSuperAdmin": true            // omitted on subsequent registrations
}
```

**Errors:** `400` Username already exists · `400` Email already exists ·
`400` Invitation code required · `400` Invalid invitation code ·
`400` Invitation code has reached its usage limit · `403` Bootstrap token required

### `POST /api/auth/login`

**Body** (`loginSchema`):

```json
{ "username": "alice", "password": "Hunter2pass" }
```

**200** — sets `omnidrive_sid` cookie:

```json
{
  "success": true,
  "user": { "userId": "…", "username": "…", "email": "…", "name": "…", "avatarUrl": null, "role": "member", "createdAt": 1719300000000 }
}
```

**Errors:** `401` Invalid credentials

### `GET /api/auth/google`

Returns Google's OAuth URL (PKCE S256). The SPA performs the redirect; the
session cookie is **not** relied on after the Google round-trip — `userId` is
persisted in the `oauth_states` D1 row and recovered in `/callback`.

**200:**

```json
{ "url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=…&scope=openid+email+profile+https://www.googleapis.com/auth/drive&…" }
```

**Errors:** `400` Google OAuth is not configured

### `GET /api/auth/callback?code=…&state=…`

Exchanges the Google code for tokens, persists encrypted tokens into
`drive_tokens`, creates a `drive_accounts` row (if first connection), and kicks
off a background sync via `c.executionCtx.waitUntil(syncDriveAccount(...))`.

**200:** `{ "success": true }`

**Errors:** `400` Authorization code missing · `400` Missing state parameter ·
`400` Invalid state parameter · `400` OAuth state expired ·
`400` OAuth session expired — please reconnect your Google account

### `GET /api/auth/me`

**200:**

```json
{ "user": { /* SessionData — same shape as /login response.user */ } }
```

### `POST /api/auth/change-password`

**Body** (`changePasswordSchema`):

```json
{ "currentPassword": "OldPass1", "newPassword": "NewPass1" }
```

After successful update, all sessions except the caller's are deleted
(`authRepo.deleteOtherSessions`).

**200:** `{ "success": true }`

**Errors:** `400` New password must be different from current password ·
`401` Current password is incorrect · `404` User not found

### `POST /api/auth/logout`

Deletes the current session row and clears the cookie.

**200:** `{ "success": true }`

### `POST /api/auth/sessions/revoke`

Deletes every session for the current user (including the caller's).

**200:** `{ "success": true }`

### `GET /api/auth/setup-status`

**200** (`Cache-Control: no-cache, no-store, must-revalidate`):

```json
{ "isSetup": false }
```

---

## 2. Drives

**Base path:** `/api/drives` · **Router:** `routes/drives.ts` · **Auth:** cookie
session on **all** routes (`drivesRouter.use('*', authGuard)`)

| Method   | Path                                                | Description                                   |
|----------|-----------------------------------------------------|-----------------------------------------------|
| `GET`    | `/`                                                 | List connected drives + live quota            |
| `GET`    | `/connect`                                          | Get Google OAuth URL to add a Drive           |
| `POST`   | `/service-account`                                  | Connect via Service Account JSON              |
| `GET`    | `/external`                                        | List items you own not in My Drive            |
| `GET`    | `/:driveId/external-folders/:googleFolderId`        | Live list of an external folder's children    |
| `GET`    | `/:driveId/folders/:googleFolderId`                | Read a Drive folder (DB-backed)               |
| `POST`   | `/:driveId/folders/:googleFolderId/sync`           | Lazy-sync a single Drive folder               |
| `POST`   | `/:id/sync`                                         | Manual full-drive sync                        |
| `POST`   | `/:driveId/folders`                                 | Create a Google Drive folder                  |
| `PATCH`  | `/:driveId/folders/:googleFolderId/rename`         | Rename a Drive folder                          |
| `DELETE` | `/:driveId/folders/:googleFolderId`                | Trash a Drive folder                          |
| `POST`   | `/:driveId/folders/:googleFolderId/restore`        | Restore a trashed Drive folder                |
| `DELETE` | `/:driveId/folders/:googleFolderId/permanent`      | Permanently delete a Drive folder             |
| `POST`   | `/:driveId/folders/:googleFolderId/star`           | Star a Drive folder                           |
| `POST`   | `/:driveId/folders/:googleFolderId/unstar`         | Unstar a Drive folder                         |
| `PATCH`  | `/:driveId/move/:googleFileId`                      | Move a file/folder within the same Drive      |
| `DELETE` | `/:id`                                              | Disconnect a Drive account                    |

### `GET /api/drives`

Returns every connected Drive for the user with live quota (fetched from Google
and cached in `drive_accounts`). Each row includes a `health` field:
`connected` | `auth_expired` | `error`.

**200:**

```json
{
  "drives": [
    {
      "id": "uuid",
      "userId": "uuid",
      "googleAccountId": "12345",
      "email": "alice@gmail.com",
      "name": "Alice",
      "type": "oauth",                  // or "service_account"
      "isPrimary": true,
      "rootFolderId": null,
      "totalQuota": 16106127360,
      "usedQuota": 5368709120,
      "quotaOverride": null,
      "quotaUpdatedAt": "2026-06-25T12:00:00Z",
      "syncStatus": "idle",             // idle | syncing | error
      "syncErrorMessage": null,
      "syncPaused": false,
      "lastSyncedAt": "2026-06-25T11:30:00Z",
      "createdAt": "2026-06-01T00:00:00Z",
      "freeSpace": 10737418240,
      "usagePercent": 33.33,
      "health": "connected"
    }
  ],
  "aggregate": {
    "totalQuota": 16106127360,
    "totalUsed": 5368709120,
    "totalFree": 10737418240,
    "driveCount": 1
  }
}
```

### `GET /api/drives/connect`

Identical flow to `GET /api/auth/google` but with `prompt=select_account consent`
to allow connecting additional accounts. Returns `{ "url": "…" }`.

### `POST /api/drives/service-account`

**Body** (`serviceAccountSchema`):

```json
{
  "credentials": "{ \"type\": \"service_account\", \"client_email\": \"…\", \"private_key\": \"…\" }",
  "folderId": "0B-XXXXXXXXXXXXXXXX"
}
```

Verifies the JSON, fetches an access token, verifies folder access, then inserts
a `drive_accounts` row with `type='service_account'` and kicks off background sync.

**200:** `{ "success": true, "driveId": "uuid" }`

**Errors:** `400` Invalid service account JSON · `400` Failed to connect Google Drive account ·
`400` Cannot access the specified shared folder · `409` This service account is already connected

### `GET /api/drives/external`

Lists items you own that are NOT in My Drive — computer backup roots, files/folders you created inside someone else's shared folder (any depth). Uses a recursive CTE on the `drive_folders` parent chain.

**200:** `[ /* FileEntry-like array */ ]`

### `GET /api/drives/:driveId/folders/:googleFolderId`

Reads a Drive folder from D1 only (no Google API call). Use `googleFolderId=root`
for the Drive root.

**200:**

```json
{
  "folder": { "googleFolderId": "root", "name": "My Drive", "isSynced": true },
  "subfolders": [ /* DriveFolder[] */ ],
  "files":      [ /* FileEntry[] */ ],
  "breadcrumb": [ { "id": "root", "name": "All Files" } ]
}
```

**Errors:** `404` `{"error":"Drive not found"}` (when `driveId` not owned by user)

### `POST /api/drives/:driveId/folders/:googleFolderId/sync`

Lazy-sync: if the folder is already `is_synced=1`, returns the cached contents;
otherwise fetches live from Google, upserts rows, marks synced, and returns the
new contents. Same response shape as the GET read endpoint.

**Errors:** `404` Drive not found · `400` `{"error":"No tokens for drive"}` (auth expired)

### `POST /api/drives/:id/sync`

Triggers a full-drive background sync via `syncDriveAccount()` and returns
immediately. The sync runs in `c.executionCtx.waitUntil()`.

**200:** `{ "success": true }`

### `POST /api/drives/:driveId/folders`

**Body** (`createDriveFolderSchema`):

```json
{ "name": "New Folder", "parentId": "0B-…" }
```

**200:** `{ "success": true, "googleFolderId": "0B-new-folder-id" }`

### `PATCH /api/drives/:driveId/folders/:googleFolderId/rename`

**Body** (`renameDriveFolderSchema`):

```json
{ "name": "Renamed Folder" }
```

**200:** `{ "success": true }`

### `PATCH /api/drives/:driveId/move/:googleFileId`

Move a file or folder within the same Drive (Google `files.update` with `addParents`/`removeParents`).

**Body** (`moveWithinDriveSchema`):

```json
{
  "targetFolderId": "0B-target",
  "oldParentId": "0B-old",
  "isFolder": false
}
```

**200:** `{ "success": true }`

### Trash / Restore / Permanent Delete / Star / Unstar / Disconnect

All return `{ "success": true }` on success.

| Method & Path                                                     | Side effect                                       |
|-------------------------------------------------------------------|---------------------------------------------------|
| `DELETE /:driveId/folders/:googleFolderId`                        | Google trash + DB `is_trashed=1`                  |
| `POST /:driveId/folders/:googleFolderId/restore`                  | Google untrash + DB `is_trashed=0`                |
| `DELETE /:driveId/folders/:googleFolderId/permanent`              | Permanent Google delete (irreversible)            |
| `POST /:driveId/folders/:googleFolderId/star`                     | Google star                                       |
| `POST /:driveId/folders/:googleFolderId/unstar`                   | Google unstar                                     |
| `DELETE /:id`                                                      | Disconnect: deletes tokens + drive row + files    |

---

## 3. Files

**Base path:** `/api/files` · **Router:** `routes/files.ts` · **Auth:** cookie
session on **all** routes. Business logic lives in `FileService` (injected via
`c.get('fileService')`); most routes are thin wrappers.

| Method   | Path                       | Description                                  |
|----------|----------------------------|----------------------------------------------|
| `GET`    | `/recent`                  | Recent files (owned + workspace)             |
| `GET`    | `/category-overview`       | Counts/size grouped by MIME category         |
| `GET`    | `/search`                  | Search by name + metadata filter             |
| `GET`    | `/starred`                 | Starred files                                |
| `GET`    | `/trash`                   | Trashed files                                |
| `GET`    | `/:id/preview`             | Inline image stream (preview)                |
| `GET`    | `/:id/download`            | File download (attachment)                   |
| `DELETE` | `/:id`                     | Move to trash (Google trash + DB `is_trashed=1`) |
| `POST`   | `/:id/restore`             | Restore from trash                           |
| `DELETE` | `/:id/permanent`           | Permanent delete                             |
| `POST`   | `/:id/star`                | Star                                         |
| `POST`   | `/:id/unstar`              | Unstar                                       |
| `PATCH`  | `/:id/rename`              | Rename                                       |
| `PATCH`  | `/:id/move`                | Move to a different workspace folder         |
| `POST`   | `/:id/move-drive`          | Move file to another Drive (cross-account)   |
| `PATCH`  | `/:id/metadata`            | Update custom metadata key/value pairs       |
| `POST`   | `/upload/init`             | Initiate Google resumable upload             |
| `PUT`    | `/upload/proxy`            | Proxy streaming PUT to Google (CORS bypass)  |
| `POST`   | `/upload/finalize`         | Finalize upload (insert file row)            |

### `GET /api/files/recent` · `/starred` · `/trash`

Return file arrays. Access is granted via ownership **OR** workspace membership
(enforced in repository SQL via `EXISTS`).

**200:** `{ "files": [ /* FileEntry[] */ ] }` (shape may vary — see `FileService.listRecent`/`getStarred`/`getTrash`)

### `GET /api/files/search`

| Query param    | Type   | Description                                          |
|----------------|--------|------------------------------------------------------|
| `q`            | string | Filename substring                                   |
| `workspaceId`  | string | Restrict to a workspace                              |
| `metadata`     | string | Metadata filter (e.g. `key=value,key2=value2`)       |

**200:** `{ "files": [ /* FileEntry[] */ ] }`

### `GET /api/files/category-overview`

Aggregated counts/sizes per MIME category (image, video, document, …).

**200:** `{ /* category -> { count, size } */ }`

### `POST /api/files/upload/init`

Initiates a Google Drive resumable upload session. Verifies workspace RBAC (editor
required when `workspaceId` is supplied) and quota before initiating.

**Body** (`uploadInitSchema`):

```json
{
  "name": "report.pdf",
  "mimeType": "application/pdf",
  "size": 1048576,
  "parentFolderId": "0B-folder-id",
  "workspaceId": "uuid",
  "driveAccountId": "uuid"
}
```

`parentFolderId` is a **Google Drive folder ID** (or `"root"`), not a workspace
folder ID. Falls back to `targetDrive.rootFolderId` then `"root"`.

**200:**

```json
{
  "uploadUrl": "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=…",
  "driveAccountId": "uuid",
  "googleFolderId": "0B-folder-id"
}
```

**Errors:** `400` No connected drives · `400` Google Drive session expired. Disconnect and reconnect… ·
`401` (token/refresh failures) · `403` Forbidden (not workspace editor) ·
`403` `{"error":"Storage quota exceeded"}` · `502` (Google upstream)

### `PUT /api/files/upload/proxy`

Streams request body directly to Google's resumable upload URL (Google doesn't
set CORS on this endpoint, so the browser cannot PUT directly). Uses
`duplex: 'half'` to avoid buffering the whole file in memory.

**Required headers:**

| Header          | Required | Description                              |
|-----------------|----------|------------------------------------------|
| `X-Upload-Url`  | Yes      | The `uploadUrl` from `/upload/init`      |
| `Content-Type`  | No       | Defaults to `application/octet-stream`   |
| `Content-Length`| No       | Forwarded if present                     |
| `Content-Range` | No       | Forwarded if present (resumable chunks)  |

**Response:** Google's raw response (status, headers, body) with CORS headers
stripped. `200`/`308` (Partial Content) on success.

### `POST /api/files/upload/finalize`

Fetches the uploaded file's metadata from Google, inserts a `files` row, updates
workspace storage usage, and triggers automation event processing.

**Body** (`uploadFinalizeSchema`):

```json
{
  "googleFileId": "1a2b3c",
  "driveAccountId": "uuid",
  "parentFolderId": "0B-folder-id",
  "workspaceFolderId": "workspace-folder-uuid",
  "workspaceId": "workspace-uuid"
}
```

**201:**

```json
{ "file": { /* FileEntry */ }, "success": true }
```

**Errors:** `403` Forbidden · `404` Drive account not found or unauthorized ·
`400` Failed to fetch uploaded file from Google Drive

### `PATCH /api/files/:id/rename`

**Body** (`renameFileSchema`):

```json
{ "name": "new-name.pdf" }
```

`name` is required, 1–255 chars.

**200:** `{ "success": true }`

### `PATCH /api/files/:id/move`

Moves the file to a different **workspace** folder. (To move to another Google
Drive folder within the same drive, use `PATCH /api/drives/:driveId/move/:googleFileId`.)

**Body** (`moveFileSchema`):

```json
{ "workspaceFolderId": "uuid-or-null" }
```

**200:** `{ "success": true }`

### `POST /api/files/:id/move-drive`

Cross-drive move: shares the source file with the target Drive's email, copies
it to the target Drive, revokes the share, trashes the original, then updates
the DB row. On any failure after partial success, performs rollback (untrash,
delete copy, revoke share).

**Body** (`moveDriveFileSchema`):

```json
{ "targetDriveId": "uuid" }
```

**200:** `{ "file": { /* updated FileEntry */ }, "success": true }`

**Errors:** `400` File is already in the target drive · `404` Target drive not found or unauthorized ·
`500` Failed to move file to another drive

### `PATCH /api/files/:id/metadata`

Replace the file's custom metadata with a flat string-keyed map. Stored as JSON
in `files.metadata`.

**Body** (`fileMetadataSchema`):

```json
{ "metadata": { "project": "alpha", "status": "draft" } }
```

**200:** `{ "success": true }`

### `GET /api/files/:id/preview`

Streams an inline image (`Content-Disposition: inline`, `Cache-Control: private, max-age=300`).
Only `image/*` and `application/vnd.google-apps.photo` are supported (others
return `415`).

**Errors:** `415` Preview not available for this file type · `502` Failed to load preview

### `GET /api/files/:id/download`

Streams the file as an attachment (`Content-Disposition: attachment;
filename*=UTF-8''<encoded>`). Google Docs/Sheets/etc. are exported via Google's
export API (`exportedMimeType` and `exportedExtension` are appended to filename).

**Errors:** `502` Failed to download file

### Trash / Restore / Permanent delete / Star / Unstar

All return `{ "success": true }`. `DELETE /:id` trashes (recoverable);
`DELETE /:id/permanent` is irreversible.

---

## 4. Folders

**Base path:** `/api/folders` · **Router:** `routes/folders.ts` · **Auth:** cookie
session on **all** routes. "Folder" here is the **OmniDrive virtual folder /
workspace tree**, not Google Drive folders (those live under `/api/drives`).

| Method   | Path                       | Description                                  |
|----------|----------------------------|----------------------------------------------|
| `GET`    | `/tree`                    | Flat list of workspaces + folders for sidebar|
| `GET`    | `/:id?`                    | Folder/workspace contents (paginated)        |
| `POST`   | `/`                        | Create folder or workspace                   |
| `PUT`    | `/:id`                     | Update folder/workspace                      |
| `DELETE` | `/:id`                     | Delete folder or workspace                   |
| `POST`   | `/:id/files`               | Attach existing files to a folder/workspace  |
| `POST`   | `/:id/star`                | Star                                         |
| `POST`   | `/:id/unstar`              | Unstar                                       |
| `POST`   | `/:id/sync`                | Sync all drives referenced in this folder    |
| `POST`   | `/:id/force-sync`          | Force a specific drive sync for this folder  |

### `GET /api/folders/tree`

Returns a single flat array: workspaces as root nodes (parentId = null),
workspace_folders as children (parentId = workspaceId or parent folder).

**200:**

```json
{
  "folders": [
    { "id": "ws-uuid", "workspaceId": "ws-uuid", "name": "Marketing", "parentId": "ws-uuid", "icon": "📁", "color": "#4A90D9", "isStarred": false, "metadata": null, "createdAt": "…", "updatedAt": "…" },
    { "id": "folder-uuid", "workspaceId": "ws-uuid", "name": "Q1 Assets", "parentId": "ws-uuid", "icon": "📁", "color": "#4A90D9", "isStarred": false, "metadata": null, "createdAt": "…", "updatedAt": "…" }
  ]
}
```

### `GET /api/folders/:id?`

If `:id` is omitted, lists workspaces as root folders. If `:id` is a workspace,
returns its contents. If `:id` is a folder, returns its contents. Triggers a
background sync when the folder's `lastSyncedAt` exceeds the workspace's
`sync_ttl_minutes` (default 5).

| Query param | Type   | Default | Description                          |
|-------------|--------|---------|--------------------------------------|
| `cursor`    | string | —       | Pagination cursor (opaque)           |
| `limit`     | int    | 50      | 1–100                                |
| `driveId`   | string | —       | Hint for background sync             |

**200:**

```json
{
  "folder": { /* current folder or null at root */ },
  "subfolders": [ /* WorkspaceFolder[] */ ],
  "files": [ /* FileEntry[] */ ],
  "breadcrumb": [ { "id": "uuid-or-null", "name": "Marketing" } ],
  "pagination": { "nextCursor": "opaque-or-null", "hasMore": false }
}
```

### `POST /api/folders/`

**Body** (`createFolderSchema`):

```json
{ "name": "New Folder", "parentId": "parent-folder-or-workspace-uuid", "icon": "📁", "color": "#4A90D9" }
```

If `parentId` resolves to a workspace (or is omitted), creates a workspace folder
or a new workspace.

**200:** the created folder/workspace object (shape varies by service).

### `PUT /api/folders/:id`

**Body** (`updateFolderSchema`) — all fields optional:

```json
{ "name": "Renamed", "parentId": "new-parent-uuid", "icon": "📁", "color": "#FF0000" }
```

**200:** `{ "success": true }`

### `DELETE /api/folders/:id`

Tries workspace deletion first (requires owner); if not a workspace (or caller
isn't the owner), deletes a folder instead.

**200:** `{ "success": true }`

### `POST /api/folders/:id/files`

**Body** (`addFilesToFolderSchema`):

```json
{ "fileIds": ["uuid1", "uuid2"] }
```

`fileIds` must be a non-empty array of non-empty strings.

**200:** `{ "success": true }`

### `POST /api/folders/:id/sync`

Finds all Drive accounts whose folders appear under this folder/workspace and
runs `syncDriveAccount()` for each, in the background.

**200:** `{ "success": true }`

### `POST /api/folders/:id/force-sync`

Force a foreground background sync for a specific folder. `driveId` query param
overrides; otherwise inferred from the folder's drive, falling back to the
primary drive.

**200:** `{ "success": true }` · **400** `driveId is required or could not be determined`

---

## 5. Shared Links

**Base path:** `/api/shared` · **Router:** `routes/shared.ts` · **Auth:** mixed —
**management routes** (`POST /`, `GET /`, `PUT /:id`, `DELETE /:id`) require a
cookie session; **public routes** (`GET /:id/meta`, `POST /:id/verify`,
`POST /:id/email`, `GET /:id/download`) require neither session nor CSRF.

A `sharedServices` middleware (`middleware/shared-services.ts`) is applied to
`/api/shared/*` (`index.ts:95`) before the router.

| Method   | Path                | Auth        | Description                                |
|----------|---------------------|-------------|--------------------------------------------|
| `POST`   | `/`                 | Cookie      | Create a shared link                       |
| `GET`    | `/`                 | Cookie      | List current user's shared links           |
| `PUT`    | `/:id`              | Cookie      | Update a shared link                       |
| `DELETE` | `/:id`              | Cookie      | Delete a shared link                       |
| `GET`    | `/:id/meta`         | Public*     | Public metadata + access check             |
| `POST`   | `/:id/verify`       | Public      | Submit password for password-protected     |
| `POST`   | `/:id/email`        | Public      | Submit email for `requireEmail` gate       |
| `GET`    | `/:id/download`     | Public*     | Download file via shared link              |

*Public routes still require an unexpired link, plus either an email-JWT cookie
(when `requireEmail`) or a session-JWT cookie (when password-protected).

### `POST /api/shared`

**Body** (`createSharedLinkSchema`):

```json
{
  "targetType": "file",                      // "file" | "folder"
  "targetId": "uuid",
  "password": "optional-password",
  "expiresAt": "2026-12-31T23:59:59Z",       // ISO datetime, must be future; optional
  "allowDownloads": true,
  "allowUploads": false,                     // refused — uploads not yet implemented
  "maxDownloads": 100,                       // positive int or null; optional
  "requireEmail": false,
  "webhookUrl": "https://example.com/hook"   // HTTPS, must not be private/internal; nullable
}
```

`expiresAt` is validated as ISO datetime and must be in the future.
`webhookUrl` is validated by `validateWebhookUrl` (HTTPS only, blocks private
ranges and cloud-metadata IPs).

**200:**

```json
{ "id": "link-uuid", "url": "https://your-frontend-url/shared/link-uuid" }
```

**Errors:** `400` Uploads via shared links are not yet supported

### `GET /api/shared`

**200:** `{ "links": [ /* SharedLink[] */ ] }`

### `PUT /api/shared/:id`

**Body** (`updateSharedLinkSchema`) — all optional, `null` clears:

```json
{
  "password": "new-pass-or-null",
  "expiresAt": "2026-12-31T23:59:59Z",
  "allowDownloads": true,
  "allowUploads": false,
  "maxDownloads": 50,
  "requireEmail": false,
  "webhookUrl": "https://…/hook"
}
```

**200:** `{ "success": true }`

### `GET /api/shared/:id/meta`

Returns metadata about the target. If the link requires a password and no valid
session cookie is present, returns `401` with `requiresPassword: true`. If
`requireEmail` and no email cookie is present, returns `403` with
`requiresEmail: true`.

**200** (file target):

```json
{ "target": { /* FileEntry */ }, "type": "file" }
```

**200** (folder target):

```json
{ "targetId": "folder-uuid", "type": "folder" }
```

**Errors:** `401` `{"error":"Password required","requiresPassword":true}` ·
`403` `{"error":"Email required","requiresEmail":true}` ·
`410` `{"error":"Link expired"}`

### `POST /api/shared/:id/verify`

Submit a password for a password-protected link. On success, sets a 24h
`shared_session_<id>` JWT cookie (`HttpOnly; Secure; SameSite=None`).

Per-link brute-force lockout: 20 failed attempts in 15 minutes locks the link
for 15 minutes (KV-backed: `shared_verify_lock:<id>` / `shared_verify_fail:<id>`).

**Body** (`sharedLinkVerifySchema`):

```json
{ "password": "the-password" }
```

**200:** `{ "success": true }`

**Errors:** `400` Link does not require password · `401` Invalid password ·
`404` Link not found · `410` Link expired · `429` Too many failed attempts. Try again later.

### `POST /api/shared/:id/email`

Email gate for `requireEmail` links. Mints a 24h `shared_email_<id>` JWT cookie.

**Body** (`sharedLinkEmailSchema`):

```json
{ "email": "visitor@example.com" }
```

**200:** `{ "success": true }`

**Errors:** `400` This link does not require email · `404` Link not found · `410` Link expired

### `GET /api/shared/:id/download`

Downloads the file behind the link. Increments `download_count` atomically with
`RETURNING` when `maxDownloads` is set (refuses with `403` if limit reached).
Fires webhook (`{ action: "download", linkId }`) and logs `download` action in
the background.

**Headers:** `Content-Type`, `Content-Disposition: attachment; filename*=UTF-8''<encoded>`,
`Content-Length` (omitted for `.pdf`/`.xlsx` exports).

**Errors:** `400` Folder download not supported yet · `403` Downloads are disabled for this link ·
`403` Maximum download limit reached · `404` Link not found / File not found ·
`410` Link expired · `502` Failed to download file

---

## 6. Workspaces

**Base path:** `/api/workspaces` · **Router:** `routes/workspaces.ts` · **Auth:**
cookie session + per-route RBAC. Workspaces are team-scoped containers with
roles: `viewer`, `commenter`, `editor`, `manager`, `auditor`, `owner` (see
`WORKSPACE_ROLES` in `schemas.ts:191-193`). `owner` is assigned only at creation,
never via `POST /:id/members`.

| Method   | Path                                       | Min role    | Description                          |
|----------|--------------------------------------------|-------------|--------------------------------------|
| `GET`    | `/`                                        | member      | List workspaces                      |
| `POST`   | `/`                                        | (any user)  | Create a workspace (creator=owner)   |
| `POST`   | `/:id/members`                             | manager     | Add a member by email + role         |
| `DELETE` | `/:id/members/:targetUserId`               | manager¹    | Remove a member                      |
| `GET`    | `/:id/audit-logs`                          | auditor²    | Audit logs                           |
| `GET`    | `/:id/policies`                            | manager     | List policies                        |
| `POST`   | `/:id/policies`                            | manager     | Create a policy                      |
| `DELETE` | `/:id/policies/:policyId`                  | manager     | Delete a policy                      |
| `PATCH`  | `/:id/folders/:folderId/metadata`          | editor      | Update folder metadata               |

¹ Manager can remove others; users can self-remove; owner-removal + last-owner
checks enforced.
² `auditor` role is read-only-audit access.

### `POST /api/workspaces`

**Body** (`createWorkspaceSchema`):

```json
{ "name": "Marketing Team" }
```

`name` is required, 1–255 chars. Creator is added as `owner`.

**201:** `{ "workspace": { /* Workspace */ } }`

### `GET /api/workspaces`

**200:** `{ "workspaces": [ /* Workspace[] */ ] }`

### `POST /api/workspaces/:id/members`

**Body** (`addWorkspaceMemberSchema`):

```json
{ "email": "bob@example.com", "role": "viewer" }
```

`role` defaults to `viewer`; assignable roles are `viewer|commenter|editor|manager|auditor`
(`owner` is excluded by `ASSIGNABLE_WORKSPACE_ROLES`).

**201:** `{ "success": true }`

### `DELETE /api/workspaces/:id/members/:targetUserId`

**200:** `{ "success": true }`

### `GET /api/workspaces/:id/audit-logs`

**200:** `{ "logs": [ /* AuditLogRow[] */ ] }`

### `POST /api/workspaces/:id/policies`

**Body** (`workspacePolicySchema`):

```json
{
  "targetType": "workspace",                 // "workspace" | "folder"
  "targetId": "uuid-or-omitted",
  "policyType": "storage_quota",             // "storage_quota" | "data_retention"
  "config": { "max_bytes": 10737418240 }
}
```

Refinements: `storage_quota` must target a workspace and have a non-negative
numeric `config.max_bytes`.

**201:** `{ "policy": { /* WorkspacePolicyRow */ } }`

### `DELETE /api/workspaces/:id/policies/:policyId`

**200:** `{ "success": true }`

### `PATCH /api/workspaces/:id/folders/:folderId/metadata`

Replace the folder's metadata map (string→string JSON).

**Body** (`updateWorkspaceMetadataSchema`):

```json
{ "metadata": { "department": "eng", "confidential": "true" } }
```

**200:** `{ "success": true }`

---

## 7. Automations

**Base path:** `/api/automations` · **Router:** `routes/automations.ts` · **Auth:** cookie session

| Method  | Path            | Description                              |
|---------|-----------------|------------------------------------------|
| `GET`   | `/`             | List automation rules for current user   |
| `POST`  | `/`             | Create an automation rule                |
| `PATCH` | `/:id/toggle`   | Enable/disable a rule                    |

### `POST /api/automations`

**Body** (`createAutomationSchema`):

```json
{
  "name": "Auto-trash logs",
  "trigger_type": "event",                   // "event" | "cron"
  "trigger_config": { "event": "file.uploaded" },
  "conditions": [ { "field": "name", "op": "endsWith", "value": ".log" } ],
  "actions":   [ { "type": "trash" } ]
}
```

`trigger_config`, `conditions`, and `actions` are arbitrary JSON objects/arrays
(stored as text); they are interpreted by `AutomationEngine` in
`services/automation.service.ts`.

**201:** `{ "id": "uuid", "success": true }`

### `GET /api/automations`

**200:** `{ "rules": [ /* AutomationRule[] */ ] }`

### `PATCH /api/automations/:id/toggle`

**Body** (`toggleAutomationSchema`):

```json
{ "is_active": true }
```

**200:** `{ "success": true }` · **404** Automation rule not found

---

## 8. Admin

**Base path:** `/api/admin` · **Router:** `routes/admin.ts` · **Auth:** cookie
session **+ super admin** (`is_super_admin = 1`). The super-admin guard is
applied at the router level (`admin.ts:15-21`); members get `403 Forbidden:
Super Admin access required`.

| Method   | Path                | Description                              |
|----------|---------------------|------------------------------------------|
| `GET`    | `/invitations`      | List all invitation codes                |
| `POST`   | `/invitations`      | Create a new invitation code             |
| `DELETE` | `/invitations/:id`  | Delete an invitation code                |
| `GET`    | `/audit-logs`       | Recent audit logs (all workspaces)       |
| `GET`    | `/users`            | List all users                           |
| `POST`   | `/users`            | Create a user (member or super_admin)    |

### `POST /api/admin/invitations`

**Body** (`createInvitationSchema`):

```json
{ "code": "optional-custom-code", "max_uses": 1 }
```

If `code` is omitted, the server generates one (`generateId()` with dashes
stripped). User-supplied codes must be ≥12 chars. `max_uses` defaults to `1`,
must be ≥0.

**200:**

```json
{
  "success": true,
  "invitation": {
    "id": "uuid",
    "code": "generated-or-supplied",
    "created_by": "admin-uuid",
    "max_uses": 1,
    "used_count": 0
  }
}
```

### `GET /api/admin/invitations`

**200:** `{ "invitations": [ /* InvitationCodeRow[] */ ] }`

### `DELETE /api/admin/invitations/:id`

**200:** `{ "success": true }`

### `GET /api/admin/audit-logs`

**200:** `{ "logs": [ /* AuditLogRow[] */ ] }`

### `GET /api/admin/users`

**200:**

```json
{
  "users": [
    {
      "id": "uuid",
      "username": "alice",
      "email": "alice@example.com",
      "name": "Alice",
      "avatarUrl": null,
      "role": "super_admin",            // "super_admin" | "member"
      "status": "active"                // currently always "active"
    }
  ]
}
```

### `POST /api/admin/users`

**Body** (`adminCreateUserSchema`):

```json
{
  "username": "bob",
  "password": "BobPass1",
  "name": "Bob",
  "email": "bob@example.com",
  "role": "member"                     // "member" | "super_admin"; defaults to "member"
}
```

Password is validated by `passwordSchema` (same rules as register).

**200:**

```json
{
  "success": true,
  "user": { "id": "uuid", "username": "bob", "email": "…", "name": "Bob", "avatarUrl": null, "role": "member", "status": "active" }
}
```

**Errors:** `400` Username already exists · `400` Email already exists

---

## 9. S3 Credentials

**Base path:** `/api/s3-credentials` · **Router:** `routes/s3-credentials.ts` ·
**Auth:** cookie session. Workspace-scoped keys require `manager` role on the
target workspace (`getWorkspaceRole` + `hasPermission(role, 'manager')`).

| Method   | Path     | Description                                            |
|----------|----------|--------------------------------------------------------|
| `POST`   | `/`      | Generate a new access/secret key pair                  |
| `GET`    | `/`      | List current user's key pairs (without secrets)        |
| `DELETE` | `/:id`   | Revoke a key pair                                      |

### `POST /api/s3-credentials`

**Body** (`createS3CredentialsSchema`):

```json
{ "description": "rclone on NAS", "workspaceId": "workspace-uuid-or-omit" }
```

`description` is optional, ≤500 chars. `workspaceId` optional; if supplied the
caller must be a `manager` of that workspace (key is then scoped to only that
workspace's bucket in S3).

The secret key is shown **only once** in this response. The server stores it
AES-encrypted (`crypto.ts:encrypt`) in `s3_credentials.secret_key_enc`.

**201:**

```json
{
  "id": "uuid",
  "accessKeyId": "OMNI<16-hex-upper>",
  "secretAccessKey": "64-char-hex",
  "description": "rclone on NAS",
  "workspaceId": "workspace-uuid-or-null",
  "createdAt": "2026-06-25T12:00:00.000Z",
  "warning": "Store this secret now — it will not be shown again."
}
```

**Errors:** `403` `{"error":"Unauthorized to manage S3 keys for this workspace"}`

### `GET /api/s3-credentials`

Returns the metadata of all key pairs for the user (no secrets).

**200:** `[ { "id": "uuid", "accessKeyId": "OMNI…", "description": "…", "workspaceId": "…", "createdAt": "…" } ]`

### `DELETE /api/s3-credentials/:id`

**200:** `{ "success": true }`

---

## 10. S3 Object Storage API

**Base path:** `/s3` · **Router:** `routes/s3.ts` · **Auth:** AWS Signature
Version 4 (`s3AuthMiddleware`, `middleware/s3-auth.ts`). The middleware validates
the `Authorization: AWS4-HMAC-SHA256 …` header (or presigned-URL query params)
against the secret stored in `s3_credentials`. Credentials are looked up by
`access_key_id`; if the credential row has a `workspace_id`, the request is
scoped to that workspace only (`c.set('s3WorkspaceId', cred.workspace_id)`).

Each **Workspace** is exposed as a **Bucket**. Files in a workspace become
**Objects** with `folder1/folder2/file.txt` keys (folder paths assembled via a
recursive SQLite CTE).

Errors are XML, with these S3 codes: `AccessDenied`, `NoSuchBucket`,
`NoSuchKey`, `NoSuchUpload`, `NoSuchLifecycleConfiguration`, `InvalidRequest`,
`InvalidArgument`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`,
`RequestTimeTooSkewed`, `NotImplemented`, `InternalError`.

| Method            | Path                          | S3 operation                       | Min role |
|-------------------|-------------------------------|------------------------------------|----------|
| `GET`             | `/`                           | `ListBuckets`                      | member   |
| `GET`             | `/:bucket`                    | `ListObjectsV2` (or HeadBucket)    | viewer   |
| `HEAD`            | `/:bucket`                    | `HeadBucket`                       | viewer   |
| `GET`             | `/:bucket?lifecycle`          | `GetBucketLifecycleConfiguration`  | viewer   |
| `PUT`             | `/:bucket?lifecycle`          | `PutBucketLifecycleConfiguration`  | editor   |
| `DELETE`          | `/:bucket?lifecycle`          | `DeleteBucketLifecycleConfiguration`| editor  |
| `HEAD`            | `/:bucket/:key`               | `HeadObject`                       | viewer   |
| `GET`             | `/:bucket/:key`               | `GetObject`                        | viewer   |
| `PUT`             | `/:bucket/:key`               | `PutObject` (or `UploadPart`)      | editor   |
| `DELETE`          | `/:bucket/:key`               | `DeleteObject` (or `AbortMultipartUpload`) | editor |
| `POST`            | `/:bucket/:key?uploads`       | `InitiateMultipartUpload`          | editor   |
| `POST`            | `/:bucket/:key?uploadId=…`    | `CompleteMultipartUpload`          | editor   |

### `GET /s3/` — ListBuckets

Returns all workspaces the caller is a member of (or, when the credential is
workspace-scoped, only that workspace).

**200** (`application/xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Owner>
    <ID>user-uuid</ID>
    <DisplayName>user-uuid</DisplayName>
  </Owner>
  <Buckets>
    <Bucket>
      <Name>Marketing</Name>
      <CreationDate>2026-06-01T00:00:00.000Z</CreationDate>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>
```

### `GET /s3/:bucket` — ListObjectsV2

Lists objects under the bucket. Supports `prefix` and `delimiter=/` (groups
results into `CommonPrefixes`).

**200** (`application/xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>Marketing</Name>
  <Prefix>reports/</Prefix>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>reports/q1.pdf</Key>
    <LastModified>2026-03-31T23:59:59.000Z</LastModified>
    <ETag>"abc123…"</ETag>
    <Size>1048576</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <CommonPrefixes>
    <Prefix>reports/archive/</Prefix>
  </CommonPrefixes>
</ListBucketResult>
```

### `HEAD /s3/:bucket` — HeadBucket

Returns `200` with empty body if the bucket exists and the caller has read
access, otherwise `404` (no XML body for HEAD).

### `GET /s3/:bucket?lifecycle` — GetBucketLifecycleConfiguration

**200:** lifecycle XML. **404** `NoSuchLifecycleConfiguration` if no rules.

### `PUT /s3/:bucket?lifecycle` — PutBucketLifecycleConfiguration

Replaces all lifecycle rules. Body is an XML lifecycle configuration. Each rule
has `prefix`, `expiration_days`, `enabled`. Expired objects are moved to Google
Drive trash by `runLifecycleExpiration()` (cron-driven), making them recoverable
for ~30 days.

**200:** empty body.

### `DELETE /s3/:bucket?lifecycle` — DeleteBucketLifecycleConfiguration

**204:** empty body.

### `HEAD /s3/:bucket/:key` — HeadObject

**200:** Headers only — `Content-Type`, `Content-Length`, `ETag`. **404** if not found.

### `GET /s3/:bucket/:key` — GetObject

Streams the file from Google Drive (via `GoogleDriveService.downloadFile`).

**200:** File bytes with `Content-Type`, `Content-Length`, `ETag` headers.
**404** `NoSuchKey` if missing.

### `PUT /s3/:bucket/:key` — PutObject (or UploadPart)

Without `uploadId`/`partNumber`: single-part upload. The body is streamed
through an MD5 hashing transform, uploaded to Google Drive via a resumable
session, and a `files` row is inserted with `metadata: { md5 }`. If a file
already exists at the same key, the previous Google file is deleted.

With `?uploadId=…&partNumber=N`: uploads a single part into a temp Google Drive
folder under `.omnidrive_multipart_<uploadId>/`.

**200:** Empty body, `ETag` header (`"<md5hex>"` for single-part, or
`"<partMd5>"` for an UploadPart).

**Errors:** `400` No connected drives · `400` Empty request body ·
`400` Missing part body · `404` Invalid uploadId · `502` Upload to Google Drive failed ·
`502` Failed uploading part to Google Drive

### `DELETE /s3/:bucket/:key` — DeleteObject (or AbortMultipartUpload)

Without `uploadId`: trashes the file in Google Drive and sets `is_trashed=1`.

With `?uploadId=…`: deletes the temp Google Drive folder and the
`s3_multipart_uploads`/`s3_multipart_parts` rows.

**204:** empty body. **404** `NoSuchKey` / `NoSuchUpload`.

### `POST /s3/:bucket/:key?uploads` — InitiateMultipartUpload

Creates a temp folder `.omnidrive_multipart_<uploadId>` in the user's first
connected Drive, inserts a row in `s3_multipart_uploads`.

**200** (`application/xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult>
  <Bucket>Marketing</Bucket>
  <Key>reports/big.zip</Key>
  <UploadId>uuid</UploadId>
</InitiateMultipartUploadResult>
```

### `POST /s3/:bucket/:key?uploadId=…` — CompleteMultipartUpload

Streams all parts in order from Google Drive, concatenates them into a final
resumable upload, computes the S3 multipart ETag (`md5(concat(partMd5s))-<n>`),
inserts a `files` row, and deletes the temp folder.

**200** (`application/xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult>
  <Location>http://&lt;host&gt;/s3/Marketing/reports/big.zip</Location>
  <Bucket>Marketing</Bucket>
  <Key>reports/big.zip</Key>
  <ETag>"&lt;finalMd5&gt;-3"</ETag>
</CompleteMultipartUploadResult>
```

**Errors:** `400` No parts found to complete upload · `404` Upload session not found ·
`502` Final concatenation failed · `502` Upload to Google Drive failed

---

## 11. Health Check

**Path:** `/api/health` · **Auth:** none · Defined inline in `index.ts:104-106`.

**200:**

```json
{ "status": "ok", "timestamp": "2026-06-25T12:00:00.000Z" }
```

---

## Cross-Cutting Notes

### Scheduled jobs

The Worker's `scheduled` handler (`index.ts:116-137`) runs on the cron
`*/30 * * * *` (`wrangler.toml:9-10`). It triggers:

- `runScheduledSync(env)` — incremental Drive sync via the Google Drive Changes API
- `runLifecycleExpiration(env)` — moves expired S3 lifecycle objects to Google trash
- `cleanupOrphanMultipartUploads(env)` — removes abandoned multipart sessions
- `AutomationEngine.processCronTrigger(ctx)` — runs `cron`-trigger automations
- `AuditService.cleanupOldLogs(30)` — deletes audit logs older than 30 days
- `PolicyService.processAutoDeleteRetentionPolicies(...)` — runs data-retention policies
- D1 cleanup: expired `sessions`, `oauth_states` (>10 min), `quota_cache` (>1 h)

In the Docker (node-server) build, the same handler is invoked by `node-cron`
on the same schedule (`node-server.ts:84-90`).

### Per-request service injection

`auth-guard.ts:42-50` instantiates the following services per request (so routes
avoid `new`-ing them inline):

- `FileService`, `FolderService`, `DriveService`, `WorkspaceService`
- `AutomationRepository`, `S3CredentialsRepository`, `AdminRepository`, `AuthRepository`

Routes access them via `c.get('fileService')`, etc. The S3 router still
instantiates `GoogleDriveService` inline (see `routes/s3.ts` —
"migrate to S3Repository when extending S3 protocol support").
