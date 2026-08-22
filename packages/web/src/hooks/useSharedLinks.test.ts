// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import {
  useSharedLinks,
  useIsTargetShared,
  useInvalidateSharedLinks,
  useRevokeSharedLink,
  useIsTargetSharedCallback,
} from './useSharedLinks';
import { sharedApi } from '../lib/api/shared';
import { useToastStore } from '../stores/useToastStore';
import type { SharedLink } from '../types';

// Hoisted invalidateQueries — the same instance is returned by every
// useQueryClient() call so assertions can target one stable mock.
const invalidateQueries = vi.hoisted(() => vi.fn());
// Hoisted mutation capture — used to drive onSuccess/onError manually.
const captured = vi.hoisted(() => ({
  mutations: [] as Array<{ mutate: ReturnType<typeof vi.fn>; options: any }>,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn((options: any) => {
    const mutate = vi.fn((vars: any) => {
      Promise.resolve(options.mutationFn(vars))
        .then((r: any) => options.onSuccess?.(r, vars, undefined))
        .catch((e: any) => options.onError?.(e, vars, undefined));
    });
    captured.mutations.push({ mutate, options });
    return {
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    };
  }),
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('../lib/api/shared', () => ({
  sharedApi: {
    getSharedLinks: vi.fn(),
    deleteSharedLink: vi.fn(),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

vi.mock('../lib/queryKeys', () => ({
  qk: { sharedLinks: ['sharedLinks'] },
}));

const mockLink = (overrides: Partial<SharedLink>): SharedLink => ({
  id: 'link-1',
  userId: 'u1',
  targetType: 'file',
  targetId: 'file-1',
  expiresAt: null,
  viewCount: 0,
  downloadCount: 0,
  createdAt: '2024-01-01',
  allowDownloads: true,
  maxDownloads: null,
  webhookUrl: null,
  ...overrides,
});

describe('useSharedLinks', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    captured.mutations.length = 0;
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
    (sharedApi.deleteSharedLink as Mock).mockResolvedValue(undefined);
  });

  describe('useSharedLinks (query)', () => {
    it('returns loading state', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
      });

      const { result } = renderHook(() => useSharedLinks());

      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isError).toBe(false);
    });

    it('returns success state with shared links', () => {
      const links = [mockLink({}), mockLink({ id: 'link-2', targetId: 'file-2' })];
      (useQuery as Mock).mockReturnValue({
        data: links,
        isLoading: false,
        isError: false,
        error: null,
      });

      const { result } = renderHook(() => useSharedLinks());

      expect(result.current.data).toEqual(links);
      expect(result.current.isLoading).toBe(false);
    });

    it('returns error state', () => {
      const err = new Error('boom');
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: err,
      });

      const { result } = renderHook(() => useSharedLinks());

      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBe(err);
    });

    it('configures useQuery with the sharedLinks query key', () => {
      (useQuery as Mock).mockReturnValue({ data: [], isLoading: false });

      renderHook(() => useSharedLinks());

      expect(useQuery).toHaveBeenCalledTimes(1);
      const arg = (useQuery as Mock).mock.calls[0][0];
      expect(arg.queryKey).toEqual(['sharedLinks']);
      expect(typeof arg.queryFn).toBe('function');
    });

    it('queryFn unwraps the `links` field from sharedApi.getSharedLinks', async () => {
      (useQuery as Mock).mockReturnValue({ data: [], isLoading: false });
      const links = [mockLink({})];
      (sharedApi.getSharedLinks as Mock).mockResolvedValue({ links });

      renderHook(() => useSharedLinks());

      const arg = (useQuery as Mock).mock.calls[0][0];
      const result = await arg.queryFn();
      expect(sharedApi.getSharedLinks).toHaveBeenCalledTimes(1);
      expect(result).toEqual(links);
    });
  });

  describe('useRevokeSharedLink (mutation)', () => {
    it('calls sharedApi.deleteSharedLink, invalidates shared links, toasts success', async () => {
      const { result } = renderHook(() => useRevokeSharedLink());
      result.current.mutate('link-1');

      await waitFor(() => {
        expect(sharedApi.deleteSharedLink).toHaveBeenCalledWith('link-1');
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sharedLinks'] });
        expect(addToast).toHaveBeenCalledWith('success', 'Link revoked successfully');
      });
    });

    it('toasts error on API failure', async () => {
      (sharedApi.deleteSharedLink as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useRevokeSharedLink());
      result.current.mutate('link-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to revoke link');
      });
      // Invalidate should not fire on error.
      expect(invalidateQueries).not.toHaveBeenCalled();
    });
  });

  describe('useIsTargetSharedCallback', () => {
    it('returns a function', () => {
      const { result } = renderHook(() => useIsTargetSharedCallback([]));
      expect(typeof result.current).toBe('function');
    });

    it('returns true when a matching file link exists', () => {
      const links = [mockLink({ targetType: 'file', targetId: 'f-1' })];
      const { result } = renderHook(() => useIsTargetSharedCallback(links));
      expect(result.current('f-1', 'file')).toBe(true);
    });

    it('returns false when no link matches the target id', () => {
      const links = [mockLink({ targetType: 'file', targetId: 'f-1' })];
      const { result } = renderHook(() => useIsTargetSharedCallback(links));
      expect(result.current('f-other', 'file')).toBe(false);
    });

    it('returns false when target type does not match', () => {
      const links = [mockLink({ targetType: 'file', targetId: 'x-1' })];
      const { result } = renderHook(() => useIsTargetSharedCallback(links));
      expect(result.current('x-1', 'folder')).toBe(false);
    });

    it('matches folder links', () => {
      const links = [mockLink({ targetType: 'folder', targetId: 'fold-1' })];
      const { result } = renderHook(() => useIsTargetSharedCallback(links));
      expect(result.current('fold-1', 'folder')).toBe(true);
      expect(result.current('fold-1', 'file')).toBe(false);
    });

    it('returns false for an empty links array', () => {
      const { result } = renderHook(() => useIsTargetSharedCallback([]));
      expect(result.current('anything', 'file')).toBe(false);
    });

    it('memoizes the callback for the same sharedLinks reference', () => {
      const links = [mockLink({})];
      const { result, rerender } = renderHook(() => useIsTargetSharedCallback(links));
      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });

    it('returns a new callback when the sharedLinks reference changes', () => {
      const links1 = [mockLink({})];
      const links2 = [mockLink({})];
      const { result, rerender } = renderHook(({ links }) => useIsTargetSharedCallback(links), {
        initialProps: { links: links1 },
      });
      const first = result.current;
      rerender({ links: links2 });
      expect(result.current).not.toBe(first);
    });
  });

  describe('useIsTargetShared', () => {
    it('returns false when targetId is undefined', () => {
      (useQuery as Mock).mockReturnValue({ data: [mockLink({ targetId: 'f-1' })] });

      const { result } = renderHook(() => useIsTargetShared(undefined, 'file'));

      expect(result.current).toBe(false);
    });

    it('returns true when the cached links contain a matching entry', () => {
      const links = [mockLink({ targetType: 'file', targetId: 'f-1' })];
      (useQuery as Mock).mockReturnValue({ data: links });

      const { result } = renderHook(() => useIsTargetShared('f-1', 'file'));

      expect(result.current).toBe(true);
    });

    it('returns false when no entry matches', () => {
      const links = [mockLink({ targetType: 'folder', targetId: 'fold-1' })];
      (useQuery as Mock).mockReturnValue({ data: links });

      const { result } = renderHook(() => useIsTargetShared('f-1', 'file'));

      expect(result.current).toBe(false);
    });

    it('defaults to empty array when query data is undefined', () => {
      (useQuery as Mock).mockReturnValue({ data: undefined });

      const { result } = renderHook(() => useIsTargetShared('f-1', 'file'));

      expect(result.current).toBe(false);
    });
  });

  describe('useInvalidateSharedLinks', () => {
    it('returns a function that invalidates the sharedLinks query', () => {
      const { result } = renderHook(() => useInvalidateSharedLinks());
      expect(typeof result.current).toBe('function');

      act(() => {
        result.current();
      });

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sharedLinks'] });
    });
  });
});
