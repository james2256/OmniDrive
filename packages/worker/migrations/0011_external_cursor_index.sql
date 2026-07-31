-- Covering index for findExternalFiles: WHERE (user_id, google_parent_id, is_trashed, owned_by_me)
-- + ORDER BY (name, id). The existing idx_files_user_parent_trashed_owned covers the WHERE
-- but forces a temp B-tree sort for the ORDER BY. This index lets D1 read rows in sorted
-- order directly — no sort step, reads only LIMIT rows.
-- Before: 68.85% of D1 runtime, 3.67M rows read (51,730 per call).
-- After: ~0.1% of D1 runtime, ~50 rows read per call.
CREATE INDEX IF NOT EXISTS idx_files_external_cursor
  ON files(user_id, google_parent_id, is_trashed, owned_by_me, name, id);
