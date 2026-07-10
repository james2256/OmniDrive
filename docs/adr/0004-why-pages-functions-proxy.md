# ADR 0004: Use Pages Functions Proxy for Same-Origin API Calls

## Status

Accepted

## Context

OmniDrive deploys as two separate Cloudflare services:
- **Worker**: API at `https://your-worker.workers.dev`
- **Pages**: Frontend at `https://your-app.pages.dev`

Originally, the frontend called the Worker directly (cross-origin). This caused:

1. **Session cookie dropped after tab close**: The `omnidrive_sid` cookie is set by the Worker on `*.workers.dev`. When the frontend (on `*.pages.dev`) makes cross-origin requests, the cookie is third-party. Safari drops it after 7 days; Chrome is phasing out third-party cookies entirely.
2. **CORS complexity**: Every API response needs proper CORS headers. Any misconfiguration breaks the app silently.
3. **Cookie SameSite issues**: `SameSite=Lax` (secure default) doesn't work cross-site; must use `SameSite=None` (insecure).

## Decision

Use Cloudflare Pages Functions to proxy `/api/*` and `/s3/*` requests from the Pages origin to the Worker origin.

## Rationale

- **Same-origin cookies**: API calls become `pages.dev → pages.dev/api/*` (first-party). Cookie persists after tab close.
- **No CORS issues**: Same-origin requests don't need CORS headers
- **`SameSite=Lax` works**: Secure default, no `SameSite=None` needed
- **Pages Functions are free**: No additional cost on Cloudflare free tier

## Implementation

- `packages/web/functions/api/[[path]].ts` — proxies `/api/*` to `env.WORKER_URL`
- `packages/web/functions/s3/[[path]].ts` — proxies `/s3/*` to `env.WORKER_URL`
- `packages/web/public/_routes.json` — limits Functions to `/api/*` and `/s3/*` only
- `VITE_API_URL` is empty — frontend uses relative URLs (`/api/...`)

## Alternatives considered

- **`_redirects` file**: Can't proxy to external domains (Cloudflare Pages limitation)
- **Custom domain with routes**: Works but requires owning a domain
- **Same Worker serves both API and static files**: Possible with Workers Static Assets, but requires code changes

## Consequences

- `WORKER_URL` must be set as a Pages environment variable (fail-loud if missing)
- Every API request goes through Pages Functions (adds ~5ms latency)
- `_routes.json` ensures only `/api/*` and `/s3/*` invoke Functions (other paths serve static files)
- `VITE_API_URL` must be empty in production (relative URLs)
