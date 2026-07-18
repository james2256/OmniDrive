-- Add is_starred flag to drive_folders (mirrors files.is_starred).
ALTER TABLE drive_folders ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;
