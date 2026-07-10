# Linux Mint Setup — Dual-Boot dengan Windows

Panduan untuk develop **OmniDrive / OmniDrive** di Linux Mint sementara clone Windows tetap di HDD.

| OS | Lokasi repo | Storage |
|----|-------------|---------|
| Windows | `D:\coding\OmniDrive` | HDD |
| Linux Mint | `~/coding/OmniDrive` | SSD |

Kode disinkronkan lewat **Git**. File secret (`.env`, `wrangler.toml`) disalin dari Windows saat setup atau saat berubah.

---

## Prompt untuk AI Agent (copy-paste)

Gunakan blok di bawah saat membuka proyek di Linux Mint (Cursor, Claude Code, dll.):

```
Konteks lingkungan:
- Dual-boot Windows + Linux Mint.
- Repo Linux: ~/coding/OmniDrive (SSD, clone terpisah).
- Repo Windows: D:\coding\OmniDrive (HDD) — hanya untuk sinkron config, bukan workspace aktif di Linux.
- Ikuti AGENTS.md di root repo (aturan keamanan, dilarang baca .env/.dev.vars, dilarang npm run dev/deploy oleh agent).

Setup sudah dilakukan via scripts/setup-linux.sh kecuali disebutkan belum.

Workflow harian:
1. git pull sebelum mulai
2. npm install hanya jika package-lock.json berubah
3. Jika .env atau wrangler.toml diubah di Windows: jalankan scripts/sync-config-from-windows.sh dengan path mount HDD
4. Develop: maintainer jalankan `make dev` atau `npm run dev` (bukan agent)
5. Sebelum reboot ke Windows: git commit + push

Perintah yang BOLEH agent:
- npm test, npm run typecheck
- edit kode, baca dokumentasi (ARCHITECTURE.md, SCHEMA.md, DESIGN.md, CHANGELOG.md)
- npm run db:migrate:local hanya jika user minta eksplisit

Perintah Linux khusus:
- make dev / make stop / make logs (Makefile memakai lsof + nohup)
- packages/worker/.dev.vars adalah symlink ke ../../.env

Jangan:
- Share node_modules atau .wrangler/ antar OS
- Commit .env, wrangler.toml, .dev.vars
- Baca atau tampilkan isi file secret

Mount HDD Windows di Mint biasanya: /media/$USER/<label>/coding/OmniDrive
```

---

## Setup pertama (manusia)

### 1. Mount HDD Windows

Buka File Manager → klik partisi data Windows, atau cek:

```bash
ls /media/$USER/
# contoh: /media/asmara/Data/coding/OmniDrive
```

### 2. Jalankan skrip setup

```bash
cd ~/coding/OmniDrive   # atau clone dulu jika belum ada
git pull

chmod +x scripts/setup-linux.sh scripts/sync-config-from-windows.sh

# Ganti path mount sesuai mesin Anda:
WINDOWS_REPO=/media/$USER/Data/coding/OmniDrive ./scripts/setup-linux.sh
```

Tanpa mount Windows (isi `.env` manual):

```bash
./scripts/setup-linux.sh
cp .env.example .env
# edit .env, salin wrangler.toml dari Windows
```

### 3. Login Cloudflare (sekali per OS)

```bash
cd ~/coding/OmniDrive
npx wrangler login
npx wrangler whoami
```

### 4. Jalankan dev server

```bash
make dev      # background + dev.log
make logs     # tail log
make stop     # stop sebelum reboot ke Windows
```

Atau foreground: `npm run dev`

---

## Sinkron config dari Windows

Jalankan setelah mengubah `.env` atau `wrangler.toml` di Windows:

```bash
./scripts/sync-config-from-windows.sh /media/$USER/Data/coding/OmniDrive
```

File yang disalin:

- `.env`
- `packages/worker/wrangler.toml`
- `packages/web/.env.production` (jika ada)

---

## Workflow ganti OS

### Windows → Linux

```bash
cd ~/coding/OmniDrive
git pull
npm install                    # jika lockfile berubah
./scripts/sync-config-from-windows.sh /media/$USER/Data/coding/OmniDrive   # jika config berubah
make dev
```

### Linux → Windows

```bash
make stop
git add -A && git commit -m "..." && git push
# boot Windows → D:\coding\OmniDrive → git pull
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `better-sqlite3` build gagal | `sudo apt install build-essential python3` lalu `npm install` |
| `fnm: command not found` | `source ~/.bashrc` atau `eval "$(fnm env)"` |
| Port sudah dipakai | `make stop` atau `lsof -ti:8999,8888 \| xargs kill -9` |
| OAuth redirect error | Pastikan `WORKER_URL=http://localhost:8888` dan URI callback sama di Google Console |
| Session hilang setelah ganti OS | Normal untuk D1 lokal terpisah; login ulang, atau pakai remote D1 |
| `git pull` conflict | Selesaikan conflict di satu OS, commit, pull di OS lain |

---

## File yang tidak di-share antar OS

| Path | Alasan |
|------|--------|
| `node_modules/` | Native bindings per OS |
| `packages/worker/.wrangler/` | D1 database lokal per OS |
| `~/.wrangler/` / `%USERPROFILE%\.wrangler\` | Token Cloudflare per OS |

---

## Dokumen terkait

- `AGENTS.md` — aturan agent (wajib)
- `.env.example` — template environment
- `packages/worker/wrangler.example.toml` — template Worker config
- `Makefile` — perintah dev/stop/migrate di Linux