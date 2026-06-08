# Search Integration Design Spec

## 1. Overview
This spec details the implementation of the Search feature in the Omnidrive UI, connecting the mocked header search bar to the existing backend search API.

## 2. Architecture & Routing
- **Header Component**: The existing input field in `Header.tsx` will be wired up to React state. An `onKeyDown` handler will listen for the "Enter" key. Upon pressing "Enter", the app will navigate to `/search?q=<query>`.
- **Router**: `App.tsx` will be updated to include a new protected route: `<Route path="/search" element={<SearchPage />} />`.

## 3. Components & Data Flow
- **SearchPage Component (`packages/web/src/pages/SearchPage.tsx`)**:
  - Uses `useSearchParams` from `react-router-dom` to extract the `q` query parameter.
  - On mount and whenever the `q` parameter changes, it fetches search results via `api.searchFiles(query)`.
  - The results are displayed using the existing `FileGrid` component (`packages/web/src/components/files/FileGrid.tsx`), ensuring full compatibility with existing file actions (preview, move, share).
  - The `getDriveInfo` mapping (used by `FileGrid` to determine drive colors/icons) will be implemented similarly to `DashboardPage`.

## 4. Error Handling & Loading States
- **Loading State**: Displays a loading spinner while the API request is in progress.
- **Empty State**: If the API returns an empty array, a friendly message will be displayed: *"No files found matching '<query>'."*
- **Error State**: Any API errors will be caught and displayed via the existing `useToastStore` to notify the user.
