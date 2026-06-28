# Prompt: Setup Production OmniDrive (Cloudflare)

Salin seluruh blok di bawah ini ke sesi AI baru.

---

## PROMPT (copy dari sini)

```
Saya ingin deploy OmniDrive ke production di Cloudflare. Bantu saya setup end-to-end — jalankan perintah sendiri, jangan hanya beri instruksi.

## Konteks proyek

- Repo: D:\coding\OmniDrive (fork dari abilfida/OmniDrive, maintainer: asmaraputra)
- Monorepo npm workspaces:
  - packages/worker → Hono API di Cloudflare Workers
  - packages/web → React 19 + Vite SPA → Cloudflare Pages
- Database: Cloudflare D1 (SQLite)
- Session & OAuth tokens: Cloudflare KV (token terenkripsi AES-256-GCM)
- Wrangler: ^4.105.0
- Penggunaan: PRIBADI (Google OAuth mode Testing, test users only)

## Status saat ini

- Dev server sudah jalan lokal (web :8999, worker :8888)
- .env lokal sudah ada (JWT_SECRET, TOKEN_ENCRYPTION_KEY sudah digenerate)
- packages/worker/.dev.vars sudah ada
- packages/worker/wrangler.toml masih berisi D1/KV ID milik upstream — HARUS diganti dengan resource Cloudflare akun SAYA
- packages/web/.env.production masih URL upstream: https://omnidrive-api.serunix.workers.dev — HARUS diganti setelah deploy worker

## Tujuan production

1. Buat resource Cloudflare baru (D1 + KV) di akun saya
2. Update wrangler.toml dengan ID milik saya
3. Set secrets production via wrangler
4. Migrate D1 remote (schema.sql)
5. Deploy Worker → catat URL worker
6. Update packages/web/.env.production dengan VITE_API_URL worker saya
7. Deploy frontend ke Cloudflare Pages
8. Update Google OAuth redirect URI untuk production
9. Verifikasi: health check, login setup, connect Google Drive

## Akun & credentials (isi sebelum mulai atau minta saya isi saat runtime)

- Cloudflare: sudah login via `npx wrangler login` (cek dulu, login jika belum)
- Google Cloud OAuth:
  - GOOGLE_CLIENT_ID: [ISI atau ambil dari .env lokal]
  - GOOGLE_CLIENT_SECRET: [ISI atau ambil dari .env lokal]
- Production URLs (akan ditentukan setelah deploy):
  - Worker: https://<nama-worker>.<subdomain>.workers.dev
  - Pages: https://<project>.pages.dev (atau custom domain jika ada)

## Variabel environment production

### Worker secrets (wrangler secret put — JANGAN commit)
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- JWT_SECRET (generate baru untuk production, jangan reuse dev)
- TOKEN_ENCRYPTION_KEY (generate baru untuk production, jangan reuse dev)

### Worker vars (wrangler.toml [vars])
- FRONTEND_URL = URL Pages production (untuk CORS & OAuth redirect)
- WORKER_URL = URL Worker production (untuk OAuth callback)

### Frontend build (packages/web/.env.production)
- VITE_API_URL = URL Worker production

## Google OAuth — redirect URI production

Tambahkan di Google Cloud Console → Credentials → OAuth Client:
- https://<WORKER_URL>/api/auth/callback

Contoh: https://omnidrive-api-asmaraputra.workers.dev/api/auth/callback

OAuth consent screen: mode Testing, tambahkan email saya sebagai test user.

## Perintah referensi (Windows PowerShell)

```powershell
# Login Cloudflare
npx wrangler login

# Buat D1
cd packages/worker
npx wrangler d1 create omnidrive

# Buat KV
npx wrangler kv namespace create KV

# Migrate DB remote
npm run db:migrate:remote

# Set secrets (interactive)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY

# Deploy worker
npx wrangler deploy

# Build & deploy web
cd ../web
# set VITE_API_URL di .env.production dulu
npx vite build
npx wrangler pages deploy dist --project-name omnidrive --branch main
```

## wrangler.toml — yang perlu diupdate

```toml
name = "omnidrive-api"   # bisa diganti unik, mis. omnidrive-asmaraputra
compatibility_date = "2025-06-01"
compatibility_flags = [ "nodejs_compat_v2" ]

[[d1_databases]]
binding = "DB"
database_name = "omnidrive"
database_id = "<D1_ID_BARU>"

[[kv_namespaces]]
binding = "KV"
id = "<KV_ID_BARU>"

[vars]
FRONTEND_URL = "https://<pages-url>"
# WORKER_URL harus juga di-set — cek apakah perlu ditambah ke [vars] atau secret
```

## Checklist verifikasi pasca-deploy

- [ ] GET https://<worker>/api/health → { "status": "ok" }
- [ ] Buka https://<pages> → halaman setup/login muncul
- [ ] Buat akun admin pertama (setup)
- [ ] Login berhasil
- [ ] Connect Google Drive → OAuth redirect tidak error
- [ ] CORS tidak error (FRONTEND_URL harus match URL Pages)
- [ ] Cookie session jalan (SameSite=None, Secure di HTTPS)

## Batasan & catatan

- JANGAN push secrets ke git
- JANGAN pakai D1/KV ID milik upstream (abilfida) — buat resource sendiri
- Generate JWT_SECRET dan TOKEN_ENCRYPTION_KEY BARU untuk production
- Dokumentasi proyek: AGENTS.md, ARCHITECTURE.md, SCHEMA.md
- Perbaikan keamanan token sudah diterapkan (tidak ada plaintext oauth: di KV)

## Yang saya harapkan dari AI

1. Cek `wrangler whoami` — konfirmasi akun Cloudflare
2. Buat D1 + KV baru, update wrangler.toml
3. Generate production secrets
4. Deploy worker → pages → migrate DB
5. Update .env.production + Google OAuth redirect URI (instruksikan saya jika perlu aksi manual di Google Console)
6. Test end-to-end dan laporkan URL production final
7. Buat ringkasan: URL worker, URL pages, apa yang perlu saya simpan

Mulai sekarang. Tanyakan hanya jika benar-benar butuh credential yang belum tersedia.
```

---

## Setelah deploy — simpan ini

| Item | Nilai |
|------|-------|
| Worker URL | |
| Pages URL | |
| D1 database_id | |
| KV namespace id | |
| JWT_SECRET (prod) | *(simpan di password manager)* |
| TOKEN_ENCRYPTION_KEY (prod) | *(simpan di password manager)* |
| Google OAuth redirect URI | |