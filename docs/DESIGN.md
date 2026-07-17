# DESIGN.md — UI & Design System

Visual guide and component patterns for the OmniDrive frontend (`packages/web`).

## Design Philosophy

OmniDrive adopts a **Claude-inspired warm canvas** design system (ref: [getdesign.md/claude](https://getdesign.md/claude/design-md)) with a cobalt brand override — clean, bento-driven, and functional. Light mode with a cream canvas floor, grounded cream cards, warm ink text, a cobalt blue accent, and an asymmetric dashboard. Not a pure dark mode.

| Principle | Implementation |
|-----------|----------------|
| Asymmetric bento | Dashboard 4-column grid with varied cell spans (hero, donut, quick-access, drives, recent) |
| Information density | File grid/list with metadata badges |
| Quick actions | Floating bulk action bar, context menu, drag-and-drop |
| Workspace hierarchy | Notion-style sidebar tree for workspace folders |
| Feedback | Toast notifications (`toastStore`), modal for destructive actions |

## UI Tech Stack

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

Defined in `packages/web/tailwind.config.js`:

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

### Claude Color Hierarchy

| Layer | Token | Hex | Role |
|-------|-------|-----|------|
| Canvas (floor) | `bg-background` | `#faf9f5` | Page floor — cream, lighter than cards |
| Surface (shell) | `bg-surface` | `#f5f0e8` | Sidebar, app shell, section divider |
| Card (grounded) | `bg-card` | `#efe9de` | Panel cards — **darker than floor** (grounded, not floating) |
| Ink (main text) | `text-foreground` | `#141413` | Warm near-black, not cool gray |
| Primary (accent) | `bg-primary` | `#2563EB` | Cobalt blue — brand override (Claude uses coral `#cc785c`) |

### Color Usage

| Token | Usage |
|-------|-------|
| `bg-background` | Page floor / canvas (`#faf9f5` cream — lighter than cards) |
| `bg-surface` | App shell & sidebar (`#f5f0e8` surface-soft) |
| `bg-card` | All elevated surfaces — bento cards, modal, dropdown, context menu, input, InfoPanel, toast (`#efe9de` grounded panel — darker than floor) |
| `border-stone-*` | Warm gray borders (consistent warm tone with Claude canvas) |
| `text-foreground` | Main text (`#141413` warm ink) |
| `text-stone-*` | Secondary text, muted, navigation (warm gray — consistent warm tone, not cool `text-gray-*`) |
| `bg-primary` / `text-primary` | Primary buttons, links (cobalt `#2563EB` brand override) |
| `bg-blue-100 text-stone-900` | Active nav item (sidebar) — cobalt accent pop on warm field |
| `hover:bg-stone-100` | Nav item hover (sidebar) |

### Typography

- Font: **system sans-serif** via `font-sans` (Tailwind default — Inter-like on most OSes)
- Sidebar navigation size: `text-sm`
- Sidebar version/footer: `text-xs`

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
│          │ InfoPanel (optional, right)              │
└──────────┴──────────────────────────────────────────┘
```

### Layout Components

| Component | File | Role |
|-----------|------|------|
| `AppLayout` | `components/layout/AppLayout.tsx` | Main shell |
| `Sidebar` | `components/layout/Sidebar.tsx` | Navigation + storage quota |
| `Header` | `components/layout/Header.tsx` | Top bar, user profile |
| `Omnibar` | `components/layout/Omnibar.tsx` | Global search |
| `MainContent` | `components/layout/MainContent.tsx` | Content wrapper |
| `InfoPanel` | `components/layout/InfoPanel.tsx` | File details + sync info |
| `BulkActionBar` | `components/layout/BulkActionBar.tsx` | Floating pill — bulk actions |
| `SidebarStorage` | `components/layout/SidebarStorage.tsx` | Stacked quota progress bar |

### Sidebar Navigation

Menu order (from `Sidebar.tsx`):

1. **Home** (`/`) — Dashboard
2. **My Drive** (`/files/root`) — Merged drive browsing
3. **Starred** (`/starred`)
4. **Shared** (`/shared`) — Shared links management
5. **Workspaces** (`/workspaces`) — Enterprise workspaces
6. **Trash** (`/trash`)
7. **Users** (`/admin/users`) — `super_admin` only
8. **Settings** (`/settings`)

**Nav link pattern**: `rounded-full` pill, `px-4 py-2`, 20px Lucide icon + label.

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/setup` | `SetupPage` | First-run admin setup |
| `/login` | `LoginPage` | Login/register |
| `/` | `DashboardPage` | Home — bento grid: storage hero (large % + QuotaBar), per-type donut breakdown (Recharts), quick-access tiles, connected drives, recent files, empty state when no drive yet, admin tile for `super_admin` |
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

## Reusable UI Components

### Primitives (`components/ui/`)

- `button.tsx` — CVA variants
- `dialog.tsx` — Modal (Radix Dialog)
- `dropdown-menu.tsx` — Dropdown menu
- `context-menu.tsx` — Right-click menu

### File & Drive

| Component | Purpose |
|----------|---------|
| `FileGrid` | Grid/list view with checkbox selection |
| `FileIcon` | Icon based on mime type |
| `FilePreviewModal` | Image/document preview |
| `Breadcrumb` | Folder navigation |
| `DropZone` | Drag-and-drop upload |
| `UploadModal` | Upload queue + progress |
| `DriveAccountCard` | Drive account card in Settings (quota bar, `· reconnect needed`/`· unreachable` badge, Sync + Disconnect buttons) |

### Modals

| Modal | Trigger |
|-------|---------|
| `ShareModal` | Share file |
| `EditShareModal` | Edit shared link |
| `MoveDriveModal` | Move files between drives (bulk) |
| `AddToWorkspaceModal` | Add files to a workspace |

### Workspace (`components/workspaces/`)

- `WorkspaceSidebar` — Hierarchical folder tree
- `WorkspaceMainView` — Tab container
- `WorkspaceFilesTab`, `WorkspaceMembersTab`, `WorkspaceAuditTab`, `WorkspaceSettingsTab`
- `WorkspaceTreeNode` — Expandable tree node

## Interaction Patterns

### File Selection

- Checkbox in `FileGrid` for multi-select
- Shift-click range selection
- `BulkActionBar` appears as a floating pill at the bottom
- Bulk actions: Move, Delete, Add to Workspace, Move Drive

### Upload

- Drag-and-drop via `DropZone` on the files page
- `UploadModal` shows the queue
- Drive auto-selected (most free space) via the backend `upload-router`

### Toast

- `toastStore` + `ToastContainer`
- One toast per action — avoid double notifications

### State Management (Zustand)

| Store | Responsibility |
|-------|----------------|
| `authStore` | User session |
| `driveStore` | Connected drives, quota |
| `useUIStore` | Sidebar open/close |
| `useSelectionStore` | File selection state |
| `uploadStore` | Upload queue |
| `toastStore` | Notifications |
| `sharedStore` | Shared links |
| `useAutomationStore` | Automation rules |

## Responsive & Accessibility

- **Mobile breakpoint:** `<md` (<768px) = phone/tablet-portrait → drawer pattern; `md+` = desktop inline pattern
- Sidebar: desktop `w-64`/`w-16` inline collapsible via `useUIStore.isSidebarOpen`; mobile fixed drawer via `useUIStore.mobileSidebarOpen` + overlay backdrop, auto-close on route change
- InfoPanel: desktop inline `w-80` collapsible; mobile fixed right-drawer + overlay
- WorkspaceSidebar: desktop inline `w-64`; mobile drawer + toggle button (`PanelLeft`) in `WorkspaceMainView` breadcrumb row
- Toolbar (FilesPage, DashboardPage, SettingsPage, etc.): `flex-wrap` + padding `p-4 sm:p-6`
- FileGrid list view: Size/Modified columns `hidden sm:block` on mobile (only name + checkbox + action)
- BulkActionBar: `flex-wrap`, `bottom-4 left-2 right-2` mobile / centered pill desktop; touch target `py-2`+
- Dialog: `w-[calc(100%-1rem)] max-w-lg` + `p-4 sm:p-6` + `rounded-lg` on mobile
- Tables (AdminUsersPage, SettingsPage S3 keys): `overflow-x-auto` wrapper
- Touch target: minimum `py-2`/`p-2` on nav items & icon buttons (~40–48px)
- Radix primitives provide keyboard navigation and focus trap in modals
- Icon + text label on all nav items (not icon-only); label hidden on very-small viewports if needed (`hidden sm:inline`)
- Omnibar: `hidden sm:block` in Header (search via dedicated route on phone) — wrapper width set by Header, not hardcoded `max-w-[720px]`

## Guide to Adding New UI

1. **Use existing tokens** — do not hardcode colors outside `tailwind.config.js`
2. **Follow the sidebar nav pattern** — `rounded-full`, `gap-3`, 20px icon
3. **Modal** — use `components/ui/dialog.tsx`
4. **API calls** — add a method in `lib/api.ts`, do not fetch directly in components
5. **Loading state** — return `null` or a skeleton, do not flash empty
6. **Error** — use `toastStore` for user feedback
7. **Admin-only UI** — check `user?.role === 'super_admin'` as in Sidebar

## Anti-Patterns (Do Not)

- Do not introduce a new CSS framework (Bootstrap, MUI, etc.)
- Do not add a dark mode toggle without updating all tokens (not yet in the codebase)
- Do not nest cards-inside-cards excessively
- Do not use inline styles except for a temporary error boundary (`App.tsx` connection error)
- Do not create custom button components — extend `components/ui/button.tsx`

## Visual Reference

Target aesthetic: **premium SaaS cobalt** — sidebar `#F1F5F9`, primary blue `#2563EB`, pill navigation, bento grid Dashboard, per-type donut breakdown.
