-- Add is_trashed flag to drive_folders so trashed folders appear in OmniDrive Trash
-- (mirrors files.is_trashed behavior). Soft-delete instead of hard-delete.
ALTER TABLE drive_folders ADD COLUMN is_trashed INTEGER NOT NULL DEFAULT 0;
