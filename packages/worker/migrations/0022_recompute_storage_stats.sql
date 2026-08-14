-- Recompute file_storage_stats for all users, fixing:
-- (1) Migration 0012 backfill bug (missing owned_by_me = 1 filter)
-- (2) Accumulated drift from non-atomic sync writes + deleteDrive bypass

DELETE FROM file_storage_stats;
INSERT INTO file_storage_stats (user_id, mime_type, total_size)
SELECT user_id, COALESCE(mime_type, ''), SUM(size)
FROM files
WHERE is_trashed = 0 AND owned_by_me = 1
GROUP BY user_id, COALESCE(mime_type, '');
