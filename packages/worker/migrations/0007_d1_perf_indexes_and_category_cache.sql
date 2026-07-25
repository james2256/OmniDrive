-- D1 rows-read optimization: 5 targeted indexes + category_cache table.
-- Each index targets a verified full / index-range scan in EXPLAIN QUERY PLAN:
--   idx_files_workspace_trashed          → findRecent UNION branch 2 (JOIN workspace_members)
--                                          + policy.service retention cron (workspace_id, is_trashed)
--                                          + s3-lifecycle cron (workspace_id, is_trashed)
--   idx_files_user_parent_trashed_owned  → findExternalFiles: 4-column seek
--                                          (user_id, google_parent_id, is_trashed, owned_by_me)
--   idx_files_user_starred_trashed       → findStarred: 3-column seek
--   idx_files_ws_wsfol_trash_name_id     → findFilesInWorkspaceRoot covering index (sort eliminated)
--   idx_drive_folders_google_id          → shared-links LEFT JOIN on google_folder_id
--                                          (existing UNIQUE has leftmost prefix drive_account_id)
-- category_cache mirrors quota_cache: PK + payload TEXT + updated_at INTEGER,
-- 5-min TTL via updated_at, upserted on cache miss, invalidated on
-- trash/restore/delete/upload. Sync upserts bypass the service layer; the
-- TTL covers that path (acceptable 5-min dashboard staleness).

CREATE INDEX IF NOT EXISTS idx_files_workspace_trashed ON files(workspace_id, is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_user_parent_trashed_owned ON files(user_id, google_parent_id, is_trashed, owned_by_me);
CREATE INDEX IF NOT EXISTS idx_files_user_starred_trashed ON files(user_id, is_starred, is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_ws_wsfol_trash_name_id ON files(workspace_id, workspace_folder_id, is_trashed, name, id);
CREATE INDEX IF NOT EXISTS idx_drive_folders_google_id ON drive_folders(google_folder_id);

CREATE TABLE IF NOT EXISTS category_cache (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload    TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
