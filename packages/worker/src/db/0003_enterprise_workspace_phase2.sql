ALTER TABLE workspaces ADD COLUMN used_bytes INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS workspace_policies (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL CHECK (target_type IN ('workspace', 'folder')),
    target_id       TEXT REFERENCES workspace_folders(id) ON DELETE CASCADE,
    policy_type     TEXT NOT NULL CHECK (policy_type IN ('storage_quota', 'data_retention')),
    config          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_policies_workspace ON workspace_policies(workspace_id);
