-- Add index on shared_link_id for cascade delete performance.
-- Without this, deleting a shared_link full-scans shared_link_logs.
CREATE INDEX IF NOT EXISTS idx_shared_link_logs_link ON shared_link_logs(shared_link_id);
