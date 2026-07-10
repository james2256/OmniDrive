# ADR 0001: Use Hono on Cloudflare Workers

## Status

Accepted

## Context

OmniDrive needs a backend framework that:
- Runs on Cloudflare Workers (edge runtime, $0/month possible on free tier)
- Supports TypeScript natively
- Has a lightweight footprint (Workers have 128MB memory limit)
- Supports middleware (auth, CORS, CSRF, rate limiting)
- Can run on both Cloudflare Workers AND Node.js (for Docker self-hosting)

## Decision

Use [Hono](https://hono.dev/) as the web framework.

## Rationale

- **Edge-first**: Hono is designed for Cloudflare Workers, Deno, and Bun — not a Node.js framework ported to Workers
- **Lightweight**: ~14KB bundled, no dependencies on Node.js built-ins
- **TypeScript-native**: first-class type inference for routes and context
- **Middleware system**: built-in support for CORS, JWT, logger, etc.
- **Dual-runtime**: the same code runs on Workers (via `app.fetch`) and Node.js (via `@hono/node-server`) with polyfills for D1/KV
- **Community**: active development, growing ecosystem, good documentation

## Alternatives considered

- **Express**: Too Node.js-centric, doesn't run on Workers without heavy adapters
- **itty-router**: Even lighter, but less middleware ecosystem
- **Elysia**: Bun-only, doesn't work on Workers

## Consequences

- Routes use `Hono<AppContext>` with typed bindings (D1, KV, env vars)
- Middleware follows Hono's `app.use('*', middleware)` pattern
- Error handling via `app.onError()` with `AppError` class
- Context variables (`c.set('userId')`, `c.get('requestId')`) for request-scoped state
