# DESIGN.md — UI & Design System

Panduan visual dan pola komponen untuk frontend OmniDrive (`packages/web`).

## Filosofi Desain

OmniDrive mengadopsi estetika **Google Drive / Google Workspace** — bersih, familiar, dan fungsional. Bukan dark mode murni; tema utama adalah **light mode** dengan sidebar abu-abu lembut dan aksen biru Google.

| Prinsip | Implementasi |
|---------|-------------|
| Familiaritas | Layout sidebar + main content seperti Google Drive |
| Kepadatan informasi | File grid/list dengan metadata badge |
| Aksi cepat | Bulk action bar floating, context menu, drag-and-drop |
| Hierarki workspace | Sidebar tree ala Notion untuk workspace folders |
| Feedback | Toast notifications (`toastStore`), modal untuk aksi destruktif |

## Tech Stack UI

| Layer | Library |
|-------|---------|
| Framework | React 19 |
| Routing | React Router v7 |
| Styling | Tailwind CSS 3.4 |
| Primitives | Radix UI (Dialog, Dropdown, Context Menu) |
| Icons | Lucide React |
| Charts | Recharts (storage category overview) |
| Variants | class-variance-authority + clsx + tailwind-merge |

## Design Tokens

Definisi di `packages/web/tailwind.config.js`:

```js
colors: {
  background: "hsl(0, 0%, 100%)",      // Putih — main canvas
  foreground: "hsl(222.2, 84%, 4.9%)", // Hampir hitam — teks utama
  primary: {
    DEFAULT: "#0B57D0",                 // Google Blue — CTA, link aktif
    foreground: "hsl(210, 40%, 98%)",
  },
  surface: "#F0F4F9",                   // Abu biru — sidebar background
}
borderRadius: {
  lg: "0.5rem",
  md: "calc(0.5rem - 2px)",
  sm: "calc(0.5rem - 4px)",
}
```

### Penggunaan Warna

| Token | Penggunaan |
|-------|-----------|
| `bg-background` | Area konten utama |
| `bg-surface` | Sidebar (`Sidebar.tsx`) |
| `text-foreground` | Teks body |
| `bg-primary` / `text-primary` | Tombol utama, link |
| `bg-blue-100 text-gray-900` | Nav item aktif (sidebar) |
| `hover:bg-gray-100` | Nav item hover |
| `text-gray-400` | Teks sekunder (versi, metadata) |
| `text-gray-700` | Teks navigasi default |

### Tipografi

- Font: **system sans-serif** via `font-sans` (Tailwind default — Inter-like pada kebanyakan OS)
- Ukuran navigasi sidebar: `text-sm`
- Versi/footer sidebar: `text-xs`

## Layout

```
┌─────────────────────────────────────────────────────┐
│ Header (search/Omnibar, user menu, actions)         │
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │ MainContent                              │
│ (256px)  │ ┌──────────────────────────────────────┐ │
│          │ │ Breadcrumb / Toolbar                 │ │
│ - Nav    │ ├──────────────────────────────────────┤ │
│ - Storage│ │ FileGrid / Page content              │ │
│ - Version│ │                                      │ │
│          │ └──────────────────────────────────────┘ │
│          │ InfoPanel (opsional, kanan)              │
└──────────┴──────────────────────────────────────────┘
```

### Komponen Layout

| Komponen | File | Peran |
|----------|------|-------|
| `AppLayout` | `components/layout/AppLayout.tsx` | Shell utama |
| `Sidebar` | `components/layout/Sidebar.tsx` | Navigasi + storage quota |
| `Header` | `components/layout/Header.tsx` | Top bar, user profile |
| `Omnibar` | `components/layout/Omnibar.tsx` | Search global |
| `MainContent` | `components/layout/MainContent.tsx` | Wrapper konten |
| `InfoPanel` | `components/layout/InfoPanel.tsx` | Detail file + sync info |
| `BulkActionBar` | `components/layout/BulkActionBar.tsx` | Floating pill — bulk actions |
| `SidebarStorage` | `components/layout/SidebarStorage.tsx` | Stacked progress bar kuota |

### Sidebar Navigation

Urutan menu (dari `Sidebar.tsx`):

1. **Home** (`/`) — Dashboard
2. **My Drive** (`/files/root`) — Browsing merged drive
3. **Starred** (`/starred`)
4. **Shared** (`/shared`) — Shared links management
5. **Workspaces** (`/workspaces`) — Enterprise workspaces
6. **Trash** (`/trash`)
7. **Users** (`/admin/users`) — Hanya `super_admin`
8. **Settings** (`/settings`)

**Pola nav link**: pill rounded-full, `px-4 py-2`, icon Lucide 20px + label.

## Halaman

| Route | Page | Fungsi |
|-------|------|--------|
| `/setup` | `SetupPage` | First-run admin setup |
| `/login` | `LoginPage` | Login/register |
| `/` | `DashboardPage` | Home — storage overview, recent files, per-drive capacity editor (gear icon → `parseSizeToBytes`) |
| `/files/:folderId?` | `FilesPage` | File browser |
| `/search` | `SearchPage` | Global search |
| `/workspaces` | `WorkspacesPage` | Workspace tabs (files, members, audit, settings) |
| `/automations` | `AutomationsPage` | Automation rules |
| `/settings` | `SettingsPage` | Drives, S3 credentials |
| `/shared` | `SharedLinksPage` | Manage shared links |
| `/shared/:id` | `PublicSharedPage` | Public share view (no auth) |
| `/trash` | `TrashPage` | Trashed files |
| `/starred` | `StarredPage` | Starred files |
| `/admin/users` | `AdminUsersPage` | User management |

## Komponen UI Reusable

### Primitives (`components/ui/`)

- `button.tsx` — CVA variants
- `dialog.tsx` — Modal (Radix Dialog)
- `dropdown-menu.tsx` — Menu dropdown
- `context-menu.tsx` — Right-click menu

### File & Drive

| Komponen | Fungsi |
|----------|--------|
| `FileGrid` | Grid/list view dengan checkbox selection |
| `FileIcon` | Icon berdasarkan mime type |
| `FilePreviewModal` | Preview gambar/dokumen |
| `Breadcrumb` | Navigasi folder |
| `DropZone` | Drag-and-drop upload |
| `UploadModal` | Queue upload + progress |
| `DriveAccountCard` | Kartu akun Drive di Settings (quota bar, editor kapasitas manual, badge `· manual`/`· reconnect needed`/`· unreachable`) |
| `DriveFolderBrowser` | Browser folder native Drive |

### Modals

| Modal | Trigger |
|-------|---------|
| `ShareModal` / `AdvancedShareModal` | Share file |
| `EditShareModal` | Edit shared link |
| `MoveDriveModal` | Pindah file antar drive (bulk) |
| `AddToWorkspaceModal` | Tambah file ke workspace |

### Workspace (`components/workspaces/`)

- `WorkspaceSidebar` — Tree hierarkis folder
- `WorkspaceMainView` — Tab container
- `WorkspaceFilesTab`, `WorkspaceMembersTab`, `WorkspaceAuditTab`, `WorkspaceSettingsTab`
- `WorkspaceTreeNode` — Node tree expandable

## Pola Interaksi

### File Selection

- Checkbox di `FileGrid` untuk multi-select
- Shift-click range selection
- `BulkActionBar` muncul sebagai floating pill di bawah
- Aksi bulk: Move, Delete, Add to Workspace, Move Drive

### Upload

- Drag-and-drop via `DropZone` di halaman files
- `UploadModal` menampilkan queue
- Drive dipilih otomatis (most free space) via backend `upload-router`

### Toast

- `toastStore` + `ToastContainer`
- Satu toast per aksi — hindari double notification

### State Management (Zustand)

| Store | Tanggung jawab |
|-------|---------------|
| `authStore` | User session |
| `driveStore` | Connected drives, quota |
| `useUIStore` | Sidebar open/close |
| `useSelectionStore` | File selection state |
| `uploadStore` | Upload queue |
| `toastStore` | Notifications |
| `sharedStore` | Shared links |
| `useAutomationStore` | Automation rules |

## Responsive & Aksesibilitas

- Sidebar: fixed `w-64`, collapsible via `useUIStore.isSidebarOpen`
- Target tap: minimal `py-2` pada nav items
- Radix primitives menyediakan keyboard navigation dan focus trap di modal
- Icon + text label pada semua nav items (bukan icon-only)

## Panduan Menambah UI Baru

1. **Gunakan token existing** — jangan hardcode warna di luar `tailwind.config.js`
2. **Ikuti pola sidebar nav** — `rounded-full`, `gap-3`, icon 20px
3. **Modal** — gunakan `components/ui/dialog.tsx`
4. **API calls** — tambah method di `lib/api.ts`, jangan fetch langsung di komponen
5. **Loading state** — return `null` atau skeleton, jangan flash empty
6. **Error** — gunakan `toastStore` untuk feedback user
7. **Admin-only UI** — cek `user?.role === 'super_admin'` seperti di Sidebar

## Anti-Patterns (Jangan)

- Jangan introduce CSS framework baru (Bootstrap, MUI, dll.)
- Jangan dark mode toggle tanpa update seluruh token (belum ada di codebase)
- Jangan cards-inside-cards nesting berlebihan
- Jangan inline style kecuali error boundary sementara (`App.tsx` connection error)
- Jangan buat komponen button custom — extend `components/ui/button.tsx`

## Referensi Visual

Estetika target: **Google Drive 2024+** — sidebar `#F0F4F9`, primary blue `#0B57D0`, pill navigation, stacked storage bar di sidebar bawah.