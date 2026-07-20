# ADR-0007: Subrequest Budget of 45

Date: 2026-01-10

## Status
Accepted

## Context
Cloudflare Workers free plan allows 50 external subrequests per invocation. Google Drive sync makes 1 external call per page (Google API fetch). Token refresh and one-time calls (getRootFolderId, getStartPageToken, getQuota) consume additional budget.

## Decision
Set `EXTERNAL_SUBREQUEST_BUDGET = 45`, leaving 5 for token refresh and one-time calls. Save checkpoint every page. Capacity: (45 - 1) / 1 = 44 pages = 4,400 items per sync cycle.

## Consequences
- Positive: Never hits the 50 subrequest wall
- Positive: Crash-resilient (checkpoint saved every page)
- Negative: Large drives (>4,400 items) require multiple sync cycles
- Neutral: D1 calls have separate 1,000 limit — not the bottleneck
