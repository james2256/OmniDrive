PRAGMA foreign_keys=off;
ALTER TABLE workspace_members RENAME TO workspace_members_old;
CREATE TABLE IF NOT EXISTS workspace_members (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'manager', 'auditor', 'owner')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, user_id)
);
INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
SELECT id, workspace_id, user_id, role, joined_at FROM workspace_members_old;
DROP TABLE workspace_members_old;

CREATE TABLE IF NOT EXISTS audit_logs (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,
    resource_id     TEXT,
    resource_name   TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
PRAGMA foreign_keys=on;
