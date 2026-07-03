-- Migration 0008: S3 bucket lifecycle rules
-- Option A semantics: "expire" moves the object to Google Drive trash
-- (recoverable ~30 days), it is NOT a permanent delete.

CREATE TABLE IF NOT EXISTS s3_lifecycle_rules (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    prefix          TEXT NOT NULL DEFAULT '',
    expiration_days INTEGER NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, prefix)
);

CREATE INDEX IF NOT EXISTS idx_s3_lifecycle_workspace ON s3_lifecycle_rules(workspace_id);
