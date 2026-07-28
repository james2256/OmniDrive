# ADR-0002: PBKDF2 instead of bcrypt

Date: 2025-01-20

## Status
Accepted

> **Update (2026-07):** Iteration count was lowered from **100,000 → 10,000** for both user auth (`hashPassword`/`verifyPassword`) and shared-link passwords (`hashSharedPassword`/`verifySharedPassword`, new format `shared:10000:salt:hash`). 100k iterations exceeded the Cloudflare Workers Free-tier CPU budget (~10 ms/invocation) and triggered Error 1102. The brute-force defense is now the sliding-window rate limiter + per-link KV lockout (`shared_verify_lock`), not iteration count. See `packages/worker/src/lib/password.ts` and `docs/AGENTS.md` §"Cost Principle". Legacy 100k shared-link hashes (`salt:hash` format) still verify via `verifySharedPassword` for backward compatibility. The core decision (PBKDF2 via Web Crypto, not bcrypt) is unchanged.

## Context
Cloudflare Workers doesn't support Node.js `crypto` module natively. bcrypt requires native bindings. The Web Crypto API is available but doesn't include bcrypt.

## Decision
Use PBKDF2 (via Web Crypto API `SubtleCrypto.deriveBits`) for password hashing with SHA-256. Iteration count is tuned for the Workers Free CPU budget — see the **Update** note above for the current value.

## Consequences
- Positive: No native dependencies, works in Workers runtime
- Positive: PBKDF2 is NIST-approved and FIPS-compliant
- Negative: Slower than bcrypt (mitigated by tuning iterations to the Workers CPU ceiling)
- Neutral: Password verification uses constant-time comparison
