// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useDrives, useGetDriveInfo, useRemoveDrive } from './useDrives';
import { drivesApi } from '../lib/api/drives';
import { useToastStore } from '../stores/useToastStore';
import type { DriveAccount } from '../types';

// Hoisted invalidateQueries mock — every useQueryClient() returns the same
// instance so per-test assertions can verify call count + args.
const invalidateQueries = vi.hoisted(() => vi.fn());

// Hoisted capture of every useMutation invocation so each hook's
// onSuccess/onError is individually addressable.
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

vi.mock('../lib/api/drives', () => ({
  drivesApi: {
    getDrives: vi.fn(),
    disconnectDrive: vi.fn(),
    triggerSync: vi.fn(),
  },
}));

vi.mock('../lib/queryKeys', () => ({
  qk: { drives: ['drives'] },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

const makeDrive = (id: string, email = `${id}@x.com`): DriveAccount =>
  ({
    id,
    userId: 'u1',
    googleAccountId: 'g-' + id,
    email,
    name: null,
    type: 'oauth',
    isPrimary: false,
    rootFolderId: null,
    totalQuota: 100,
    usedQuota: 0,
    quotaOverride: null,
    freeSpace: 100,
    usagePercent: 0,
    quotaUpdatedAt: null,
    createdAt: '2024-01-01',
  }) as DriveAccount;

describe('useDrives', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    captured.mutations.length = 0;
    // useRemoveDrive calls `useToastStore((s) => s.addToast)` — i.e. with a
    // selector. The mock must invoke the selector and return the picked
    // value (the function itself) so `addToast('success', '...')` works.
    (useToastStore as unknown as Mock).mockImplementation(
      (selector?: (s: { addToast: typeof addToast }) => typeof addToast) =>
        selector ? selector({ addToast }) : { addToast },
    );
    (drivesApi.getDrives as Mock).mockResolvedValue({ drives: [], aggregate: {} });
    (drivesApi.disconnectDrive as Mock).mockResolvedValue(undefined);
  });

  describe('useDrives (query)', () => {
    it('returns loading state', () => {
      (useQuery as unknown as Mock).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
      });

      const { result } = renderHook(() => useDrives());

      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('returns success state with drives', () => {
      const payload = {
        drives: [makeDrive('d1')],
        aggregate: { totalQuota: 100, totalUsed: 0, totalFree: 100, driveCount: 1 },
      };
      (useQuery as unknown as Mock).mockReturnValue({
        data: payload,
        isLoading: false,
        isError: false,
        error: null,
      });

      const { result } = renderHook(() => useDrives());

      expect(result.current.data).toEqual(payload);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isError).toBe(false);
    });

    it('returns error state', () => {
      const err = new Error('boom');
      (useQuery as unknown as Mock).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: err,
      });

      const { result } = renderHook(() => useDrives());

      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBe(err);
    });

    it('configures useQuery with the qk.drives query key', () => {
      (useQuery as unknown as Mock).mockReturnValue({ data: undefined, isLoading: false });

      renderHook(() => useDrives());

      expect(useQuery).toHaveBeenCalledTimes(1);
      const arg = (useQuery as unknown as Mock).mock.calls[0][0];
      expect(arg.queryKey).toEqual(['drives']);
      expect(typeof arg.queryFn).toBe('function');
    });

    it('queryFn calls drivesApi.getDrives', async () => {
      const data = { drives: [makeDrive('d1')], aggregate: {} };
      (useQuery as unknown as Mock).mockReturnValue({ data: undefined, isLoading: false });
      (drivesApi.getDrives as Mock).mockResolvedValue(data);

      renderHook(() => useDrives());

      const arg = (useQuery as unknown as Mock).mock.calls[0][0];
      const result = await arg.queryFn();
      expect(drivesApi.getDrives).toHaveBeenCalledTimes(1);
      expect(result).toEqual(data);
    });
  });

  describe('useGetDriveInfo', () => {
    it('returns a callback function', () => {
      const { result } = renderHook(() => useGetDriveInfo([]));
      expect(typeof result.current).toBe('function');
    });

    it('returns the matching drive and its index', () => {
      const drives = [makeDrive('d1'), makeDrive('d2')];
      const { result } = renderHook(() => useGetDriveInfo(drives));

      expect(result.current('d2')).toEqual({ drive: drives[1], index: 1 });
    });

    it('returns { drive: null, index: -1 } for an unknown ID', () => {
      const drives = [makeDrive('d1')];
      const { result } = renderHook(() => useGetDriveInfo(drives));

      expect(result.current('nonexistent')).toEqual({ drive: null, index: -1 });
    });

    it('returns { drive: null, index: -1 } for undefined driveAccountId', () => {
      const drives = [makeDrive('d1')];
      const { result } = renderHook(() => useGetDriveInfo(drives));

      expect(result.current(undefined)).toEqual({ drive: null, index: -1 });
    });

    it('memoizes the callback for the same drives reference', () => {
      const drives = [makeDrive('d1')];
      const { result, rerender } = renderHook(() => useGetDriveInfo(drives));

      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });

    it('returns a new callback when the drives reference changes', () => {
      const drives1 = [makeDrive('d1')];
      const drives2 = [makeDrive('d2')];
      const { result, rerender } = renderHook(({ d }) => useGetDriveInfo(d), {
        initialProps: { d: drives1 },
      });

      const first = result.current;
      rerender({ d: drives2 });
      expect(result.current).not.toBe(first);
    });
  });

  describe('useRemoveDrive', () => {
    it('calls drivesApi.disconnectDrive, invalidates drives, toasts success', async () => {
      const { result } = renderHook(() => useRemoveDrive());
      result.current.mutate('drive-1');

      await waitFor(() => {
        expect(drivesApi.disconnectDrive).toHaveBeenCalledWith('drive-1');
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['drives'] });
        expect(addToast).toHaveBeenCalledWith('success', 'Drive disconnected');
      });
    });

    it('toasts error and does NOT invalidate on API failure', async () => {
      (drivesApi.disconnectDrive as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useRemoveDrive());
      result.current.mutate('drive-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to disconnect drive');
      });
      expect(invalidateQueries).not.toHaveBeenCalled();
    });
  });
});
