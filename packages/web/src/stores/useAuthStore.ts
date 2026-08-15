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
  clearAuth: () => void;
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

  /**
   * Clear local auth state WITHOUT calling the backend. Used by the global
   * 401 interceptor (core.ts) to avoid an infinite redirect loop: calling
   * `logout` would hit `/api/auth/logout` → 401 → interceptor → `logout` → ...
   *
   * Matches `logout`'s finally block: clears query cache + auth state.
   * Does NOT set `isLoading` (the interceptor is a mid-session event, not
   * a boot event — loading state should stay as-is).
   */
  clearAuth: () => {
    queryClient.clear();
    set({ user: null, isAuthenticated: false, authError: null });
  },
}));
