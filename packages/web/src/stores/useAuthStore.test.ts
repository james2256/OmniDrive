import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useAuthStore } from './useAuthStore';
import { authApi } from '../lib/api/auth';
import { queryClient } from '../lib/queryClient';
import { ApiError } from '../lib/api/core';
import type { SessionData } from '../types';

// Mock authApi — only the methods useAuthStore actually calls.
vi.mock('../lib/api/auth', () => ({
  authApi: {
    getUser: vi.fn(),
    logout: vi.fn(),
  },
}));

// Mock the shared TanStack Query client so queryClient.clear() is observable.
vi.mock('../lib/queryClient', () => ({
  queryClient: {
    clear: vi.fn(),
  },
}));

// NOTE: ../lib/api/core is intentionally NOT mocked — we need the real ApiError
// class so `instanceof ApiError` checks inside fetchUser behave identically to
// production.

const mockUser: SessionData = {
  userId: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  name: 'Alice',
  avatarUrl: null,
  role: 'super_admin',
  createdAt: 1700000000000,
};

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the store to its initial state before every test. setState merges,
    // so the action functions (fetchUser, logout) remain intact.
    useAuthStore.setState({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      authError: null,
    });
  });

  it('has the correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.authError).toBeNull();
    // Actions are defined on the store.
    expect(typeof state.fetchUser).toBe('function');
    expect(typeof state.logout).toBe('function');
  });

  it('fetchUser sets user, isAuthenticated=true, isLoading=false on success', async () => {
    (authApi.getUser as Mock).mockResolvedValue({ user: mockUser });

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.authError).toBeNull();
    expect(authApi.getUser).toHaveBeenCalledTimes(1);
  });

  it('fetchUser clears session (user=null, isAuthenticated=false) on 401 ApiError', async () => {
    // Seed an existing session to verify it gets wiped.
    useAuthStore.setState({ user: mockUser, isAuthenticated: true });
    (authApi.getUser as Mock).mockRejectedValue(new ApiError(401, 'Unauthorized'));

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.authError).toBeNull();
  });

  it('fetchUser sets authError="Connection lost" on non-401 ApiError without clearing user', async () => {
    // Existing session preserved — transient errors should NOT log the user out.
    useAuthStore.setState({ user: mockUser, isAuthenticated: true });
    (authApi.getUser as Mock).mockRejectedValue(new ApiError(500, 'Server error'));

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.authError).toBe('Connection lost');
    // User is preserved so the UI can retry without forcing a re-login.
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
  });

  it('fetchUser sets authError="Connection lost" on generic Error (e.g. network)', async () => {
    (authApi.getUser as Mock).mockRejectedValue(new Error('Network unreachable'));

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.authError).toBe('Connection lost');
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('isAuthenticated reflects user state across fetchUser transitions', async () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    (authApi.getUser as Mock).mockResolvedValue({ user: mockUser });
    await useAuthStore.getState().fetchUser();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    (authApi.getUser as Mock).mockRejectedValue(new ApiError(401, 'Unauthorized'));
    await useAuthStore.getState().fetchUser();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('logout clears user, isAuthenticated, and authError on success', async () => {
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      authError: 'pre-existing error',
    });
    (authApi.logout as Mock).mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.authError).toBeNull();
    expect(authApi.logout).toHaveBeenCalledTimes(1);
  });

  it('logout clears queryClient cache on success', async () => {
    (authApi.logout as Mock).mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it('logout still clears user and queryClient cache when the API call fails (catch swallows rejection)', async () => {
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
    });
    (authApi.logout as Mock).mockRejectedValue(new Error('Network error'));

    // The catch block swallows the rejection — logout is best-effort.
    // The finally block still runs and clears local state.
    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    // finally block ran regardless — user is logged out locally.
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.authError).toBeNull();
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });
});
