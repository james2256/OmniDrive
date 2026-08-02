-- Add locked_at timestamp to sync_state for stale-lock detection.
-- Cloudflare Workers can be killed mid-sync (CPU limit, deploy, crash),
-- leaving status='syncing' forever. The locked_at column lets acquireLock
-- re-acquire stale locks after a TTL (30 minutes).
ALTER TABLE sync_state ADD COLUMN locked_at TEXT;
