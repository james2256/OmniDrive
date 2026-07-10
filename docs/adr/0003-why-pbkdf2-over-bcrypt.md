# ADR 0003: Use PBKDF2 over bcrypt for Password Hashing

## Status

Accepted

## Context

OmniDrive originally used bcrypt (cost factor 10) for password hashing. This caused a critical bug on Cloudflare Workers:

- bcrypt cost ≥ 10 takes >50ms to compute
- Cloudflare Workers CPU limit: 10ms (free tier), 30s (paid tier, default 30ms)
- **Login requests timed out** with `bcrypt hash computation exceeded CPU limit`

## Decision

Use PBKDF2-SHA256 at 10,000 iterations via Web Crypto API.

## Rationale

- **Workers CPU-safe**: PBKDF2 at 10k iterations takes ~5ms — well within Workers limits
- **Web Crypto native**: No external dependency, uses `crypto.subtle.deriveBits()`
- **OWASP guidance**: PBKDF2-SHA256 is an approved algorithm (though OWASP 2023 recommends 600k iterations for non-Workers environments)
- **Threat model**: OmniDrive relies on rate limiting (10 login attempts/min) + per-link password lockout (20 attempts/15min) as primary brute-force defense, not raw hashing speed

## Alternatives considered

- **Argon2id**: Gold standard but no Workers-compatible implementation
- **scrypt**: Better than PBKDF2 but also CPU-heavy on Workers
- **bcrypt at cost 4**: Fits in CPU limit but too weak for security

## Consequences

- `lib/password.ts` uses `crypto.subtle.deriveBits()` with PBKDF2-SHA256
- 10,000 iterations (not 600k — Workers CPU constraint)
- Shared-link passwords use the same PBKDF2 implementation (was previously PBKDF2 at 100k for shared links, now unified at 10k)
- Legacy bcrypt hashes would need migration (not currently implemented — fresh installs only)
- `// ponytail: PBKDF2 via Web Crypto — bcrypt (cost ≥ 10) times out on Workers CPU limit`
