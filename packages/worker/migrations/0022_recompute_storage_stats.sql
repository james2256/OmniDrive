-- Recompute file_storage_stats for all users, fixing:
-- (1) Migration 0012 backfill bug (missing owned_by_me = 1 filter)
-- (2) Accumulated drift from non-atomic sync writes + deleteDrive bypass
--
-- NOTE: This migration ran with the original SQL (no LEFT JOIN to
-- drive_folders). Migration 0023 re-runs the recompute with the corrected
-- LEFT JOIN that excludes files under trashed folders. Do not modify this
-- file — migrations are immutable once applied (tracked in d1_migrations).

DELETE FROM file_storage_stats;
INSERT INTO file_storage_stats (user_id, mime_type, total_size)
SELECT user_id, COALESCE(mime_type, ''), SUM(size)
FROM files
WHERE is_trashed = 0 AND owned_by_me = 1
GROUP BY user_id, COALESCE(mime_type, '');
