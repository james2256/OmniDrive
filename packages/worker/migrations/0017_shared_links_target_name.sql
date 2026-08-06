-- Denormalize targetName + targetMimeType onto shared_links to eliminate the
-- 3-table JOIN (files + workspace_folders + drive_folders) in
-- findAllByUserWithTargetName. Set at link creation time; not updated on rename
-- (the owner's SharedLinksPage shows the creation-time name; the public meta
-- endpoint does a live findFolderName lookup for visitor freshness).

ALTER TABLE shared_links ADD COLUMN target_name TEXT;
ALTER TABLE shared_links ADD COLUMN target_mime_type TEXT;

-- Backfill existing links from the current file/folder names.
-- Files: deterministic (files.id is PK → at most 1 row).
UPDATE shared_links
SET target_name = (
  SELECT name FROM files WHERE id = shared_links.target_id
),
target_mime_type = (
  SELECT mime_type FROM files WHERE id = shared_links.target_id
)
WHERE target_type = 'file';

-- Workspace folders: deterministic (workspace_folders.id is PK → at most 1 row).
UPDATE shared_links
SET target_name = (
  SELECT name FROM workspace_folders WHERE id = shared_links.target_id
)
WHERE target_type = 'folder'
  AND target_name IS NULL
  AND EXISTS (SELECT 1 FROM workspace_folders WHERE id = shared_links.target_id);

-- Drive folders: google_folder_id is NOT unique (same folder synced to multiple
-- drives) — use MIN(name) for determinism, matching the original query's
-- MIN(df.name) behavior.
UPDATE shared_links
SET target_name = (
  SELECT MIN(name) FROM drive_folders WHERE google_folder_id = shared_links.target_id
)
WHERE target_type = 'folder'
  AND target_name IS NULL;
