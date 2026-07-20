# ADR-0006: Cloudflare Pages Functions Same-Origin Proxy

Date: 2025-06-01

## Status
Accepted

## Context
The frontend (Pages) and backend (Workers) run on different domains. Cross-origin requests require CORS configuration and expose the Worker URL to the client.

## Decision
Use Cloudflare Pages Functions (`functions/api/[[path]].ts`) as a same-origin proxy. The Pages Function forwards requests to the Worker, so the frontend makes same-origin requests to `/api/*`.

## Consequences
- Positive: No CORS issues for API requests
- Positive: Worker URL not exposed to client
- Positive: CSRF guard uses same-origin check
- Negative: Extra hop (Pages Function → Worker) adds ~5ms latency
- Neutral: WebSocket/SSE not supported through the proxy
