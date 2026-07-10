# Contributing to OmniDrive

Thanks for your interest in contributing! This guide will get you set up in ~15 minutes and explain how to make changes safely.

## Quick start (first-time setup)

```bash
# 1. Fork & clone the repo
git clone https://github.com/YOUR_USERNAME/OmniDrive.git
cd OmniDrive

# 2. Run the setup script (installs deps, copies config templates, applies DB schema)
npm run setup

# 3. Edit .env — fill in:
#    - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (from Google Cloud Console)
#    - JWT_SECRET (run: openssl rand -hex 16)
#    - TOKEN_ENCRYPTION_KEY (run: openssl rand -hex 16)

# 4. Edit packages/worker/wrangler.toml — fill in:
#    - database_id (run: npx wrangler d1 create omnidrive)
#    - KV id       (run: npx wrangler kv namespace create KV)

# 5. Start the dev servers
npm run dev
# → Worker: http://localhost:8888
# → Web:    http://localhost:8999

# 6. Visit http://localhost:8999 → register the first admin account
```

## Prerequisites

- **Node.js 22+** (required by Wrangler v4) — check with `node -v`
- **Google Cloud Console project** with Drive API enabled and OAuth 2.0 credentials
- **Cloudflare account** (free tier works) for D1 + KV

## Where things live

| You want to... | Edit this file |
|----------------|----------------|
| Add an API route | `packages/worker/src/routes/<feature>.ts` |
| Change the DB schema | `packages/worker/migrations/000N_<name>.sql` + update `SCHEMA.md` |
| Add a frontend page | `packages/web/src/pages/<Page>.tsx` + route in `App.tsx` |
| Add a Zustand store | `packages/web/src/stores/<store>.ts` |
| Change auth | `packages/worker/src/routes/auth.ts` + `middleware/auth-guard.ts` |
| Change S3 API | `packages/worker/src/routes/s3.ts` + `middleware/s3-auth.ts` |
| Change Google Drive integration | `packages/worker/src/services/google-drive.ts` |
| Change the design system | `packages/web/src/index.css` + `tailwind.config.js` |

## Before you open a PR

Run all of these locally — CI will run the same checks:

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript compiler
npm test            # All tests (worker + web)
```

### PR checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Tests added for new behavior
- [ ] No new `any` types (use `unknown` or proper types)
- [ ] `CHANGELOG.md` updated (if user-facing change)
- [ ] `SCHEMA.md` updated (if DB schema changed)

## Code conventions

### The One Way

OmniDrive has one pattern for each concern. Don't introduce alternatives:

- **Routes**: use Hono route factories (`new Hono<AppContext>()` per feature)
- **DB access**: use `c.env.DB.prepare(...)` in routes (repository pattern is a future goal)
- **Errors**: `throw new AppError(status, message)` — never `return c.json({error}, 400)`
- **Logging**: `console.log/error` (structured logger is a future goal)
- **Validation**: Zod schemas or inline checks
- **Types**: no `any` — use `unknown` or proper types

### Comment conventions

- `// ponytail: <reason>` — marks deliberate technical-debt decisions (Indonesian slang for "note"). Always include the WHY, not just the WHAT.
- `// TODO:` — not used. Use `ponytail:` or open a GitHub issue instead.
- Regular comments — explain WHY, not WHAT. The code already says what it does.

### File size guideline

If a route file exceeds 500 lines, consider splitting it by concern (e.g. `files-crud.ts`, `files-upload.ts`). See `s3.ts` (860 lines) as an example of what to avoid.

### Secrets

- **Never commit secrets** to the repo. Use Cloudflare Workers Secrets (`npx wrangler secret put NAME`).
- **Never read `.env`, `.dev.vars`, or `wrangler.toml`** in AI agent tools — they may contain secrets. Verify via `wrangler secret list`.
- `.env.example` documents required vars but contains no real values.

## Testing

### Run tests

```bash
# All tests
npm test

# Worker tests only
npm run test --prefix packages/worker

# Single worker test file
npm run test --prefix packages/worker -- tests/s3-api.test.ts

# Web tests only
npm run test --prefix packages/web
```

### Writing tests

- **Unit tests**: test pure functions (mappers, validators, crypto)
- **Integration tests**: test routes through `app.request()` with a test D1
- **Smoke tests**: only for "does the route exist" — don't rely on these for behavior
- Place tests in `packages/worker/tests/` or `packages/web/src/**/*.test.tsx`
- Use descriptive `describe`/`it` names: `describe('POST /api/files/:id/star')`

## Deployment

OmniDrive deploys via Cloudflare Workers Builds (auto-deploys on push to `main`).

- **Worker**: `packages/worker/` → Cloudflare Workers
- **Frontend**: `packages/web/` → Cloudflare Pages
- **Database**: Cloudflare D1 (`omnidrive`)
- **KV**: Cloudflare KV (shared-link lockouts only)

To deploy manually:

```bash
npm run deploy:code    # Build + deploy worker + web
npm run deploy:full    # Run migrations + deploy:code
```

## Getting help

- **Read** `ARCHITECTURE.md` for system overview
- **Read** `SCHEMA.md` for database schema
- **Read** `AGENTS.md` for AI agent guidelines (some sections in Indonesian)
- **Open an issue** for bugs or feature requests
- **Check existing issues** before opening a new one

## Good first issues

Look for issues labeled `good-first-issue` — they're scoped to one file and have a known solution. These are great for getting familiar with the codebase.
