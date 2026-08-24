-- Add password_version column to shared_links for JWT revocation on password
-- change. Existing links get version 0; first password change bumps to 1,
-- invalidating all JWTs signed with version 0.
ALTER TABLE shared_links ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
