# ADR 0002: Migrate Sessions from KV to D1

## Status

Accepted

## Context

OmniDrive originally stored user sessions in Cloudflare KV with a 7-day TTL. This worked initially but hit two problems:

1. **KV free tier limit**: 1,000 writes/day. Every login creates a session, every request extends the TTL. An active user with 100 requests/day burns 100 writes — 10 users = 1,000 writes = limit hit.
2. **No query capability**: Can't list all sessions for a user (needed for "revoke all sessions" feature). KV is a key-value store, not a database.

## Decision

Migrate session storage from KV to D1 (Cloudflare's SQLite-at-edge).

## Rationale

- **D1 free tier**: 100,000 row writes/day — 100x more headroom than KV
- **Queryable**: `SELECT * FROM sessions WHERE user_id = ?` enables session revocation
- **TTL via cron**: D1 has no auto-expiry, but a 30-min cron deletes `WHERE expires_at < now`
- **Throttled sliding window**: Only extend session TTL once per hour (not every request), reducing writes ~90%

## Alternatives considered

- **Keep KV, pay for paid tier**: $5/month for 1M writes/day — works but adds cost
- **Use Durable Objects**: Per-user session objects — overkill, complex, costly
- **Use JWT only (no server sessions)**: Can't revoke sessions, security risk

## Consequences

- New `sessions` table in D1: `id, user_id, data (JSON), expires_at, touched_at`
- `auth-guard.ts` middleware queries D1 instead of KV
- Cron job (`*/30 * * * *`) cleans expired sessions
- KV still used for shared-link password lockout (where native TTL is the right primitive)
- `touched_at` column enables throttled session extension (only extend if >1h since last touch)
