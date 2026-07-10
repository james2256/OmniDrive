import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './useUIStore';

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      isSidebarOpen: true,
      isInfoPanelOpen: false,
      viewMode: 'list',
      theme: 'light',
      sortField: 'name',
      sortDirection: 'asc',
    });
  });

  it('toggles sidebar', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(false);
  });

  it('toggles info panel', () => {
    useUIStore.getState().toggleInfoPanel();
    expect(useUIStore.getState().isInfoPanelOpen).toBe(true);
  });

  it('sets view mode', () => {
    useUIStore.getState().setViewMode('grid');
    expect(useUIStore.getState().viewMode).toBe('grid');
  });

  it('sets theme', () => {
    useUIStore.getState().setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
  });

  it('toggles sort direction on same field', () => {
    useUIStore.getState().toggleSort('name');
    expect(useUIStore.getState().sortDirection).toBe('desc');
    useUIStore.getState().toggleSort('name');
    expect(useUIStore.getState().sortDirection).toBe('asc');
  });

  it('switches sort field with sensible default direction', () => {
    useUIStore.getState().toggleSort('modified');
    expect(useUIStore.getState().sortField).toBe('modified');
    expect(useUIStore.getState().sortDirection).toBe('desc');
  });
});
