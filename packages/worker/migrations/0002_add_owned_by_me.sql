-- Add owned_by_me flag to files and drive_folders.
-- DEFAULT 1 assumes existing rows are owned (correct for most users).
-- The next sync will correct any shared files to owned_by_me = 0.
ALTER TABLE files ADD COLUMN owned_by_me INTEGER NOT NULL DEFAULT 1;
ALTER TABLE drive_folders ADD COLUMN owned_by_me INTEGER NOT NULL DEFAULT 1;
