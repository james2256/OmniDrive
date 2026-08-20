-- F-02 + F-03: Recreate files table with:
--   1. workspace_id ON DELETE SET NULL (was CASCADE — the service layer
--      pre-detaches files before deleting workspaces, so CASCADE is dead code.
--      SET NULL makes the schema match the intent and prevents accidental
--      file deletion if someone bypasses the repository.)
--   2. Drop dead columns: last_synced_at, sync_status (never read/written
--      on the files table — they only exist on workspace_folders.)
--
-- SQLite doesn't support ALTER TABLE ... ALTER CONSTRAINT or DROP COLUMN
-- (before 3.35), so we recreate: backup → drop → create → restore → indexes.

BEGIN TRANSACTION;

-- 1. Save existing data
CREATE TABLE _files_backup AS SELECT * FROM files;

-- 2. Drop and recreate with new FK action + without dead columns
DROP TABLE files;

CREATE TABLE files (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    google_file_id  TEXT NOT NULL,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    workspace_folder_id TEXT REFERENCES workspace_folders(id) ON DELETE SET NULL,
    google_parent_id TEXT,
    name            TEXT NOT NULL,
    mime_type       TEXT,
    size            INTEGER DEFAULT 0,
    thumbnail_url   TEXT,
    web_view_link   TEXT,
    web_content_link TEXT,
    is_trashed      INTEGER NOT NULL DEFAULT 0,
    is_starred      INTEGER NOT NULL DEFAULT 0,
    metadata        TEXT DEFAULT '{}',
    google_created_at  TEXT,
    google_modified_at TEXT,
    synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    owned_by_me     INTEGER NOT NULL DEFAULT 1,
    owner_email     TEXT,
    UNIQUE(drive_account_id, google_file_id)
);

-- 3. Restore data (excluding the dropped columns)
INSERT INTO files (
    id, user_id, drive_account_id, google_file_id, workspace_id, workspace_folder_id,
    google_parent_id, name, mime_type, size, thumbnail_url, web_view_link,
    web_content_link, is_trashed, is_starred, metadata, google_created_at,
    google_modified_at, synced_at, created_at, updated_at, owned_by_me, owner_email
)
SELECT
    id, user_id, drive_account_id, google_file_id, workspace_id, workspace_folder_id,
    google_parent_id, name, mime_type, size, thumbnail_url, web_view_link,
    web_content_link, is_trashed, is_starred, metadata, google_created_at,
    google_modified_at, synced_at, created_at, updated_at, owned_by_me, owner_email
FROM _files_backup;

-- 4. Recreate indexes (from schema.sql + migrations 0007-0010)
CREATE INDEX IF NOT EXISTS idx_files_user_workspace ON files(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_workspace_folder ON files(workspace_folder_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(user_id, name);
CREATE INDEX IF NOT EXISTS idx_files_user_trashed_name_id ON files(user_id, is_trashed, name, id);
CREATE INDEX IF NOT EXISTS idx_files_google_parent ON files(drive_account_id, google_parent_id);
CREATE INDEX IF NOT EXISTS idx_files_workspace_trashed ON files(workspace_id, is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_external_cursor ON files(user_id, google_parent_id, is_trashed, owned_by_me, name, id);
CREATE INDEX IF NOT EXISTS idx_files_user_starred_trashed ON files(user_id, is_starred, is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_ws_wsfol_trash_name_id ON files(workspace_id, workspace_folder_id, is_trashed, name, id);
CREATE INDEX IF NOT EXISTS idx_files_user_trashed_sort ON files(user_id, is_trashed, COALESCE(google_modified_at, synced_at, updated_at) DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_workspace_folder_name_active ON files(workspace_id, COALESCE(workspace_folder_id, ''), name) WHERE is_trashed = 0;

-- 5. Clean up backup
DROP TABLE _files_backup;

COMMIT;
