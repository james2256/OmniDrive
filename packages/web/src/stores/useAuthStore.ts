import { create } from 'zustand';
import type { SessionData } from '../types';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';

interface AuthState {
  user: SessionData | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  fetchUser: async () => {
    try {
      const { user } = await api.getUser();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      // Drop all cached queries so a subsequent login as a different user
      // never renders the previous user's data (files, shared links, workspaces).
      queryClient.clear();
      set({ user: null, isAuthenticated: false });
    }
  },
}));
