-- Add missing indexes on FK columns used in cascade deletes and cleanup queries.
-- These columns have FK constraints but no index, causing full table scans
-- in deleteUser (24-statement cascade) and multipart cleanup cron.

CREATE INDEX IF NOT EXISTS idx_s3_credentials_user ON s3_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_created_by ON invitation_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_s3_multipart_uploads_created ON s3_multipart_uploads(created_at);
