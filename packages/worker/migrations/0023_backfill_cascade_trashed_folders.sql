-- Backfill: cascade is_trashed=1 to child files of already-trashed folders.
-- Pre-A-06, trashing a folder only set drive_folders.is_trashed=1 — child
-- files stayed is_trashed=0, causing quota drift + stale visibility in
-- listings. This one-time migration marks all descendant files of trashed
-- folders as is_trashed=1, matching the post-A-06 cascade behavior.
--
-- Order matters:
-- 1. Mark children trashed (UPDATE files) — so both recomputes see the
--    corrected is_trashed state.
-- 2. Recompute file_storage_stats (per-user-per-mime, with LEFT JOIN to
--    exclude files under trashed folders — matches recomputeStorageStats code).
-- 3. Recompute workspaces.used_bytes (per-workspace, with LEFT JOIN — the
--    live cascade releases workspace quota per-child via deltas; this full
--    recompute is the migration equivalent for backfilled children).
--
-- Parameterless (migrations use d1.exec, no bind params). The recursive CTE
-- self-scopes by drive_account_id via the anchor column.

-- 1. Mark all descendant files of trashed folders as is_trashed=1.
UPDATE files SET is_trashed = 1, updated_at = CURRENT_TIMESTAMP
WHERE is_trashed = 0
  AND google_parent_id IN (
    WITH RECURSIVE trashed_descendants(google_folder_id, drive_account_id) AS (
      SELECT google_folder_id, drive_account_id FROM drive_folders
        WHERE is_trashed = 1
      UNION ALL
      SELECT df.google_folder_id, df.drive_account_id FROM drive_folders df
        JOIN trashed_descendants d ON df.drive_account_id = d.drive_account_id
          AND df.google_parent_id = d.google_folder_id
      LIMIT 1000
    )
    SELECT google_folder_id FROM trashed_descendants
  );

-- 2. Recompute file_storage_stats with LEFT JOIN (matches recomputeStorageStats
--    at file.repository.ts). Excludes files under trashed folders (direct parent
--    check); df.is_trashed IS NULL handles root-level files (no parent row).
DELETE FROM file_storage_stats;
INSERT INTO file_storage_stats (user_id, mime_type, total_size)
SELECT f.user_id, COALESCE(f.mime_type, ''), SUM(f.size)
FROM files f
LEFT JOIN drive_folders df
  ON df.drive_account_id = f.drive_account_id
  AND df.google_folder_id = f.google_parent_id
WHERE f.is_trashed = 0
  AND f.owned_by_me = 1
  AND (df.is_trashed = 0 OR df.is_trashed IS NULL)
GROUP BY f.user_id, COALESCE(f.mime_type, '');

-- 3. Recompute workspaces.used_bytes with LEFT JOIN (same exclusion logic).
--    The live cascade (cascadeFolderTrashUnits) releases workspace quota
--    per-child via updateUsedBytesStmt deltas; this full recompute is the
--    migration equivalent for backfilled children. Mirrors the pattern at
--    admin.repository.ts:196 (correlated subquery on workspaces).
UPDATE workspaces SET used_bytes = COALESCE((
  SELECT SUM(f.size) FROM files f
  LEFT JOIN drive_folders df
    ON df.drive_account_id = f.drive_account_id
    AND df.google_folder_id = f.google_parent_id
  WHERE f.workspace_id = workspaces.id
    AND f.is_trashed = 0
    AND f.owned_by_me = 1
    AND (df.is_trashed = 0 OR df.is_trashed IS NULL)
), 0);
