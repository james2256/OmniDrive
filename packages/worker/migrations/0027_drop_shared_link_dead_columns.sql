-- Drop dead columns from shared_links: allowUploads and requireEmail were
-- non-functional features (allowUploads was refused by the backend;
-- requireEmail's /email endpoint signed JWTs from any string with no
-- verification email). All code references have been removed.
ALTER TABLE shared_links DROP COLUMN allow_uploads;
ALTER TABLE shared_links DROP COLUMN require_email;
