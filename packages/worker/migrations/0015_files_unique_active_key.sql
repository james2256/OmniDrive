-- Prevent concurrent S3 PUTs from creating duplicate active file rows.
-- Partial index: only applies to non-trashed files. COALESCE handles
-- NULL workspace_folder_id (root-level files) — SQLite treats NULLs as
-- distinct in unique indexes, so COALESCE(NULL, '') normalizes them.
-- Dedup existing data first (keep oldest by id) to avoid CREATE INDEX failure.
DELETE FROM files WHERE is_trashed = 0 AND id NOT IN (
  SELECT MIN(id) FROM files WHERE is_trashed = 0
  GROUP BY workspace_id, COALESCE(workspace_folder_id, ''), name
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_workspace_folder_name_active
  ON files(workspace_id, COALESCE(workspace_folder_id, ''), name)
  WHERE is_trashed = 0;
