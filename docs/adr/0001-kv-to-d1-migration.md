# ADR-0001: KV to D1 Migration

Date: 2025-01-15

## Status
Accepted

## Context
The original OmniDrive used Cloudflare KV for session storage and token caching. KV is eventually consistent, has limited query capabilities, and doesn't support relational queries.

## Decision
Migrate to Cloudflare D1 (SQLite) for all persistent data. KV is retained only for rate-limiter counters.

## Consequences
- Positive: ACID transactions, relational queries, simpler data model
- Positive: Single database for all state (sessions, files, drives, shared links)
- Negative: D1 has 1,000 writes/day limit on free plan (managed via sync batching)
- Neutral: KV still used for ephemeral rate-limit counters (TTL-based)
