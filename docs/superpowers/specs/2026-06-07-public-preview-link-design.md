# Public Preview Link Design

## Overview
Fitur "Public Preview Link" memungkinkan pengguna aplikasi Omnidrive untuk membagikan file tunggal maupun seluruh folder kepada siapa saja melalui tautan publik. Pengunjung yang memiliki tautan dapat mengakses konten tersebut tanpa perlu memiliki akun. Tautan dapat diamankan dengan menggunakan password dan batas waktu kedaluwarsa.

## Architecture & Database

Fitur ini akan mengandalkan satu tabel baru bernama `shared_links`.

### Schema: `shared_links`
- `id` (TEXT, PRIMARY KEY): String unik pendek (slug) yang menjadi bagian dari URL (contoh: "AbCd123").
- `user_id` (TEXT): ID pengguna yang membuat tautan (berelasi dengan tabel `users`).
- `target_type` (TEXT): Jenis target yang dibagikan, nilainya `'file'` atau `'folder'`.
- `target_id` (TEXT): ID file atau virtual folder yang sesuai dengan `target_type`.
- `password_hash` (TEXT, nullable): Hash dari password jika fitur keamanan password diaktifkan. Null jika tidak diproteksi.
- `expires_at` (TEXT, nullable): Waktu ISO 8601 batas berlakunya tautan. Null jika tautan berlaku permanen.
- `created_at` (TEXT): Waktu pembuatan tautan.

## API Endpoints (Worker)

1. **`POST /api/shared`**
   - **Tujuan**: Membuat tautan publik baru.
   - **Payload**: `{ target_type, target_id, password (opsional), expires_at (opsional) }`
   - **Response**: `{ id (slug), url }`

2. **`GET /api/shared`**
   - **Tujuan**: Mengambil daftar tautan yang pernah dibuat pengguna yang sedang login.

3. **`DELETE /api/shared/:id`**
   - **Tujuan**: Mencabut/menghapus tautan publik secara paksa.

4. **`GET /api/shared/:id`**
   - **Tujuan**: Mendapatkan metadata publik file/folder untuk ditampilkan di halaman pratinjau.
   - **Behavior**:
     - Jika tautan sudah kedaluwarsa, kembalikan `410 Gone` atau `404 Not Found`.
     - Jika file/folder dihapus, kembalikan `404 Not Found`.
     - Jika diproteksi password dan token tidak valid/tidak ada, kembalikan `401 Unauthorized` (menandakan klien harus meminta password).

5. **`POST /api/shared/:id/verify`**
   - **Tujuan**: Memvalidasi password pengunjung.
   - **Payload**: `{ password }`
   - **Response**: Mengembalikan token akses sementara (JWT) atau mengatur secure cookie untuk sesi pengunjung pada tautan ini.

6. **`GET /api/shared/:id/download`**
   - **Tujuan**: Mengunduh atau men-stream file secara mentah (Raw file stream).
   - **Autentikasi**: Membutuhkan token hasil verifikasi password jika `password_hash` diatur.

## Frontend UI & Flow (Web App)

### 1. Share Modal (Pembuatan Tautan)
- Tersedia pada halaman Dashboard atau Files (melalui menu konteks klik kanan atau tombol "Share").
- Menampilkan formulir sederhana dengan opsi untuk mengaktifkan:
  - **Password Protection**: Input text untuk memasukkan PIN/Password.
  - **Expiration Date**: Date picker untuk memilih tanggal kedaluwarsa.
- Menampilkan daftar tautan aktif yang tertaut pada item tersebut untuk mempermudah pencabutan akses (Revoke).
- Menyediakan tombol "Copy Link".

### 2. Public Preview Page (`/shared/:id`)
- Halaman ini diakses pengunjung (tanpa login).
- **Password Gate**: Jika API `/api/shared/:id` merespons `401 Unauthorized`, halaman akan menampilkan form input password.
- **Tampilan File Tunggal**:
  - Menampilkan informasi file (Nama, Ukuran).
  - Pratinjau (Preview) untuk format yang didukung (misal: Gambar, PDF, Text).
  - Tombol "Download" besar yang mengarah ke `GET /api/shared/:id/download`.
- **Tampilan Folder**:
  - Menampilkan daftar file dalam mode *read-only* yang terstruktur.
  - Pengunjung dapat mengklik file di dalam folder tersebut untuk melihat pratinjau individu atau langsung mengunduhnya.
- **Raw File Access**: File mentah dapat langsung diakses jika pengunjung menavigasi ke API download secara langsung.
