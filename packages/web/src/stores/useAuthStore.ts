import { create } from 'zustand';
import type { SessionData } from '../types';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/queryClient';

interface AuthState {
  user: SessionData | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  authError: null,

  fetchUser: async () => {
    try {
      const { user } = await api.getUser();
      set({ user, isAuthenticated: true, isLoading: false, authError: null });
    } catch (err) {
      // 401 = session expired → legitimate logout.
      // Other errors (network, 500) = transient → don't logout, show retry.
      if (err instanceof ApiError && err.status === 401) {
        set({ user: null, isAuthenticated: false, isLoading: false, authError: null });
      } else {
        set({ isLoading: false, authError: 'Connection lost' });
      }
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      // Drop all cached queries so a subsequent login as a different user
      // never renders the previous user's data (files, shared links, workspaces).
      queryClient.clear();
      set({ user: null, isAuthenticated: false, authError: null });
    }
  },
}));
