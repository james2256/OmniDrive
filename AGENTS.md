# AGENTS.md — Panduan untuk AI Agent

Dokumen ini menjelaskan cara bekerja di repo **OmniDrive** (fork, berasal dari [`abilfida/OmniDrive`](https://github.com/abilfida/OmniDrive)).

## Aturan Keamanan — WAJIB DIIKUTI

**DILARANG membaca isi file `.env` (lokal), `packages/worker/.dev.vars`, atau file apa pun yang berisi secret** (`read`, `cat`, `grep`, `ctx_execute_file`, atau tool lain yang mengembalikan isi file ke konteks). Secret production disimpan di Cloudflare Workers Secrets — verifikasi via `wrangler secret list` atau `.env.example`, bukan dengan membaca nilai.

**DILARANG menjalankan deploy dan dev server** — agent **tidak boleh** mengeksekusi perintah berikut (termasuk variasi lewat `npm`, `npx wrangler`, `make`, atau script di `scripts/`):

| Dilarang | Contoh perintah |
|----------|-----------------|
| Dev server | `npm run dev`, `npm run dev:worker`, `npm run dev:web`, `wrangler dev`, `vite`, `vite preview` |
| Deploy | `npm run deploy:code`, `npm run deploy:full`, `npm run deploy --prefix packages/worker`, `npm run deploy --prefix packages/web`, `node scripts/onboard-deploy.mjs`, `wrangler deploy`, `wrangler pages deploy` |

Alasan: deploy dan dev server memengaruhi lingkungan production/lokal milik maintainer. Agent cukup mengubah kode, menjalankan **test** (`npm test`), dan memberi instruksi deploy/dev kepada user jika diperlukan.

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

## Prinsip Biaya — 0 Biaya, Maksimalkan Free Tier

**Target operasional:** pertahankan proyek ini dengan **biaya $0** selama memungkinkan. Setiap keputusan arsitektur harus memprioritaskan **free tier** Cloudflare (Workers Free + Pages Free + D1 + KV) dan menghindari fitur berbayar atau pola yang mudah memicu overage.

Sebelum menaikkan iterasi crypto, menambah binding baru (DO/R2/Queues), atau mengubah observability, baca section ini. Jangan upgrade ke layanan berbayar tanpa persetujuan eksplisit maintainer.

### PBKDF2 & password hashing (`packages/worker/src/lib/password.ts`)

| Konteks | Keputusan | Alasan |
|---------|-----------|--------|
| User auth (register/login) | **10.000 iterasi** PBKDF2-SHA256 | Workers Free membatasi CPU ~10 ms/request; 100k sering memicu Error 1102 |
| Shared-link password (baru) | **10.000 iterasi**, format `shared:10000:salt:hash` via `hashSharedPassword` | Sama — aman CPU; dikombinasi rate limit + per-link lockout KV |
| Shared-link password (legacy) | Tetap verifikasi format lama `salt:hash` (implicit 100k) | Backward compat; jangan hapus tanpa migrasi data |

**Jangan** naikkan iterasi shared-link baru ke 100k “demi OWASP” — di Workers itu kontra-produktif (timeout CPU). Pertahanan brute-force utama: rate limiter (`index.ts`), lockout KV di `shared.ts` (`shared_verify_fail` / `shared_verify_lock`), bukan iterasi tinggi.

### Rate limiter (`packages/worker/src/middleware/rate-limiter.ts`)

Implementasi saat ini: **`Map` per isolate** (in-memory). Cukup untuk abuse kasual; lemah terhadap brute-force terdistribusi karena limit efektif bisa ×N isolate.

| Opsi | Biaya | Kapan pertimbangkan |
|------|-------|---------------------|
| **In-memory (sekarang)** | $0 | Default — pertahankan + komentar `ponytail` |
| **KV counter** | Free: 100k read + 1k write/hari; overage ~$0.50/juta read (Paid) | Hanya jika insiden brute-force nyata; KV **sudah ada** di project |
| **Durable Objects** | Free: 100k request/hari; Paid bisa mahal (duration billing) | **Hindari** — overkill & risiko biaya untuk app ini |
| **WAF Rate Limiting** (dashboard) | 1 rule gratis di plan Free CF | Alternatif $0 tanpa ubah kode; maintainer set di dashboard |

**Jangan** refactor rate limiter ke DO/KV hanya karena “best practice” — tunggu bukti masalah nyata. Upgrade KV lebih murah dari DO bila benar-benar diperlukan.

### Observability (`packages/worker/wrangler.toml`)

Konfigurasi disengaja — **logs on, traces off**:

```toml
[observability]
enabled = false          # switch utama observability (non-traces)

[observability.logs]
enabled = true           # Workers Logs — invocation + console.log
persist = true
invocation_logs = true

[observability.traces]
enabled = false          # matikan tracing (hemat noise & biaya)
```

| Item | Free tier | Catatan agent |
|------|-----------|---------------|
| Workers Logs | 200.000 events/hari | `head_sampling_rate = 1` = 100% request dilog; traffic tinggi → risiko overage di Paid |
| Traces | — | Biarkan `enabled = false` |

**Jangan** ubah `wrangler.toml` observability tanpa alasan jelas. Jika maintainer minta hemat log: turunkan `head_sampling_rate` (mis. `0.1`), bukan nyalakan traces.

### Ringkasan cepat untuk agent

1. **Jangan** introduce binding/layanan baru yang memicu biaya (DO, Queues, R2, Workers Paid-only) tanpa persetujuan.
2. **Utamakan** D1 + KV free tier yang sudah dipakai; token OAuth sudah di D1, KV hanya untuk shared-link rate/lockout.
3. **Hindari** pola CPU-heavy (bcrypt, PBKDF2 100k untuk path baru, `arrayBuffer()` file besar).
4. **Dokumentasikan** trade-off biaya di komentar `// ponytail:` bila sengaja menunda upgrade.

## Dokumentasi Proyek — Baca Dulu Sebelum Develop

Keempat dokumen di bawah adalah **sumber kebenaran** untuk domain, data, UI, dan riwayat proyek. Baca yang relevan **sebelum** menulis/mengubah kode supaya tidak kesusahan menemukan komponen dan hemat token. Setiap dokumen punya daftar section (anchor) — lompat langsung dengan `read` + `offset`/`limit` daripada baca seluruh file.

### `ARCHITECTURE.md` — Arsitektur Sistem (301 baris)

**Baca saat:** menyentuh backend/frontend flow, auth, sync, S3, deploy, atau butuh gambaran besar.

| Section (anchor) | Isi |
|------------------|-----|
| `#overview` | Gambaran sistem & diagram alur data |
| `#monorepo-structure` | Layout `packages/worker` vs `packages/web` |
| `#backend-architecture` | Route table, service table, middleware |
| `#authentication-flow` | OAuth Google + PKCE + session cookie |
| `#data-sync-architecture` | Initial/incremental sync, **Storage Quota & Capacity** (override + fallback chain) |
| `#s3-compatibility-layer` | SigV4, multipart upload, endpoint `/s3` |
| `#frontend-architecture` | Routing, Zustand stores, API client |
| `#scheduled-jobs-cron` | Cron `*/30` sync |
| `#security-model` | CSRF, RBAC, enkripsi token |
| `#deployment-topology` | Worker + Pages + D1 + KV |
| `#environment-configuration` | Env vars wajib |
| `#testing-strategy` | Vitest, area high-value test |

### `SCHEMA.md` — Skema Database D1 (413 baris)

**Baca saat:** mengubah tabel, menambah kolom, bikin migrasi, atau query D1.

| Section (anchor) | Isi |
|------------------|-----|
| `#diagram-relasi` | ERD mermaid semua tabel |
| `#tabel` | Detail kolom + tipe per tabel (drive_accounts, files, workspaces, …) — termasuk `quota_override` |
| `#migrasi-incremental` | Daftar `0001`–`0007` + perubahan |
| `#perintah-database` | `make db-migrate-local/remote`, factory reset |
| `#kv-store-bukan-d1` | Key KV (`tokens:`, `quota:`, `oauth_state:`) |

### `DESIGN.md` — UI & Design System (229 baris)

**Baca saat:** bikin/ubah komponen UI, page, styling, atau token warna.

| Section (anchor) | Isi |
|------------------|-----|
| `#filosofi-desain` | Prinsip desain OmniDrive |
| `#tech-stack-ui` | React 19, Vite, Tailwind, Radix, Zustand |
| `#design-tokens` | Token warna `--drive-*`, spacing, radius |
| `#layout` | `AppLayout` → Sidebar + Header + MainContent |
| `#halaman` | Tabel route → page (termasuk bento grid Dashboard, capacity editor di Settings) |
| `#komponen-ui-reusable` | Primitives & komponen bisnis |
| `#pola-interaksi` | Pola modal, toast, dropdown |
| `#responsive-aksesibilitas` | Breakpoint + a11y |
| `#panduan-menambah-ui-baru` | Checklist UI baru |
| `#anti-patterns-jangan` | Yang dihindari |

### `CHANGELOG.md` — Riwayat Perubahan (366 baris)

**Baca saat:** mulai sesi (cek `[Unreleased]`), selesai task (catat di `[Unreleased]`), atau cari kapan fitur/bug diperkenalkan. Versi pakai Keep a Changelog. Entry terbaru session ini: redesign Home jadi bento grid (Konsep 3) + recalibrasi palette brand (Opsi B — cobalt accent `#2563EB`) + drive identity color tokens (`--drive-1`..`--drive-5`).

> **Aturan:** setiap task yang mengubah perilaku/library UI wajib tambah entry di `CHANGELOG.md` bagian `[Unreleased]`. Lihat section "Menambah Fitur Baru" langkah 5.

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

> **Catatan agent:** Perintah dev dan deploy di bawah hanya untuk **maintainer (manusia)**. Agent dilarang menjalankannya — lihat "Aturan Keamanan".

```bash
# Install dependencies (dari root) — agent BOLEH
npm install

# Development (web + worker bersamaan) — agent DILARANG
npm run dev
npm run dev:worker    # worker saja
npm run dev:web       # web saja

# Test backend — agent BOLEH
npm test

# Migrate database — agent DILARANG kecuali user meminta eksplisit
npm run migrate:remote                    # migrasi D1 production (dari root)
npm run db:migrate:local --prefix packages/worker # migrasi D1 lokal

# Deploy — agent DILARANG (jalankan sendiri sebagai maintainer)
npm run deploy --prefix packages/worker   # Worker saja
npm run deploy --prefix packages/web      # build + Pages (frontend) saja
npm run deploy:code     # worker + web (tanpa migrasi)
npm run deploy:full     # migrasi remote + worker + web
node scripts/onboard-deploy.mjs   # wizard setup/deploy awal
```

**Port default** (dari `.env.example`): Web `8999`, Worker `8888`.

## Dual-Boot Windows + Linux Mint

Maintainer punya clone terpisah: Windows `D:\coding\OmniDrive` (HDD), Linux `~/coding/OmniDrive` (SSD). Kode via Git; secret via `scripts/sync-config-from-windows.sh`.

| OS | Dev start | Stop |
|----|-----------|------|
| Windows | `npm run dev` | tutup terminal / kill port |
| Linux | `make dev` atau `npm run dev` | `make stop` |

Baca **`LINUX-SETUP.md`** untuk prompt agent Linux, setup pertama, dan troubleshooting. Agent di Linux mengikuti aturan yang sama (dilarang baca `.env`, dilarang `npm run dev`/deploy).

## Aturan Kode

### Backend (`packages/worker`)

- Framework: **Hono** — router per domain di `src/routes/`
- Business logic: `src/services/` — jangan taruh logika berat di route handler
- Middleware global di `src/index.ts` (urutan penting): security headers → CORS → CSRF → rate limiter
- Auth: cookie `omnidrive_sid` + D1 session (tabel `sessions`, `middleware/auth-guard.ts`)
- S3: route terpisah di `/s3/*` dengan SigV4 (`middleware/s3-auth.ts`)
- Error: gunakan `AppError` dari `middleware/error-handler.ts`
- Database: D1 (SQLite) — skema di `src/db/schema.sql`, migrasi incremental `0001`–`0007`
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

1. **Baca dulu** dokumentasi relevan (lihat "Dokumentasi Proyek — Baca Dulu Sebelum Develop" di atas): `ARCHITECTURE.md` (flow), `SCHEMA.md` (tabel), `DESIGN.md` (UI), dan `CHANGELOG.md` `[Unreleased]` (konteks terkini)
2. **Backend**: route → service → query D1; tambah test di `packages/worker/tests/`
3. **Frontend**: method di `api.ts` → store (jika perlu) → komponen/page
4. **Schema change**: update `schema.sql` + buat migrasi `000N_*.sql` baru + update tabel di `SCHEMA.md` bagian `#tabel` + daftar di `#migrasi-incremental`
5. **Dokumentasi**: update `CHANGELOG.md` di bagian `[Unreleased]` (wajib); update `ARCHITECTURE.md`/`SCHEMA.md`/`DESIGN.md` bila flow/tabel/UI berubah
6. **UI**: ikuti `DESIGN.md` — jangan introduce design system baru

## Testing

```bash
# Semua test worker
npm test

# Test spesifik
npm test -- tests/s3-api.test.ts

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
3. `npm run migrate:remote` untuk schema production
4. `packages/web/.env.production` berisi `VITE_API_URL` production
5. `npm run deploy:full` (atau `npm run deploy:code` jika schema sudah up-to-date)

## Dokumentasi Terkait

Peta navigasi lengkap (kapan baca + section anchor) ada di section **"Dokumentasi Proyek — Baca Dulu Sebelum Develop"** di bagian atas dokumen ini. Ringkasan:

| File | Isi | Update terakhir |
|------|-----|-----------------|
| `ARCHITECTURE.md` | Diagram, alur data, komponen sistem, quota/capacity | Session ini (capacity editor ref pindah ke Settings) |
| `SCHEMA.md` | Tabel, relasi, indeks D1, migrasi `0001`–`0007` | Session sebelumnya (`quota_override` + migrasi `0007`) |
| `DESIGN.md` | Token warna cobalt, layout bento, pola komponen | Session ini (bento dashboard + Opsi B palette) |
| `CHANGELOG.md` | Riwayat versi (`[Unreleased]` + `0.9.7` ke bawah) | Session ini (bento redesign + cobalt palette + drive tokens) |
| `README.md` / `README.id.md` | Panduan user & setup | Tidak diubah (sudah rebrand OmniDrive) |
| `LINUX-SETUP.md` | Dual-boot Linux Mint: skrip setup, prompt agent, workflow harian | Session ini |

## Hal yang Jangan Dilakukan

- **Jangan jalankan dev server atau deploy** — `npm run dev`, `npm run dev:worker`, `npm run dev:web`, `npm run deploy:code`, `npm run deploy:full`, `npm run deploy --prefix packages/worker`, `npm run deploy --prefix packages/web`, `node scripts/onboard-deploy.mjs`, `wrangler dev`, `wrangler deploy`, `wrangler pages deploy` (lihat "Aturan Keamanan")
- Jangan push ke `upstream` — tidak punya akses write
- Jangan hapus copyright MIT asli
- Jangan bypass `authGuard` / `csrfGuard` pada endpoint mutasi
- Jangan load seluruh Google Drive tree ke memori — gunakan generator/iterator
- Jangan hardcode URL production di kode — gunakan env vars
- Jangan buat file markdown baru kecuali diminta (kecuali update dokumen di atas)
- **Jangan baca file `.env`, `.dev.vars`, atau file berisi secret** — lihat "Aturan Keamanan" di paling atas
- **Jangan upgrade ke layanan berbayar** (DO, R2, Workers Paid-only features) atau naikkan iterasi crypto/observability tanpa persetujuan — lihat "Prinsip Biaya — 0 Biaya, Maksimalkan Free Tier"

## Konteks Rebrand (Masa Depan)

Proyek ini direncanakan sebagai aplikasi mandiri. Saat rebrand:

1. Update `package.json` names (`omnidrive` → nama baru)
2. Ganti string UI di `LoginPage`, `Header`, `SetupPage`
3. Update `docker-compose.yml`, `wrangler.toml` worker name
4. Tambah copyright di `LICENSE`, jangan hapus yang lama
5. Update semua dokumen di folder root ini