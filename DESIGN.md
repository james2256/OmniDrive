# DESIGN.md — UI & Design System

Panduan visual dan pola komponen untuk frontend OmniDrive (`packages/web`).

## Filosofi Desain

OmniDrive mengadopsi sistem desain **Claude-inspired warm canvas** (ref: [getdesign.md/claude](https://getdesign.md/claude/design-md)) dengan brand override cobalt — bersih, bento-driven, dan fungsional. Light mode dengan cream canvas floor, grounded cream cards, warm ink text, accent cobalt blue, dan dashboard asimetris. Bukan dark mode murni.

| Prinsip | Implementasi |
|---------|-------------|
| Bento asimetris | Dashboard grid 4-kolom dengan cell span varied (hero, donut, quick-access, drives, recent) |
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
  // Claude design system (getdesign.md/claude) — warm cream canvas, grounded cards.
  // Brand override: cobalt #2563EB replaces Claude's coral #cc785c for CTA/accent.
  background: "#faf9f5", // Canvas — cream floor, deliberately not pure white
  foreground: "#141413", // Ink — warm near-black (not cool)
  primary: {
    DEFAULT: "#2563EB", // Cobalt blue — brand CTA/accent (override of Claude coral)
    foreground: "#ffffff",
  },
  surface: "#f5f0e8", // Surface-soft — sidebar, shell, section bands
  card: "#efe9de", // Surface-card — grounded panels, one step darker than canvas
}
borderRadius: {
  lg: "0.5rem",
  md: "calc(0.5rem - 2px)",
  sm: "calc(0.5rem - 4px)",
}
```

### Hierarki Warna Claude

| Layer | Token | Hex | Peran |
|-------|-------|-----|-------|
| Canvas (floor) | `bg-background` | `#faf9f5` | Page floor — cream, lebih terang dari kartu |
| Surface (shell) | `bg-surface` | `#f5f0e8` | Sidebar, app shell, section divider |
| Card (grounded) | `bg-card` | `#efe9de` | Kartu panel — **lebih gelap dari floor** (grounded, bukan melayang) |
| Ink (teks utama) | `text-foreground` | `#141413` | Warm near-black, bukan cool gray |
| Primary (accent) | `bg-primary` | `#2563EB` | Cobalt blue — brand override (Claude pakai coral `#cc785c`) |

### Penggunaan Warna

| Token | Penggunaan |
|-------|-----------|
| `bg-background` | Page floor / canvas (`#faf9f5` cream — lebih terang dari kartu) |
| `bg-surface` | App shell & sidebar (`#f5f0e8` surface-soft) |
| `bg-card` | Semua elevated surfaces — bento cards, modal, dropdown, context menu, input, InfoPanel, toast (`#efe9de` grounded panel — lebih gelap dari floor) |
| `border-stone-*` | Warm gray borders (konsisten warm tone dengan canvas Claude) |
| `text-foreground` | Teks utama (`#141413` warm ink) |
| `text-stone-*` | Teks sekunder, muted, navigasi (warm gray — konsisten warm tone, bukan cool `text-gray-*`) |
| `bg-primary` / `text-primary` | Tombol utama, link (cobalt `#2563EB` brand override) |
| `bg-blue-100 text-stone-900` | Nav item aktif (sidebar) — cobalt accent pop di warm field |
| `hover:bg-stone-100` | Nav item hover (sidebar) |

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
| `/` | `DashboardPage` | Home — bento grid: storage hero (% besar + QuotaBar), donut breakdown per tipe (Recharts), quick-access tiles, connected drives, recent files, empty state bila belum ada drive, admin tile untuk `super_admin` |
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
| `DriveAccountCard` | Kartu akun Drive di Settings (quota bar, badge `· reconnect needed`/`· unreachable`, tombol Sync + Disconnect) |

### Modals

| Modal | Trigger |
|-------|---------|
| `ShareModal` | Share file |
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

- **Breakpoint mobile:** `<md` (<768px) = phone/tablet-portrait → drawer pattern; `md+` = desktop inline pattern
- Sidebar: desktop `w-64`/`w-16` inline collapsible via `useUIStore.isSidebarOpen`; mobile fixed drawer via `useUIStore.mobileSidebarOpen` + overlay backdrop, auto-close on route change
- InfoPanel: desktop inline `w-80` collapsible; mobile fixed right-drawer + overlay
- WorkspaceSidebar: desktop inline `w-64`; mobile drawer + toggle button (`PanelLeft`) in `WorkspaceMainView` breadcrumb row
- Toolbar (FilesPage, DashboardPage, SettingsPage, dll): `flex-wrap` + padding `p-4 sm:p-6`
- FileGrid list view: kolom Size/Modified `hidden sm:block` di mobile (hanya name + checkbox + action)
- BulkActionBar: `flex-wrap`, `bottom-4 left-2 right-2` mobile / centered pill desktop; touch target `py-2`+
- Dialog: `w-[calc(100%-1rem)] max-w-lg` + `p-4 sm:p-6` + `rounded-lg` di mobile
- Tabel (AdminUsersPage, SettingsPage S3 keys): `overflow-x-auto` wrapper
- Touch target: minimal `py-2`/`p-2` pada nav items & icon buttons (≈40–48px)
- Radix primitives menyediakan keyboard navigation dan focus trap di modal
- Icon + text label pada semua nav items (bukan icon-only); label sembunyi di very-small viewport bila perlu (`hidden sm:inline`)
- Omnibar: `hidden sm:block` di Header (search via dedicated route di phone) — wrapper width diatur Header, bukan hardcode `max-w-[720px]`

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

Estetika target: **premium SaaS cobalt** — sidebar `#F1F5F9`, primary blue `#2563EB`, pill navigation, bento grid Dashboard, donut breakdown per tipe file.