-- Cursor pagination index for automation cron (R4).
-- Supports WHERE user_id = ? AND is_trashed = ? AND (name, id) > (?, ?) ORDER BY name, id
CREATE INDEX IF NOT EXISTS idx_files_user_trashed_name_id ON files(user_id, is_trashed, name, id);
