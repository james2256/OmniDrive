-- F-05: Add created_at indexes for log retention cron (90-day DELETE).
-- Without these, the DELETE FROM ... WHERE created_at < ? would full-scan.

CREATE INDEX IF NOT EXISTS idx_shared_link_logs_created_at ON shared_link_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_automation_logs_executed_at ON automation_logs(executed_at);
