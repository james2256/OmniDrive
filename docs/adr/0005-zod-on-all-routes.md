# ADR-0005: Zod Validation on All Routes

Date: 2026-07-19

## Status
Accepted

## Context
Route handlers used hand-rolled validation (`if (!name) throw...`). Only 5 of 29 JSON-reading routes had manual `typeof` checks. 3 security gaps existed: `expiresAt` past-date, `isFolder` unvalidated, `role` enum unvalidated.

## Decision
Install `zod` + `@hono/zod-validator`. Create 26 schemas in `lib/schemas.ts`. Apply `zValidator('json', schema, zodErrorHook)` to all 29 JSON-reading routes.

## Consequences
- Positive: 100% type-safe request body validation
- Positive: Consistent error format (`{error: string}` via `zodErrorHook`)
- Positive: All 3 security gaps closed
- Negative: +50KB bundle size (zod library)
- Neutral: Schemas are the single source of truth for API contracts
