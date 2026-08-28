-- D1-backed rate limiter table.
-- Replaces the KV-based limiter (KV's 1,000 writes/day hard cap turned budget
-- exhaustion into an auth-surface outage — every allowed login/register/
-- change-password/shared-download wrote KV, and hitting the daily cap made
-- every subsequent request 500 until 00:00 UTC reset).
--
-- D1's 100K rows-written/day tier gives 86.4× headroom, and the hybrid UPSERT
-- in rate-limiter.ts costs ZERO writes on blocked (abusive) requests — only
-- allowed traffic writes. (name, key) is the conflict key, so each unique
-- IP/limiter pair reuses one row across windows.
CREATE TABLE IF NOT EXISTS rate_limits (
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, key)
);
