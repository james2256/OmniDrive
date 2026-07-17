import { create } from 'zustand';
import { getSharedLinks } from '../lib/api';
import type { SharedLink } from '../lib/api';

interface SharedState {
  sharedLinks: SharedLink[];
  isLoading: boolean;
  fetchSharedLinks: () => Promise<void>;
  isTargetShared: (targetId: string, targetType: 'file' | 'folder') => boolean;
}

export const useSharedStore = create<SharedState>((set, get) => ({
  sharedLinks: [],
  isLoading: false,
  fetchSharedLinks: async () => {
    set({ isLoading: true });
    try {
      const { links } = await getSharedLinks();
      set({ sharedLinks: links, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
  isTargetShared: (targetId: string, targetType: 'file' | 'folder') => {
    return get().sharedLinks.some(link => link.targetId === targetId && link.targetType === targetType);
  }
}));
