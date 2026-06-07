# File Browsing Breadcrumbs Design

## Overview
Implement a breadcrumb navigation system for browsing files in the Omnidrive project, specifically focusing on Google Drive folders. The breadcrumb will replace the static "Back" button and folder title, providing a scrollable horizontal path of ancestor folders.

## Architecture & Data Flow

### Backend (Worker)
- **Data Model**: Update `DriveFolderContents` interface in `packages/web/src/types/index.ts` to include `breadcrumb: BreadcrumbItem[]`.
- **API Changes (`packages/worker/src/routes/drives.ts`)**:
  - Introduce a recursive SQL helper `buildDriveBreadcrumb` that queries the `drive_folders` table using a `WITH RECURSIVE` CTE.
  - It traces the `google_parent_id` up to the root folder.
  - The path always begins with `id: 'root'` and `name: 'All Files'`.
  - In cases where a parent hasn't been synced to the local DB (e.g., deep linking), the recursive query safely stops, returning the partial path gracefully.

### Frontend (Web)
- **Hooks (`packages/web/src/hooks/useMergedDrive.ts`)**:
  - Update the hook's state to extract and return the `breadcrumb` array provided by the backend API.
- **Components (`packages/web/src/components/Breadcrumb.tsx`)**:
  - Update CSS to enable horizontal scrolling: `flex-wrap: nowrap`, `white-space: nowrap`, and `overflow-x: auto`.
  - Hide scrollbars using webkit/ms specific rules for a clean aesthetic.
  - Ensure links pass the `driveId` parameter appropriately so that navigating back to a Google Drive folder works correctly.
- **Pages (`packages/web/src/pages/FilesPage.tsx`)**:
  - Remove the static "Back" button and `<h2...>{isRoot ? 'All Files' : 'Folder'}</h2>`.
  - Insert `<Breadcrumb items={breadcrumb} />` in the toolbar area.

## Error Handling & Edge Cases
- **Incomplete Path (Deep Links)**: If a user navigates to a folder where intermediate ancestors aren't in the database, the breadcrumb will show what is available, ending at the highest known ancestor. This prevents errors while still offering partial navigation.
- **Very Long Paths**: Addressed via the CSS update in `Breadcrumb.tsx` ensuring a scrollable, single-line horizontal path.

## Testing Strategy
- Unit/Manual testing of `WITH RECURSIVE` SQL query for deep folders.
- Verify horizontal scrolling works on narrow screens without breaking layout.
- Verify clicking a breadcrumb item accurately navigates back to the target folder while retaining the correct `driveId`.
