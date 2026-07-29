import { create } from 'zustand';
import type { SessionData } from '../types';
import { ApiError } from '../lib/api/core';
import { authApi } from '../lib/api/auth';
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
      const { user } = await authApi.getUser();
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
      await authApi.logout();
    } catch {
      // Best-effort: the finally block clears local state regardless.
      // A failed logout API call doesn't affect the user's local logout
      // — the session cookie expires on its own once the Worker restarts.
    } finally {
      // Drop all cached queries so a subsequent login as a different user
      // never renders the previous user's data (files, shared links, workspaces).
      queryClient.clear();
      set({ user: null, isAuthenticated: false, authError: null });
    }
  },
}));
