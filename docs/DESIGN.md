# DESIGN.md — UI & Design System

Visual guide and component patterns for the OmniDrive frontend (`packages/web`).

## Design Philosophy

OmniDrive adopts a **blue-brand** design system with a cobalt primary accent — clean, bento-driven, and functional. Light mode with a cool slate canvas floor, clean white cards, slate ink text, a cobalt blue accent, and an asymmetric dashboard. Not a pure dark mode.

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
| Styling | Tailwind CSS 4.3 (CSS-first config via `@theme` in `src/index.css`) |
| CSS pipeline | `@tailwindcss/postcss` + Lightning CSS (autoprefixer removed — Lightning CSS handles vendor prefixing internally) |
| Animations | `tw-animate-css` 1.4 (replaces `tailwindcss-animate` for Radix expand/collapse + fade/zoom keyframes) |
| Primitives | Radix UI (Dialog, Dropdown, Context Menu) |
| Icons | Lucide React |
| Charts | Recharts (storage category overview) |
| Variants | class-variance-authority + clsx + tailwind-merge |

## Design Tokens

Defined in `packages/web/src/index.css` via `@theme` (Tailwind v4 CSS-first config — `tailwind.config.js` was deleted):

```css
@import "tailwindcss";
@import "tw-animate-css";

@theme {
  --color-background: #f8fafc;          /* Canvas — slate floor, deliberately not pure white */
  --color-foreground: #0f172a;          /* Ink — slate-900 */
  --color-primary: #2563EB;             /* Cobalt blue — brand CTA/accent  */
  --color-primary-foreground: #ffffff;
  --color-surface: #eef2f7;             /* Surface-soft — sidebar, shell, section bands */
  --color-card: #ffffff;                /* Surface-card — grounded panels, one step darker than canvas */

  --radius-lg: 0.5rem;
  --radius-md: calc(0.5rem - 2px);
  --radius-sm: calc(0.5rem - 4px);
}
```

### Tailwind 4 Migration Notes

The frontend was migrated from Tailwind CSS 3.4 to 4.3. Config moved out of JS into CSS. Key changes to keep in mind when editing styles:

| Area | Tailwind 3 (before) | Tailwind 4 (after) |
|------|---------------------|---------------------|
| Entry directives | `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` (single import) |
| Theme config | `tailwind.config.js` `theme.extend` object | `@theme { --color-*: ...; --radius-*: ...; }` in `src/index.css` |
| Animation plugin | `tailwindcss-animate` (PostCSS plugin) | `tw-animate-css` (imported as CSS — same keyframes, e.g. `animate-in fade-in`, `data-[state=open]:animate-in`) |
| Vendor prefixes | `autoprefixer` PostCSS plugin | Removed — Tailwind 4 ships Lightning CSS which prefixes internally |
| PostCSS pipeline | `tailwindcss` + `autoprefixer` | `@tailwindcss/postcss` only (see `postcss.config.js`) |
| Config file | `packages/web/tailwind.config.js` | **Deleted.** All tokens now live in `packages/web/src/index.css` |

**`cursor: pointer` preflight fix.** Tailwind 4 intentionally removed `cursor: pointer` from `<button>` in preflight. OmniDrive's UX expects the pointer cursor on all clickable buttons, so it is restored in `src/index.css` `@layer base`:

```css
button:not(:disabled),
[role="button"]:not(:disabled) {
  cursor: pointer;
}
```

Any new clickable element that is not a native `<button>` should use `role="button"` (or the Radix `asChild` slot pattern) so it picks up this rule. Do not sprinkle `cursor-pointer` utility classes manually.

**`border-slate-300` consistency fix.** All text inputs, selects, modals, dropdowns, and bento cards use the same `border-slate-200` / `border-slate-300` cool gray border. When the project migrated to Tailwind 4 (whose default border color changed from `gray-200` to `currentColor`), every interactive border was audited and pinned to `border-slate-300` (or `border-slate-200` for softer card edges) — never `border-gray-*` (cool) and never the bare `border` utility (which now resolves to `currentColor`). New inputs should default to `border border-slate-300 rounded-lg bg-card focus:border-primary`.

### Color Hierarchy

| Layer | Token | Hex | Role |
|-------|-------|-----|------|
| Canvas (floor) | `bg-background` | `#f8fafc` | Page floor — slate-50, lighter than cards |
| Surface (shell) | `bg-surface` | `#eef2f7` | Sidebar, app shell, section divider |
| Card (grounded) | `bg-card` | `#ffffff` | Panel cards — **darker than floor** (grounded, not floating) |
| Ink (main text) | `text-foreground` | `#0f172a` | Slate-900 near-black, not cool gray |
| Primary (accent) | `bg-primary` | `#2563EB` | Cobalt blue — brand override (

### Color Usage

| Token | Usage |
|-------|-------|
| `bg-background` | Page floor / canvas (`#f8fafc` slate-50 — lighter than cards) |
| `bg-surface` | App shell & sidebar (`#eef2f7` surface-soft) |
| `bg-card` | All elevated surfaces — bento cards, modal, dropdown, context menu, input, InfoPanel, toast (`#ffffff` clean white panel) |
| `border-slate-*` | Cool gray borders (consistent cool tone matching the brand). Inputs/selects/bento cards pin to `border-slate-300` or `border-slate-200` — see **Tailwind 4 Migration Notes** below for why bare `border` is forbidden |
| `text-foreground` | Main text (`#0f172a` slate ink) |
| `text-slate-*` | Secondary text, muted, navigation (cool gray — consistent cool tone, not cool `text-gray-*`) |
| `bg-primary` / `text-primary` | Primary buttons, links (cobalt `#2563EB` brand override) |
| `bg-blue-100 text-slate-900` | Active nav item (sidebar) — cobalt accent pop on cool field |
| `hover:bg-slate-100` | Nav item hover (sidebar) |

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

### Dashboard Bento Grid

The home dashboard (`DashboardPage.tsx`) uses an asymmetric 4-column bento grid on desktop (`grid grid-cols-1 lg:grid-cols-4 gap-4 auto-rows-[minmax(150px,auto)]`). Cells fill in source order with explicit `lg:col-span-*` / `lg:row-span-*` — no empty cells, no row gaps, mobile collapses to a single column.

| Cell | Span | Content |
|------|------|---------|
| **Total storage** (hero) | `lg:col-span-2` | Large `%` used (5xl/6xl), free/used totals, `QuotaBar`, drive count badge |
| **By type** (donut) | `lg:col-span-2 lg:row-span-2` | Recharts donut (per-category bytes: documents/images/videos/audio/archives/other) + top-4 legend with percentages, centered `used` total inside donut hole |
| **Quick access** | `lg:col-span-2` | 2×2 tile grid — My Drive, Starred, Shared, Workspaces. Each tile is a `<button>` to `navigate(to)` with hover lift (`hover:-translate-y-[1px] hover:shadow-sm`) |
| **Connected drives** | `lg:col-span-4` | Full-width row of drive cards (1/2/3 cols responsive) — drive color avatar (round-robin via `getDriveColor(i)`), email, type, per-drive `QuotaBar`, usage % |
| **Recent** | `lg:col-span-3` | Inline `FileGrid` (list view) of recent files + folders, "View all" → `/files/root` |
| **Admin tools** | `lg:col-span-1` | `super_admin` only — fills the cell beside Recent; hidden for non-admins so the row stays tidy |

**Reveal animation:** every cell gets the `bento-reveal` class with a staggered inline `animationDelay` (60ms → 360ms in 60ms steps). Defined in `src/index.css` `@layer base` — `transform+opacity` only, and `prefers-reduced-motion: reduce` collapses to a static reveal. No Motion/Framer dep.

**Empty / loading states:** the grid is replaced by a centered "No drives connected" card (`bento-reveal`) when `drives.length === 0`, or a 3-cell pulsing skeleton matching the bento shape (`animate-pulse`) while the drives query loads.

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

1. **Use existing tokens** — do not hardcode colors; extend `@theme` in `src/index.css` if a new token is genuinely needed (do **not** reintroduce `tailwind.config.js`)
2. **Follow the sidebar nav pattern** — `rounded-full`, `gap-3`, 20px icon
3. **Modal** — use `components/ui/dialog.tsx`
4. **API calls** — add a method in `lib/api.ts`, do not fetch directly in components
5. **Loading state** — return `null` or a skeleton, do not flash empty
6. **Error** — use `toastStore` for user feedback
7. **Admin-only UI** — check `user?.role === 'super_admin'` as in Sidebar
8. **Clickable non-`<button>` elements** — add `role="button"` so the preflight `cursor: pointer` rule applies; do not sprinkle `cursor-pointer` utilities
9. **Borders** — pin interactive borders to `border-slate-300` (or `border-slate-200` for soft card edges). Never use the bare `border` utility (Tailwind 4 resolves it to `currentColor`) and never `border-gray-*`

## Anti-Patterns (Do Not)

- Do not introduce a new CSS framework (Bootstrap, MUI, etc.)
- Do not reintroduce `tailwind.config.js` — Tailwind v4 config lives in `src/index.css` via `@theme`. Do not re-add `@tailwind base/components/utilities` directives or `tailwindcss-animate`/`autoprefixer` PostCSS plugins either.
- Do not add a dark mode toggle without updating all tokens (not yet in the codebase)
- Do not nest cards-inside-cards excessively
- Do not use inline styles except for a temporary error boundary (`App.tsx` connection error)
- Do not create custom button components — extend `components/ui/button.tsx`
- Do not use bare `border` (Tailwind 4 default is `currentColor`) or cool `border-gray-*` — use `border-slate-200` / `border-slate-300` for cool consistency

## Visual Reference

Target aesthetic: **blue-brand with cobalt brand override** — slate sidebar `#eef2f7` (`bg-surface`), grounded cards `#ffffff` (`bg-card`, darker than the `#f8fafc` floor), cobalt primary `#2563EB`, pill navigation, asymmetric bento grid Dashboard, per-type donut breakdown.
