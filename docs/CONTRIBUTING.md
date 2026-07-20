# Contributing to OmniDrive

## Quick Start (15 min)

1. Install Node.js 20+: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`
2. Clone: `git clone https://github.com/james2256/OmniDrive.git`
3. Install deps: `npm install`
4. Copy `.env.example` to `.env` and fill in:
   - `JWT_SECRET` — generate with `openssl rand -hex 32`
   - `TOKEN_ENCRYPTION_KEY` — generate with `openssl rand -hex 32`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console (optional for initial setup)
5. Set up local DB: `cd packages/worker && npm run db:migrate:local`
6. Start dev: `npm run dev` (runs worker on :8888 + web on :5173)
7. Open http://localhost:5173

## Architecture

OmniDrive is a monorepo with two packages:

- **`packages/worker`** — Cloudflare Workers backend (Hono framework)
  - `routes/` — HTTP handlers (thin orchestrators, no SQL)
  - `services/` — Business logic + RBAC + Google API calls
  - `repositories/` — All SQL lives here
  - `middleware/` — Auth, CORS, CSRF, rate limiting, request ID
  - `lib/` — Shared utilities (crypto, validation, env)
- **`packages/web`** — React 19 + Vite frontend
  - `pages/` — Route-level components
  - `hooks/` — TanStack Query mutation hooks (API + toast + cache invalidation)
  - `stores/` — Zustand stores for client state (UI, selection, toasts)
  - `lib/` — API client, query keys, invalidation helpers

See `docs/ARCHITECTURE.md` for full details.

## Conventions

### Backend
- **Routes** (`routes/*.ts`): HTTP parsing + Zod validation + call service. No SQL.
- **Services** (`services/*.ts`): Business logic + RBAC + Google API. No SQL strings.
- **Repositories** (`repositories/*.ts`): All SQL lives here. Named by intent.
- **Errors**: `throw new NotFoundError('File not found')` — not `throw new AppError(404, ...)`.
- **Validation**: Use Zod schemas in `lib/schemas.ts` + `zValidator` middleware.

### Frontend
- **Pages** (`pages/*.tsx`): Route-level components. Use mutation hooks.
- **Mutation hooks** (`hooks/useFileMutations.ts`): API call + toast + cache invalidation.
- **Query keys**: `lib/queryKeys.ts` — single source of truth.
- **Stores** (`stores/use*Store.ts`): Zustand, named `use*Store`.
- **Server state**: TanStack Query (drives, files, shared links, etc.)
- **Client state**: Zustand (UI, selection, toasts, uploads)

### Commits
Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`

## Testing

- `npm run test` — runs all tests (worker + web)
- `npm run test:worker` — worker package tests
- `npm run test:web` — web package tests
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript

## PR Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] No `console.log` in production code (include `c.get('requestId')` in error logs)
- [ ] No inline SQL in routes/services (put it in a repository)
