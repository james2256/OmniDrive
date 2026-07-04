-- Add is_super_admin column missing from incremental migrations (was only in schema.sql).
-- Promotes the earliest-created user to super admin (matches first-registration logic in /register).
ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

UPDATE users SET is_super_admin = 1 WHERE id = (
  SELECT id FROM users ORDER BY created_at ASC LIMIT 1
);
