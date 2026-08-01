-- Replace category_cache (delete-on-mutate) with file_storage_stats
-- (delta-on-mutate). Eliminates the full-table scan on every cache miss.
-- Per-(user_id, mime_type) running sum, maintained by app-level deltas in
-- FileService mutations + the sync loop. The mime→bucket classification
-- stays in FileService.getCategoryOverview (single source).

CREATE TABLE IF NOT EXISTS file_storage_stats (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type  TEXT NOT NULL,
    total_size INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, mime_type)
);
CREATE INDEX IF NOT EXISTS idx_file_storage_stats_user ON file_storage_stats(user_id);

-- One-time backfill from the current files table. COALESCE(NULL,'') so the
-- PK dedupes NULL mime types the same way the app-layer deltas will.
INSERT INTO file_storage_stats (user_id, mime_type, total_size)
SELECT user_id, COALESCE(mime_type, ''), SUM(size)
FROM files
WHERE is_trashed = 0
GROUP BY user_id, COALESCE(mime_type, '');

-- Drop the old cache. No backward-compat shim: the repo methods that read
-- it are removed in the same change.
DROP TABLE IF EXISTS category_cache;
