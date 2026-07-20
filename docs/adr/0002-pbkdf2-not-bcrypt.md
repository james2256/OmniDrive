# ADR-0002: PBKDF2 instead of bcrypt

Date: 2025-01-20

## Status
Accepted

## Context
Cloudflare Workers doesn't support Node.js `crypto` module natively. bcrypt requires native bindings. The Web Crypto API is available but doesn't include bcrypt.

## Decision
Use PBKDF2 (via Web Crypto API `SubtleCrypto.deriveBits`) for password hashing with 100,000 iterations and SHA-256.

## Consequences
- Positive: No native dependencies, works in Workers runtime
- Positive: PBKDF2 is NIST-approved and FIPS-compliant
- Negative: Slower than bcrypt (mitigated by 100k iterations being sufficient)
- Neutral: Password verification uses constant-time comparison
