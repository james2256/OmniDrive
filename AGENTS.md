# AGENTS.md — Panduan untuk AI Agent

Dokumen ini menjelaskan cara bekerja di repo **OmniDrive** (fork independen milik `asmaraputra`, berasal dari [`abilfida/OmniDrive`](https://github.com/abilfida/OmniDrive)).

## Ringkasan Proyek

| Item | Nilai |
|------|-------|
| Nama | OmniDrive |
| Versi | `0.9.7` (lihat `package.json`) |
| Lisensi | MIT — pertahankan copyright `abilfida` di `LICENSE` |
| Maintainer | `asmaraputra` |
| Upstream | `abilfida/OmniDrive` (opsional, `git fetch upstream`) |
| Stack | Hono + Cloudflare Workers, D1, KV, React 19, Vite, Zustand |

**OmniDrive** adalah gateway penyimpanan multi-Google Drive dengan workspace tim, shared links, automasi, dan API kompatibel S3.

## Struktur Monorepo

```
omnidrive/
├── packages/worker/     # Backend API (Cloudflare Worker)
├── packages/web/        # Frontend SPA (React + Vite)
├── AGENTS.md            # Panduan ini
├── ARCHITECTURE.md      # Arsitektur sistem
├── SCHEMA.md            # Skema database D1
├── DESIGN.md            # Panduan UI/UX
├── CHANGELOG.md         # Riwayat perubahan
├── Makefile             # Dev & deploy shortcuts
└── .env.example         # Template environment variables
```

## Perintah Penting

```bash
# Install dependencies (dari root)
npm install

# Development (web + worker bersamaan)
npm run dev
# atau: make dev

# Test backend
npm test

# Migrate database lokal
make db-migrate-local

# Deploy
make deploy-worker    # Cloudflare Worker
make deploy-web       # Cloudflare Pages
make deploy-all       # Keduanya
```

**Port default** (dari `.env.example`): Web `8999`, Worker `8888`.

## Aturan Kode

### Backend (`packages/worker`)

- Framework: **Hono** — router per domain di `src/routes/`
- Business logic: `src/services/` — jangan taruh logika berat di route handler
- Middleware global di `src/index.ts` (urutan penting): security headers → CORS → CSRF → rate limiter
- Auth: cookie `omnidrive_sid` + KV session (`middleware/auth-guard.ts`)
- S3: route terpisah di `/s3/*` dengan SigV4 (`middleware/s3-auth.ts`)
- Error: gunakan `AppError` dari `middleware/error-handler.ts`
- Database: D1 (SQLite) — skema di `src/db/schema.sql`, migrasi incremental `0001`–`0006`
- Tipe: `src/types/env.ts` untuk `Env`, `SessionData`, `AppContext`

### Frontend (`packages/web`)

- Routing: `App.tsx` (React Router v7)
- State: **Zustand** di `src/stores/` — hindari prop drilling untuk state global
- API client: `src/lib/api.ts` — semua fetch ke backend lewat sini
- Komponen UI: Radix primitives di `src/components/ui/`
- Layout: `AppLayout` → `Sidebar` + `Header` + `MainContent`
- Styling: Tailwind CSS — ikuti token di `tailwind.config.js` (lihat `DESIGN.md`)

### Konvensi Umum

- Bahasa kode & komentar: **English**
- TypeScript strict — hindari `any` kecuali sudah ada pola legacy
- ID: `generateId()` dari `packages/worker/src/lib/id.ts`
- Validasi input: `packages/worker/src/lib/validation.ts`
- Jangan commit: `wrangler.toml` secrets, `.env`, file database lokal (`*.sqlite`)

## Alur Kerja Git (Jalur A — Fork)

```bash
# Push ke fork sendiri
git push origin main

# Ambil update upstream (opsional)
git fetch upstream
git merge upstream/main
```

- **origin** → `asmaraputra/OmniDrive` (push di sini)
- **upstream** → `abilfida/OmniDrive` (fetch only)

## Area Sensitif — Hati-hati Saat Mengubah

| Area | File kunci | Catatan |
|------|-----------|---------|
| Auth & session | `routes/auth.ts`, `services/auth.service.ts` | PKCE, JWT, enkripsi token AES-256-GCM |
| RBAC | `middleware/rbac.ts` | Role workspace: viewer → owner |
| S3 SigV4 | `middleware/s3-auth.ts`, `lib/crypto-s3.ts` | Signature mismatch sangat sensitif |
| Sync | `services/sync.ts`, `services/google-drive.ts` | OOM-safe generator, checkpoint `next_page_token` |
| CSRF | `middleware/csrf-guard.ts` | Semua mutasi `/api/*` |
| Shared links | `routes/shared.ts` | IDOR prevention, rate limit verify |

## Menambah Fitur Baru

1. **Baca dulu** `ARCHITECTURE.md` dan `SCHEMA.md` untuk memahami domain
2. **Backend**: route → service → query D1; tambah test di `packages/worker/tests/`
3. **Frontend**: method di `api.ts` → store (jika perlu) → komponen/page
4. **Schema change**: update `schema.sql` + buat migrasi `000N_*.sql` baru
5. **Dokumentasi**: update `CHANGELOG.md` di bagian `[Unreleased]`
6. **UI**: ikuti `DESIGN.md` — jangan introduce design system baru

## Testing

```bash
# Semua test worker
npm test

# Test spesifik
npm run test -w packages/worker -- tests/s3-api.test.ts

# Frontend (vitest tersedia di web package)
cd packages/web && npx vitest run
```

Prioritas test untuk perubahan di: auth, S3, sync, RBAC, shared links.

## Environment Variables

Salin `.env.example` → `.env` di root. Variabel wajib:

| Variable | Package | Fungsi |
|----------|---------|--------|
| `GOOGLE_CLIENT_ID` | worker | OAuth Google Drive |
| `GOOGLE_CLIENT_SECRET` | worker | OAuth Google Drive |
| `JWT_SECRET` | worker | Signing session token |
| `TOKEN_ENCRYPTION_KEY` | worker | Enkripsi OAuth token di KV |
| `FRONTEND_URL` | worker | CORS origin |
| `WORKER_URL` | worker | Redirect OAuth callback |
| `VITE_API_URL` | web | Base URL API saat build |

Worker membaca secrets via `.dev.vars` (symlink dari `.env` saat `make dev`).

## Deploy Checklist

1. `wrangler.toml` dikonfigurasi (D1 `database_id`, KV `id`)
2. Secrets di-set: `npx wrangler secret put JWT_SECRET` (dan lainnya)
3. `make db-migrate-remote` untuk schema production
4. `packages/web/.env.production` berisi `VITE_API_URL` production
5. `make deploy-all`

## Dokumentasi Terkait

| File | Isi |
|------|-----|
| `ARCHITECTURE.md` | Diagram, alur data, komponen sistem |
| `SCHEMA.md` | Tabel, relasi, indeks D1 |
| `DESIGN.md` | Token warna, layout, pola komponen |
| `CHANGELOG.md` | Riwayat versi |
| `README.md` / `README.id.md` | Panduan user & setup |

## Hal yang Jangan Dilakukan

- Jangan push ke `upstream` — tidak punya akses write
- Jangan hapus copyright MIT asli
- Jangan bypass `authGuard` / `csrfGuard` pada endpoint mutasi
- Jangan load seluruh Google Drive tree ke memori — gunakan generator/iterator
- Jangan hardcode URL production di kode — gunakan env vars
- Jangan buat file markdown baru kecuali diminta (kecuali update dokumen di atas)

## Konteks Rebrand (Masa Depan)

Proyek ini direncanakan sebagai aplikasi mandiri. Saat rebrand:

1. Update `package.json` names (`omnidrive` → nama baru)
2. Ganti string UI di `LoginPage`, `Header`, `SetupPage`
3. Update `docker-compose.yml`, `wrangler.toml` worker name
4. Tambah copyright di `LICENSE`, jangan hapus yang lama
5. Update semua dokumen di folder root ini