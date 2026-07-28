# Name
### @omnidrive/web

# Synopsis
React 19 + Vite SPA frontend for OmniDrive. Deployed to Cloudflare Pages (production) or served as static files by the unified Docker image.

# Description
- **Entry**: `src/main.tsx` → `src/App.tsx`.
- **Pages** (`src/pages/`): 17 pages — Landing, Login, Setup, Dashboard, Files, Search, Starred, Trash, SharedLinks, PublicShared, Workspaces, Automations, Settings, AdminUsers, External, PrivacyPolicy, TermsOfService.
- **Components** (`src/components/`): 6 subdirectories — `files/`, `layout/`, `legal/`, `settings/`, `ui/`, `workspaces/` — plus top-level modals, cards, breadcrumb, drop zone, etc.
- **Stores** (`src/stores/`): 6 Zustand stores — `useAuthStore`, `useUIStore`, `useSelectionStore`, `useToastStore`, `useUploadStore`, `useAutomationStore`.
- **Hooks** (`src/hooks/`): 7 TanStack Query hooks — `useDrives`, `useFileMutations`, `useFolderMutations`, `useSharedLinks`, `useMergedDrive`, `useClipboard`, `useItemModals`.
- **Lib** (`src/lib/`): `api.ts` (fetch client), `queryKeys.ts`, `invalidate.ts`, `lazyWithRetry.ts`, `sort-items.ts`, `utils.ts`.
- **Pages Functions** (`functions/api/[[path]].ts`, `functions/s3/[[path]].ts`, `functions/_proxy.ts`): proxy to the Worker on Cloudflare Pages (see `docs/adr/0006-pages-functions-proxy.md`).
- **Tests**: `src/**/*.test.ts(x)` (16 files) — pages, components, stores, lib.
- **Build**: `tsc -b && vite build` → `dist/`.

# Example
```bash
npm run dev      # vite (default port 8999, or WEB_PORT/PORT from .env)
npm run build    # tsc -b && vite build
npm run preview  # vite preview
npm test         # vitest run
npm run deploy   # wrangler pages deploy dist/ --project-name omnidrive --branch main
```

# Install:
`npm install @omnidrive/web`

# Test:
`npm test`

# License:
MIT — see [../../LICENSE](../../LICENSE)
