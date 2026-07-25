-- D1 rows-read optimization: expression index for findRecent ORDER BY +
-- missing index for the drive_folders starred query.
--
-- idx_files_user_trashed_sort: expression index covering the COALESCE(...)
--   sort key used by findRecent branch 1 (user_id filter). Combined with
--   per-branch LIMIT, this converts "read all user files + sort in temp
--   B-tree" into "read 20 rows via index seek" (branch 1 only — branch 2
--   filters on workspace_id and still sorts ~20 rows, acceptable).
-- idx_drive_folders_starred_trashed: was skipped in migration 0007. The
--   drive_folders starred query (file.service.ts getStarred) scanned 14K
--   rows per Starred page load without this index.

CREATE INDEX IF NOT EXISTS idx_files_user_trashed_sort
  ON files(user_id, is_trashed, COALESCE(google_modified_at, synced_at, updated_at) DESC);

CREATE INDEX IF NOT EXISTS idx_drive_folders_starred_trashed
  ON drive_folders(is_starred, is_trashed);
