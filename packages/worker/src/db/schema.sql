-- Timestamp convention:
--   TEXT columns (DEFAULT datetime('now')) → "YYYY-MM-DD HH:MM:SS" (UTC, space separator)
--     Used for: created_at, updated_at, synced_at, last_synced_at, etc.
--     Bind Date values via toSQLiteDatetime() (lib/datetime.ts).
--     Compare lexicographically (same format → correct ordering).
--   INTEGER columns → epoch milliseconds (Date.now())
--     Used for: sessions.expires_at, oauth_states.created_at, drive_tokens.updated_at,
--     quota_cache.updated_at (machine-only, never displayed,
--     compared via arithmetic).
--   NEVER mix formats within a column — lexicographic comparison of ISO vs SQLite
--   format breaks because space (0x20) < T (0x54). See policy.service.ts (C3 fix).

-- Users (from local auth and Google OAuth)
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    google_id       TEXT UNIQUE,
    email           TEXT UNIQUE,
    name            TEXT,
    avatar_url      TEXT,
    is_super_admin  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    is_blocked      INTEGER NOT NULL DEFAULT 0
);

-- Move session storage from KV to D1.
-- KV free tier = 1k writes/day; D1 free tier = 100k row writes/day.
-- Sessions were previously stored as KV keys `session:<id>` with 7-day TTL.
-- D1 has no auto-expiry: a scheduled cron (*/30) cleans expired rows.
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data        TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    touched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

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
    quota_override  INTEGER,
    quota_updated_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, google_account_id)
);

-- Google Drive folder structure (mirrored, read-only)
CREATE TABLE IF NOT EXISTS drive_folders (
    id                TEXT PRIMARY KEY,
    drive_account_id  TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    google_folder_id  TEXT NOT NULL,
    google_parent_id  TEXT,
    name              TEXT NOT NULL,
    is_synced         INTEGER NOT NULL DEFAULT 0,
    synced_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    owned_by_me       INTEGER NOT NULL DEFAULT 1,
    is_trashed        INTEGER NOT NULL DEFAULT 0,
    is_starred        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(drive_account_id, google_folder_id)
);

-- Workspaces (Collaborative spaces)
CREATE TABLE IF NOT EXISTS workspaces (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_bytes      INTEGER DEFAULT 0,
    sync_ttl_minutes INTEGER NOT NULL DEFAULT 5,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Workspace members
CREATE TABLE IF NOT EXISTS workspace_members (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'manager', 'auditor', 'owner')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, user_id)
);

-- Workspace folders (Omnidrive-only folder structure)
CREATE TABLE IF NOT EXISTS workspace_folders (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    parent_id       TEXT REFERENCES workspace_folders(id) ON DELETE CASCADE,
    icon            TEXT,
    color           TEXT,
    is_starred      INTEGER NOT NULL DEFAULT 0,
    metadata        TEXT DEFAULT '{}',
    last_synced_at  TEXT,
    sync_status     TEXT NOT NULL DEFAULT 'idle',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, parent_id, name)
);

-- File metadata synced from Google Drive
CREATE TABLE IF NOT EXISTS files (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    google_file_id  TEXT NOT NULL,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
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
    last_synced_at  TEXT,
    sync_status     TEXT NOT NULL DEFAULT 'idle',
    synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    owned_by_me     INTEGER NOT NULL DEFAULT 1,
    UNIQUE(drive_account_id, google_file_id)
);

-- Sync state tracking per drive account
CREATE TABLE IF NOT EXISTS sync_state (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    change_token     TEXT,
    next_page_token  TEXT,
    last_synced_at   TEXT,
    status           TEXT DEFAULT 'idle',
    error_message    TEXT,
    locked_at        TEXT
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_files_user_workspace ON files(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_workspace_folder ON files(workspace_folder_id);
CREATE INDEX IF NOT EXISTS idx_files_drive ON files(drive_account_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(user_id, name);
CREATE INDEX IF NOT EXISTS idx_files_user_trashed_name_id ON files(user_id, is_trashed, name, id);
CREATE INDEX IF NOT EXISTS idx_files_google_parent ON files(drive_account_id, google_parent_id);
-- D1 rows-read hot-path indexes (see migrations 0007). Each targets a verified
-- full/index-range scan in EXPLAIN QUERY PLAN:
--   idx_files_workspace_trashed          → findRecent UNION branch 2 + retention/lifecycle cron
--   idx_files_user_parent_trashed_owned  → findExternalFiles (External page top-level)
--   idx_files_user_starred_trashed       → findStarred page
--   idx_files_ws_wsfol_trash_name_id     → findFilesInWorkspaceRoot (covering: sort eliminated)
CREATE INDEX IF NOT EXISTS idx_files_workspace_trashed ON files(workspace_id, is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_user_parent_trashed_owned ON files(user_id, google_parent_id, is_trashed, owned_by_me);
CREATE INDEX IF NOT EXISTS idx_files_external_cursor ON files(user_id, google_parent_id, is_trashed, owned_by_me, name, id);
CREATE INDEX IF NOT EXISTS idx_files_user_starred_trashed ON files(user_id, is_starred, is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_ws_wsfol_trash_name_id ON files(workspace_id, workspace_folder_id, is_trashed, name, id);
-- drive_folders LEFT JOIN by google_folder_id in shared-links listing. The
-- UNIQUE(drive_account_id, google_folder_id) cannot serve this — leftmost prefix
-- is drive_account_id, so SQLite full-scans drive_folders per shared link row.
CREATE INDEX IF NOT EXISTS idx_drive_folders_google_id ON drive_folders(google_folder_id);
-- Expression index for findRecent ORDER BY (migration 0008). Combined with
-- per-branch LIMIT, branch 1 (user_id filter) reads 20 rows via index seek
-- with no temp B-tree sort. Branch 2 filters on workspace_id and still sorts
-- ~20 rows (acceptable). idx_drive_folders_starred_trashed covers the
-- drive_folders starred query (was skipped in 0007).
CREATE INDEX IF NOT EXISTS idx_files_user_trashed_sort
  ON files(user_id, is_trashed, COALESCE(google_modified_at, synced_at, updated_at) DESC);
CREATE INDEX IF NOT EXISTS idx_drive_folders_starred_trashed ON drive_folders(is_starred, is_trashed);
CREATE INDEX IF NOT EXISTS idx_workspace_folders_parent ON workspace_folders(workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_drives_user ON drive_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_drive_folders_parent ON drive_folders(drive_account_id, google_parent_id);

CREATE TABLE IF NOT EXISTS shared_links (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL CHECK (target_type IN ('file', 'folder')),
    target_id       TEXT NOT NULL,
    password_hash   TEXT,
    expires_at      TEXT,
    allow_downloads INTEGER NOT NULL DEFAULT 1,
    allow_uploads   INTEGER NOT NULL DEFAULT 0,
    max_downloads   INTEGER,
    require_email   INTEGER NOT NULL DEFAULT 0,
    webhook_url     TEXT,
    view_count      INTEGER NOT NULL DEFAULT 0,
    download_count  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_link_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shared_link_id  TEXT NOT NULL REFERENCES shared_links(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    visitor_email   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- S3 bucket lifecycle rules. "expire" = move object to Google Drive trash
-- (recoverable ~30 days), NOT a permanent delete (see s3-lifecycle service).
CREATE TABLE IF NOT EXISTS s3_lifecycle_rules (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    prefix          TEXT NOT NULL DEFAULT '',
    expiration_days INTEGER NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, prefix)
);
CREATE INDEX IF NOT EXISTS idx_s3_lifecycle_workspace ON s3_lifecycle_rules(workspace_id);

CREATE INDEX IF NOT EXISTS idx_shared_links_user ON shared_links(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_target ON shared_links(target_type, target_id);

-- Automation Rules
CREATE TABLE IF NOT EXISTS automation_rules (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    trigger_type    TEXT NOT NULL,
    trigger_config  TEXT,
    conditions      TEXT,
    actions         TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_user ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger_type, is_active);

-- Automation Logs
CREATE TABLE IF NOT EXISTS automation_logs (
    id              TEXT PRIMARY KEY,
    rule_id         TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    details         TEXT,
    executed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_rule ON automation_logs(rule_id);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    actor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,
    resource_id     TEXT,
    resource_name   TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Workspace Policies
CREATE TABLE IF NOT EXISTS workspace_policies (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL CHECK (target_type IN ('workspace', 'folder')),
    target_id       TEXT REFERENCES workspace_folders(id) ON DELETE CASCADE,
    policy_type     TEXT NOT NULL CHECK (policy_type IN ('storage_quota', 'data_retention')),
    config          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_policies_workspace ON workspace_policies(workspace_id);

-- Invitation Codes
CREATE TABLE IF NOT EXISTS invitation_codes (
    id              TEXT PRIMARY KEY,
    code            TEXT UNIQUE NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_uses        INTEGER NOT NULL DEFAULT 1,
    used_count      INTEGER NOT NULL DEFAULT 0,
    expires_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invitation_codes ON invitation_codes(code);

-- Track user generated S3 Credentials
CREATE TABLE IF NOT EXISTS s3_credentials (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_key_id     TEXT UNIQUE NOT NULL,
    secret_key_enc    TEXT NOT NULL,
    description       TEXT,
    workspace_id      TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_s3_credentials_access_key ON s3_credentials(access_key_id);

-- Track active S3 multipart uploads
CREATE TABLE IF NOT EXISTS s3_multipart_uploads (
    upload_id          TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key                TEXT NOT NULL,
    drive_account_id   TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE,
    temp_folder_id     TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Track uploaded parts for active multipart uploads
CREATE TABLE IF NOT EXISTS s3_multipart_parts (
    upload_id          TEXT NOT NULL REFERENCES s3_multipart_uploads(upload_id) ON DELETE CASCADE,
    part_number        INTEGER NOT NULL,
    google_file_id     TEXT NOT NULL,
    etag               TEXT NOT NULL,
    size               INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (upload_id, part_number)
);

-- OAuth state (short-lived, 10-min TTL via cron cleanup). Migrated from KV.
CREATE TABLE IF NOT EXISTS oauth_states (
    state           TEXT PRIMARY KEY,
    code_verifier   TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states(created_at);

-- Encrypted OAuth tokens per drive account. Migrated from KV.
CREATE TABLE IF NOT EXISTS drive_tokens (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    encrypted_tokens TEXT NOT NULL,
    updated_at       INTEGER NOT NULL
);

-- Quota cache (5-min TTL via updated_at). Migrated from KV.
CREATE TABLE IF NOT EXISTS quota_cache (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    payload          TEXT NOT NULL,
    updated_at       INTEGER NOT NULL
);

-- Storage stats delta table. Per-(user_id, mime_type) running sum maintained
-- by app-level deltas (upload/trash/restore/delete/sync). Replaces the old
-- category_cache (which invalidated on every mutation, forcing a 100K-row
-- GROUP BY rescan on the next dashboard visit). Now the dashboard reads ~20
-- rows (one per mime type) — always instant, always current.
CREATE TABLE IF NOT EXISTS file_storage_stats (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type  TEXT NOT NULL,
    total_size INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, mime_type)
);
CREATE INDEX IF NOT EXISTS idx_file_storage_stats_user ON file_storage_stats(user_id);

-- Missing FK indexes — used in deleteUser cascade (admin.repository.ts) and
-- multipart cleanup cron (s3-lifecycle.ts). Without these, cascade deletes
-- do full table scans.
CREATE INDEX IF NOT EXISTS idx_s3_credentials_user ON s3_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_created_by ON invitation_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_s3_multipart_uploads_created ON s3_multipart_uploads(created_at);
