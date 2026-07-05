-- Migrate remaining KV usage to D1 (KV free-tier 1k writes/day exhaustion).
-- Replaces: oauth_state:, tokens:, oauth:, quota: KV keys.
-- shared_verify_fail/lock stays in KV (low volume, TTL semantics convenient).

-- OAuth state (short-lived, 10-min TTL enforced by cron cleanup).
-- Replaces KV key oauth_state:${state}.
CREATE TABLE IF NOT EXISTS oauth_states (
    state           TEXT PRIMARY KEY,
    code_verifier   TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states(created_at);

-- Encrypted OAuth tokens per drive account.
-- Replaces KV keys tokens:${driveId} and legacy oauth:${driveId}.
CREATE TABLE IF NOT EXISTS drive_tokens (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    encrypted_tokens TEXT NOT NULL,
    updated_at       INTEGER NOT NULL
);

-- Quota cache (5-min TTL enforced by updated_at check in code + cron cleanup).
-- Replaces KV key quota:${driveId}.
CREATE TABLE IF NOT EXISTS quota_cache (
    drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE,
    payload          TEXT NOT NULL,
    updated_at       INTEGER NOT NULL
);
