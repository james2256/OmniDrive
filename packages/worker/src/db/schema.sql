-- Users (from Google OAuth login)
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    google_id       TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    avatar_url      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Connected Google Drive accounts
CREATE TABLE IF NOT EXISTS drive_accounts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_account_id TEXT NOT NULL,
    email           TEXT NOT NULL,
    name            TEXT,
    type            TEXT NOT NULL DEFAULT 'oauth',
    is_primary      INTEGER NOT NULL DEFAULT 0,
    root_folder_id  TEXT,
    total_quota     INTEGER DEFAULT 0,
    used_quota      INTEGER DEFAULT 0,
    quota_updated_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, google_account_id)
);

-- Virtual folder structure (Omnidrive-only, not in Google Drive)
CREATE TABLE IF NOT EXISTS virtual_folders (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    parent_id       TEXT REFERENCES virtual_folders(id) ON DELETE CASCADE,
    icon            TEXT DEFAULT '📁',
    color           TEXT DEFAULT '#4A90D9',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, parent_id, name)
);

-- File metadata synced from Google Drive
CREATE TABLE IF NOT EXISTS files (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    google_file_id  TEXT NOT NULL,
    virtual_folder_id TEXT REFERENCES virtual_folders(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    mime_type       TEXT,
    size            INTEGER DEFAULT 0,
    thumbnail_url   TEXT,
    web_view_link   TEXT,
    web_content_link TEXT,
    is_trashed      INTEGER NOT NULL DEFAULT 0,
    google_created_at  TEXT,
    google_modified_at TEXT,
    synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(drive_account_id, google_file_id)
);

-- Sync state tracking per drive account
CREATE TABLE IF NOT EXISTS sync_state (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    change_token     TEXT,
    last_synced_at   TEXT,
    status           TEXT DEFAULT 'idle',
    error_message    TEXT
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_files_user_folder ON files(user_id, virtual_folder_id);
CREATE INDEX IF NOT EXISTS idx_files_drive ON files(drive_account_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(user_id, name);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON virtual_folders(user_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_drives_user ON drive_accounts(user_id);
