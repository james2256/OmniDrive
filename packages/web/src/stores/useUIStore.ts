import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortDirection, SortField } from '../lib/sort-items';

type ViewMode = 'list' | 'grid';
type Theme = 'light' | 'dark';

interface UIState {
  isSidebarOpen: boolean;
  isInfoPanelOpen: boolean;
  mobileSidebarOpen: boolean; // mobile drawer (<md) — separate from desktop collapse
  viewMode: ViewMode;
  theme: Theme;
  sortField: SortField;
  sortDirection: SortDirection;
  toggleSidebar: () => void;
  toggleInfoPanel: () => void;
  setIsInfoPanelOpen: (isOpen: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTheme: (theme: Theme) => void;
  toggleSort: (field: SortField) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isSidebarOpen: true,
      isInfoPanelOpen: false,
      mobileSidebarOpen: false,
      viewMode: 'list',
      theme: 'light',
      sortField: 'name',
      sortDirection: 'asc',
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      toggleInfoPanel: () => set((state) => ({ isInfoPanelOpen: !state.isInfoPanelOpen })),
      setIsInfoPanelOpen: (isOpen) => set({ isInfoPanelOpen: isOpen }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
      setViewMode: (mode) => set({ viewMode: mode }),
      setTheme: (theme) => set({ theme }),
      toggleSort: (field) =>
        set((state) =>
          state.sortField === field
            ? { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' }
            : { sortField: field, sortDirection: field === 'name' ? 'asc' : 'desc' },
        ),
    }),
    {
      name: 'omnidrive-ui',
      // Persist only durable user preferences, not transient UI state (sidebar/panel
      // open states reset on reload — correct, because a mobile user reopening the
      // app shouldn't have the drawer stuck open from a previous session).
      partialize: (state) => ({
        viewMode: state.viewMode,
        theme: state.theme,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
      }),
    },
  ),
);
