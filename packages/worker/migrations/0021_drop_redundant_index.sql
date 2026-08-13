-- Drop idx_files_user_parent_trashed_owned — it's a strict prefix of
-- idx_files_external_cursor (4-col vs 6-col). SQLite uses the 6-col index
-- for any query that would use the 4-col index. The redundant index wastes
-- storage and adds write overhead on every INSERT/UPDATE/DELETE.
DROP INDEX IF EXISTS idx_files_user_parent_trashed_owned;
