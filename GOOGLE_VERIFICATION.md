# Verifikasi Aplikasi oleh Google (OAuth Consent Screen)

Panduan step-by-step menghilangkan peringatan **"Google belum memverifikasi aplikasi ini"** secara permanen dengan verifikasi penuh (production).

> **Peringatan biaya & waktu:** OmniDrive memakai scope `https://www.googleapis.com/auth/drive` (akses seluruh Drive) yang dikategorikan Google sebagai **restricted scope**. Verifikasi restricted scope **wajib** lulus **CASA security assessment** (audit pihak ketiga berbayar). Total proses: **4–8 minggu**, biaya CASA **~$540/tahun (Tier 2)** dan bisa lebih tinggi. Kalau ini terlalu berat, pakai jalur Testing + Test Users (lihat bagian akhir).

---

## Prasyarat (siapkan dulu, ini yang paling sering bikin ditolak)

| Item | Wajib | Catatan |
|------|-------|---------|
| Domain sendiri | Ya | Bukan `*.workers.dev` / `*.pages.dev` generik. Production AzaDrive: `azadrive.my.id`. Google menolak domain shared. |
| Domain terverifikasi di Google Search Console | Ya | Buktikan kepemilikan domain sebelum bisa dipakai di consent screen. |
| Halaman **Privacy Policy** publik | Ya | URL di domainmu, bisa diakses tanpa login. Harus menyebut penggunaan data Google user. |
| Halaman **Terms of Service** | Ya | URL di domainmu. |
| App homepage publik | Ya | Landing page di domainmu yang menjelaskan fungsi app. |
| Logo app (120×120 px, PNG/JPG) | Ya | Harus **unik** — hindari ikon awan biru + kata "Drive" (dianggap meniru Google Drive). Pakai `logo-oauth-120.png` (lettermark "A" + titik multi-drive, tanpa teks). |
| Akun Google Workspace/Cloud dengan billing | Ya | CASA & beberapa langkah butuh project berbayar. |

---

## Langkah 1 — Lengkapi OAuth Consent Screen

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → pilih project OmniDrive.
2. **APIs & Services → OAuth consent screen**.
3. User type: **External**.
4. Isi **App information**:
   - App name: `OmniDrive` (atau nama rebrand).
   - User support email.
   - App logo (upload logo 120×120) — file siap pakai: `packages/web/public/logo-oauth-120.png`.
5. Isi **App domain** (gunakan URL production yang sudah live):
   - Application home page: `https://azadrive.my.id/home`
   - Privacy policy link: `https://azadrive.my.id/privacy`
   - Terms of service link: `https://azadrive.my.id/terms`
6. **Authorized domains**: tambahkan `my.id` (domain root, **wajib** terverifikasi di [Google Search Console](https://search.google.com/search-console) dulu).
7. Developer contact email.
8. Simpan.

---

## Langkah 2 — Deklarasikan Scope

1. Di consent screen, bagian **Scopes** → **Add or remove scopes**.
2. Tambahkan scope yang dipakai OmniDrive:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/drive` ← **restricted**
3. Simpan. Google akan menandai `drive` sebagai restricted dan meminta justifikasi + CASA di tahap submit.

> **Tip pengurangan beban:** kalau use-case OmniDrive sebenarnya cukup akses file yang dibuat app saja, ganti ke `drive.file` (sensitive, bukan restricted → **tidak butuh CASA**). Lihat bagian "Opsi memangkas verifikasi" di bawah.

---

## Langkah 3 — Publish ke Production

1. Consent screen → **Publishing status** → klik **Publish app**.
2. Konfirmasi. Status berubah ke **In production** tapi belum terverifikasi (peringatan masih ada sampai review lolos).

---

## Langkah 4 — Submit for Verification

1. Setelah publish, muncul tombol **Prepare for verification** / **Submit for verification**.
2. Isi form justifikasi tiap scope:
   - Jelaskan **kenapa** app butuh akses penuh Drive.
   - Contoh: "OmniDrive adalah gateway multi-Drive; user menghubungkan beberapa akun Drive untuk manajemen file terpusat, sehingga butuh read/write ke seluruh isi Drive yang dihubungkan."
3. Siapkan **video demo YouTube** (unlisted OK) yang menunjukkan:
   - URL OAuth (harus tampil domain terverifikasi di consent screen).
   - Alur user login → grant consent → app memakai scope Drive.
   - Fitur konkret yang butuh scope tersebut.
4. Submit.

---

## Langkah 5 — CASA Security Assessment (khusus restricted scope)

Karena `auth/drive` restricted, Google mengarahkan ke **CASA (Cloud Application Security Assessment)**:

1. Google mengirim email dari lab assessor pihak ketiga (mis. **TAC Security / Bishop Fox**).
2. Pilih **Tier**:
   - **Tier 2** (self-scan + verifikasi): ~$540/tahun. Cukup untuk kebanyakan app.
   - **Tier 3** (pentest manual): lebih mahal, untuk app volume besar.
3. Jalankan scan keamanan (SAST/DAST) pada codebase & endpoint production.
4. Perbaiki temuan (biasanya: header keamanan, TLS config, penyimpanan token).
   - OmniDrive sudah punya: security headers, CSRF guard, token AES-256-GCM di KV. Ini nilai plus saat audit.
5. Upload Letter of Validation (LoV) ke Google.

---

## Langkah 6 — Tunggu Review

- Google review: **beberapa hari sampai beberapa minggu**.
- Balas cepat kalau ada permintaan revisi (email dari `oauth-‑verification@google.com`).
- Setelah lolos: peringatan **hilang permanen** untuk semua user.

---

## Checklist Ringkas

```
[ ] Domain custom + terverifikasi di Search Console
[ ] Privacy policy + ToS + homepage publik di domain sendiri
[ ] Logo 120×120
[ ] Consent screen lengkap (production)
[ ] Scope dideklarasikan + justifikasi
[ ] Video demo YouTube
[ ] Submit for verification
[ ] CASA Tier 2 lulus + LoV di-upload
[ ] Review Google lolos
```

---

## Opsi memangkas verifikasi (hindari CASA)

Kalau tidak mau bayar CASA, ganti scope full Drive → `drive.file`:

**File yang perlu diubah** (scope saat ini `https://www.googleapis.com/auth/drive`):
- `packages/worker/src/routes/auth.ts:171`
- `packages/worker/src/routes/drives.ts:65`
- `packages/worker/src/lib/google-service-account.ts:2`

Ganti ke `https://www.googleapis.com/auth/drive.file` → jadi **sensitive scope** (tetap perlu verifikasi consent screen, tapi **tanpa CASA**).

> Konsekuensi: `drive.file` hanya bisa akses file yang **dibuat/dibuka lewat app**, bukan seluruh isi Drive yang sudah ada. Ini mengubah perilaku inti OmniDrive (gateway ke semua file existing). Jangan ganti kalau fitur "lihat semua file Drive" wajib ada.

---

## Alternatif tanpa verifikasi (pemakaian pribadi/tim kecil)

Tidak perlu jalur di atas kalau app cuma dipakai kamu + beberapa akun:

1. Consent screen → Publishing status = **Testing** (jangan publish).
2. Tambahkan semua email akun Google di **Test users** (maks. 100).
3. Peringatan tetap muncul, tapi bisa di-bypass via **Advanced → Go to OmniDrive (unsafe)**.
4. Token test user tidak dipaksa expire 7 hari (selama email terdaftar sebagai test user).

Gratis, langsung jalan, cocok untuk self-hosting pribadi.
