# ADR-0004: TanStack Query with Pessimistic Updates

Date: 2026-07-19

## Status
Accepted

## Context
The frontend used Zustand for server state (drives, shared links). This caused 67 manual `isLoading` instances, 24 duplicate `fetchDrives` calls, and silent error swallowing.

## Decision
Migrate server state to TanStack Query v5 with pessimistic mutations (wait for server confirmation before updating UI). Keep Zustand only for client UI state.

## Consequences
- Positive: Automatic request deduplication and stale-while-revalidate
- Positive: Centralized cache invalidation via `invalidateAfterFileMutation`
- Positive: Error visibility (useQuery returns `error` state)
- Negative: Slightly more refetches (negligible for personal storage app)
- Neutral: `staleTime: 30s` balances freshness with performance
