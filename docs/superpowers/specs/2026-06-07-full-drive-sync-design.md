# Full Google Drive Sync — Design Spec

**Date:** 2026-06-07  
**Status:** Approved  

## Overview

Update the sync process to mirror the entire Google Drive for each connected Gmail account — all files and all folders — without limiting to a specific root folder. The UI will display the Google Drive folder hierarchy 1:1, with lazy loading for subfolders and a background cron for incremental updates.

---

## Goals

- Sync all files and folders from every connected Google Drive account (not just a designated Omnidrive folder)
- Mirror Google Drive folder hierarchy in the Omnidrive UI (folder navigation like Google Drive)
- Support lazy/progressive loading: root level is synced first, subfolders are loaded on demand when the user opens them
- Background incremental sync via the Google Drive Changes API (cron, every 15 minutes)
- Display Google native files (Docs, Sheets, Slides) with a visual badge; they open via webViewLink

## Out of Scope

- Shared Drives / Team Drives (only "My Drive")
- Google Drive Shortcuts (skipped)
- Real-time sync (max ~15 min delay from Changes API)
- Bidirectional sync / editing files from Omnidrive UI

---

## Architecture

### Flow Overview

```
Trigger                  Action
─────────────────────────────────────────────────────────────────
New drive connected    → Initial sync: crawl root level (files + folders)
                         All subfolders saved as is_synced = 0
User opens subfolder   → Frontend: POST /api/drives/:id/folders/:folderId/sync
                         Lazily crawl that folder, save contents, set is_synced = 1
Cron (every 15 min)    → Incremental sync via Changes API for ALL changes (no folder filter)
```

---

## Database Schema Changes

### New Table: drive_folders

Mirrors Google Drive folder hierarchy. Read-only from Google Drive's perspective.

```sql
CREATE TABLE IF NOT EXISTS drive_folders (
    id                TEXT PRIMARY KEY,
    drive_account_id  TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    google_folder_id  TEXT NOT NULL,
    google_parent_id  TEXT,
    name              TEXT NOT NULL,
    is_synced         INTEGER NOT NULL DEFAULT 0,
    synced_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(drive_account_id, google_folder_id)
);

CREATE INDEX IF NOT EXISTS idx_drive_folders_parent
    ON drive_folders(drive_account_id, google_parent_id);
```

### Modified Table: files

Add google_parent_id to track which Google Drive folder each file belongs to.

```sql
ALTER TABLE files ADD COLUMN google_parent_id TEXT;
-- 'root' means the file is directly under My Drive root
-- otherwise: Google folder ID
```

### Modified Table: drive_accounts

root_folder_id is no longer required. The sync root is always the Drive root ('root').

---

## Backend Changes

### google-drive.ts — New Method: listFolderContents

Replaces listFilesInFolder. Lists both files and subfolders inside a given folder.

Signature:
```typescript
async listFolderContents(
  driveAccountId: string,
  folderId: string | 'root'
): Promise<{
  files: DriveFile[];
  folders: DriveFolder[];
}>
```

Google API query:
```
q = '{folderId}' in parents and trashed = false
fields = nextPageToken, files(id,name,mimeType,size,parents,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime)
```

Files where mimeType === 'application/vnd.google-apps.folder' are returned as folders; all others as files. Pagination: loop on nextPageToken until exhausted.

---

### sync.ts — Updated Sync Logic

#### Initial Sync (performInitialSync)

Called when change_token is null (first sync for this drive account).

1. Call listFolderContents(driveId, 'root')
2. For each folder → upsert into drive_folders with google_parent_id = null, is_synced = 0
3. For each file → upsert into files with google_parent_id = 'root'
4. Fetch startPageToken from Changes API for future incremental syncs

Does NOT recurse into subfolders. Subfolders are populated lazily when the user opens them.

#### Incremental Sync (performIncrementalSync)

Called on every cron run when change_token exists. Processes ALL changes — no folder filter.

For each change from the Changes API:

| Condition | Action |
|---|---|
| change.removed = true and folder | DELETE FROM drive_folders WHERE google_folder_id = ? |
| change.removed = true and file | DELETE FROM files WHERE google_file_id = ? |
| file.trashed = true | Delete from DB |
| file.mimeType = folder | Upsert into drive_folders, update name and google_parent_id |
| File moved (parent changed) | Update google_parent_id in files |
| File created or modified | Upsert into files with google_parent_id = file.parents[0] |

Remove the old filter: file.parents?.includes(drive.rootFolderId!) — no longer applies.

#### syncDriveAccount Entry Point

Remove the early-exit check if (!drive.rootFolderId) return. All drives are synced regardless of root_folder_id.

---

### New API Endpoints

#### POST /api/drives/:driveId/folders/:googleFolderId/sync

Lazy sync: crawl a specific subfolder on demand.

Auth: authGuard (protected)

Steps:
1. Verify the drive account belongs to the authenticated user
2. Look up the folder in drive_folders — if is_synced = 1, return existing contents immediately (idempotent)
3. Call listFolderContents(driveId, googleFolderId)
4. Upsert subfolders into drive_folders (is_synced = 0)
5. Upsert files into files with google_parent_id = googleFolderId
6. Set is_synced = 1, synced_at = now for this folder
7. Return { folders, files }

Error handling: If token expired → auto-refresh via getValidToken. If refresh fails → 401.

#### GET /api/drives/:driveId/folders/:googleFolderId

Read folder contents from the database (no Google API call).

Auth: authGuard

Returns:
```json
{
  "folder": { "id": "...", "name": "...", "is_synced": 1 },
  "subfolders": [...],
  "files": [...]
}
```

Frontend uses is_synced to decide whether to trigger lazy sync first.

---

## Frontend Changes

### Navigation State

```typescript
currentDriveId: string | null
currentGoogleFolderId: string  // default: 'root'
folderHistory: Array<{ googleFolderId: string; name: string }>
```

### Breadcrumb

My Drive > Photos > 2024 > January

Each segment is clickable to navigate back up.

### Folder Open Flow

```
User clicks folder
    ↓
Check is_synced
    ↓ is_synced = 0                      ↓ is_synced = 1
POST /api/drives/:id/folders/:fid/sync   GET /api/drives/:id/folders/:fid
Show loading spinner on folder           Render immediately
    ↓
GET /api/drives/:id/folders/:fid (render)
```

### File Type Badges

| MIME Type | Badge |
|---|---|
| application/vnd.google-apps.document | G Doc |
| application/vnd.google-apps.spreadsheet | G Sheet |
| application/vnd.google-apps.presentation | G Slides |
| application/vnd.google-apps.form | G Form |
| Other | No badge (icon by mime-type) |

Google native files open via webViewLink (new tab). Download button is hidden for these files.

### Error States

- Lazy sync fails → toast: "Gagal memuat folder, coba lagi" + folder marked with warning icon
- Folder re-clickable to retry

---

## Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| File moved between folders | Incremental sync updates google_parent_id |
| Folder deleted in Google Drive | Changes API removed:true → DELETE from drive_folders, DB cascade deletes files |
| File trashed | file.trashed = true → remove from DB |
| Lazy sync called twice (race condition) | Check is_synced = 1 before syncing; if already synced, return immediately |
| Token expired during lazy sync | getValidToken auto-refreshes; if refresh fails → 401 returned |
| Folder with > 1000 items | listFolderContents paginates until nextPageToken exhausted |
| Google native files | size = 0, webContentLink = null, identified by mimeType prefix application/vnd.google-apps.* |
| Drive with no root_folder_id | No longer an early exit — all drives are synced from Drive root |

---

## Migration Notes

- Run ALTER TABLE files ADD COLUMN google_parent_id TEXT on existing D1 database
- Run CREATE TABLE drive_folders migration
- Existing sync_state rows: set change_token = NULL to force fresh initial sync for all drive accounts
- Existing files in DB: google_parent_id will be NULL until incremental sync updates them (acceptable)
