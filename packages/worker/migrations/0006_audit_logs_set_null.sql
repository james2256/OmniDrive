-- Audit logs should outlive workspaces (compliance). SQLite can't ALTER COLUMN,
-- so recreate the table preserving data.
CREATE TABLE audit_logs_new (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    actor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,
    resource_id     TEXT,
    resource_name   TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO audit_logs_new (id, workspace_id, actor_id, action_type, resource_id, resource_name, metadata, created_at)
SELECT id, workspace_id, actor_id, action_type, resource_id, resource_name, metadata, created_at FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
