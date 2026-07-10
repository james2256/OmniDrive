import { create } from 'zustand';
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

export const useUIStore = create<UIState>((set) => ({
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
        : { sortField: field, sortDirection: field === 'name' ? 'asc' : 'desc' }
    ),
}));
