-- F-06: Drop redundant idx_files_drive index.
-- idx_files_drive (files(drive_account_id)) is subsumed by
-- idx_files_google_parent (files(drive_account_id, google_parent_id))
-- via the leftmost-prefix rule. Any query filtering drive_account_id
-- can use idx_files_google_parent.

DROP INDEX IF EXISTS idx_files_drive;
