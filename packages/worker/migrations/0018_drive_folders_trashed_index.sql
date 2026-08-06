-- Covering index for findTrashedDriveFolders (drive.repository.ts:702).
-- Without this, the query scans ALL drive_folders for the user's drives,
-- then filters is_trashed in memory — 14.41k rows read to return ~1 row.
--
-- Parity with files' idx_files_user_trashed_sort: (scope, is_trashed, sort).
-- drive_folders doesn't have user_id, so drive_account_id is the scope.
-- created_at DESC in the index eliminates the in-memory sort.
CREATE INDEX IF NOT EXISTS idx_drive_folders_drive_trashed_created
  ON drive_folders(drive_account_id, is_trashed, created_at DESC);
