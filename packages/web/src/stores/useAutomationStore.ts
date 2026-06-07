import { create } from 'zustand';
import { api } from '../lib/api';

interface Rule {
  id: string;
  name: string;
  triggerType: string;
  isActive: boolean;
}

interface AutomationStore {
  rules: Rule[];
  isLoading: boolean;
  error: string | null;
  fetchRules: () => Promise<void>;
  toggleRule: (id: string, isActive: boolean) => Promise<void>;
}

export const useAutomationStore = create<AutomationStore>((set) => ({
  rules: [],
  isLoading: false,
  error: null,
  fetchRules: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.getAutomations();
      set({ rules: data.rules as Rule[], isLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch automations:', error);
      set({ error: error.message || 'Failed to fetch rules', isLoading: false });
    }
  },
  toggleRule: async (id, isActive) => {
    // Optimistic update
    set((state) => ({
      rules: state.rules.map(r => r.id === id ? { ...r, isActive } : r)
    }));
    try {
      await api.toggleAutomation(id, isActive);
    } catch (error: any) {
      console.error('Failed to toggle automation:', error);
      // Revert optimistic update
      set((state) => ({
        rules: state.rules.map(r => r.id === id ? { ...r, isActive: !isActive } : r),
        error: error.message || 'Failed to update rule'
      }));
    }
  }
}));
