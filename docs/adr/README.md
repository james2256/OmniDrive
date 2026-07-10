# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for OmniDrive.

## What is an ADR?

An ADR is a short document that captures **why** a technical decision was made — not just **what** was decided, but the context, alternatives, and consequences.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-why-hono.md) | Use Hono on Cloudflare Workers | Accepted |
| [0002](0002-why-d1-over-kv-for-sessions.md) | Migrate Sessions from KV to D1 | Accepted |
| [0003](0003-why-pbkdf2-over-bcrypt.md) | Use PBKDF2 over bcrypt for Password Hashing | Accepted |
| [0004](0004-why-pages-functions-proxy.md) | Use Pages Functions Proxy for Same-Origin API | Accepted |

## When to write an ADR

Write an ADR when you make a decision that:
- Is hard to reverse (e.g., choosing a database, framework, or auth strategy)
- Affects multiple parts of the codebase
- Has meaningful trade-offs (not an obvious best choice)
- A new contributor would ask "why did you do it this way?"

## Format

Each ADR follows the [Nygard template](https://github.com/joelparkerhenderson/architecture-decision-record):

1. **Title**: `ADR NNNN: Short description`
2. **Status**: Proposed / Accepted / Superseded / Deprecated
3. **Context**: What problem are we solving?
4. **Decision**: What did we decide?
5. **Rationale**: Why this option?
6. **Alternatives considered**: What else did we look at?
7. **Consequences**: What are the implications?
