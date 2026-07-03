import { create } from 'zustand';
import type { SortDirection, SortField } from '../lib/sort-items';

type ViewMode = 'list' | 'grid';
type Theme = 'light' | 'dark';

interface UIState {
  isSidebarOpen: boolean;
  isInfoPanelOpen: boolean;
  viewMode: ViewMode;
  theme: Theme;
  sortField: SortField;
  sortDirection: SortDirection;
  toggleSidebar: () => void;
  toggleInfoPanel: () => void;
  setIsInfoPanelOpen: (isOpen: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setTheme: (theme: Theme) => void;
  toggleSort: (field: SortField) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  isInfoPanelOpen: false,
  viewMode: 'list',
  theme: 'light',
  sortField: 'name',
  sortDirection: 'asc',
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleInfoPanel: () => set((state) => ({ isInfoPanelOpen: !state.isInfoPanelOpen })),
  setIsInfoPanelOpen: (isOpen) => set({ isInfoPanelOpen: isOpen }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setTheme: (theme) => set({ theme }),
  toggleSort: (field) =>
    set((state) =>
      state.sortField === field
        ? { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' }
        : { sortField: field, sortDirection: field === 'name' ? 'asc' : 'desc' }
    ),
}));
