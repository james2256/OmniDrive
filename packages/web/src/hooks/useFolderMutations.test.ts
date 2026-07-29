// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useStarFolder,
  useUnstarFolder,
  useDeleteDriveFolder,
  useRestoreDriveFolder,
  usePermanentDeleteDriveFolder,
  useRenameDriveFolder,
} from './useFolderMutations';
import { drivesApi } from '../lib/api/drives';
import { foldersApi } from '../lib/api/folders';
import { useToastStore } from '../stores/useToastStore';
import { invalidateAfterFileMutation } from '../lib/invalidate';

// Hoisted state shared with vi.mock factories.
const captured = vi.hoisted(() => ({
  // Ordered list of every useMutation call so each hook's captured
  // mutationFn / onSuccess / onError is individually addressable.
  mutations: [] as Array<{ mutate: ReturnType<typeof vi.fn>; options: any }>,
}));

vi.mock('@tanstack/react-query', () => ({
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../lib/api/drives', () => ({
  drivesApi: {
    starDriveFolder: vi.fn(),
    unstarDriveFolder: vi.fn(),
    deleteDriveFolder: vi.fn(),
    restoreDriveFolder: vi.fn(),
    deleteDriveFolderPermanent: vi.fn(),
    renameDriveFolder: vi.fn(),
  },
}));

vi.mock('../lib/api/folders', () => ({
  foldersApi: {
    starFolder: vi.fn(),
    unstarFolder: vi.fn(),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

vi.mock('../lib/invalidate', () => ({
  invalidateAfterFileMutation: vi.fn(),
}));

describe('useFolderMutations', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    captured.mutations.length = 0;
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
    // Default API methods to resolve — individual tests override.
    for (const m of Object.keys(drivesApi) as Array<keyof typeof drivesApi>) {
      (drivesApi[m] as Mock).mockResolvedValue(undefined);
    }
    for (const m of Object.keys(foldersApi) as Array<keyof typeof foldersApi>) {
      (foldersApi[m] as Mock).mockResolvedValue(undefined);
    }
  });

  describe('useStarFolder', () => {
    it('calls drivesApi.starDriveFolder when driveId is provided', async () => {
      const { result } = renderHook(() => useStarFolder());
      result.current.mutate({ id: 'fold-1', driveId: 'd1' });

      await waitFor(() => {
        expect(drivesApi.starDriveFolder).toHaveBeenCalledWith('d1', 'fold-1');
        expect(foldersApi.starFolder).not.toHaveBeenCalled();
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder starred');
      });
    });

    it('falls back to foldersApi.starFolder when driveId is absent', async () => {
      const { result } = renderHook(() => useStarFolder());
      result.current.mutate({ id: 'fold-1' });

      await waitFor(() => {
        expect(foldersApi.starFolder).toHaveBeenCalledWith('fold-1');
        expect(drivesApi.starDriveFolder).not.toHaveBeenCalled();
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder starred');
      });
    });

    it('toasts error on API failure', async () => {
      (drivesApi.starDriveFolder as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useStarFolder());
      result.current.mutate({ id: 'fold-1', driveId: 'd1' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to star folder');
      });
      expect(invalidateAfterFileMutation).not.toHaveBeenCalled();
    });
  });

  describe('useUnstarFolder', () => {
    it('calls drivesApi.unstarDriveFolder when driveId is provided', async () => {
      const { result } = renderHook(() => useUnstarFolder());
      result.current.mutate({ id: 'fold-1', driveId: 'd1' });

      await waitFor(() => {
        expect(drivesApi.unstarDriveFolder).toHaveBeenCalledWith('d1', 'fold-1');
        expect(foldersApi.unstarFolder).not.toHaveBeenCalled();
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder unstarred');
      });
    });

    it('falls back to foldersApi.unstarFolder when driveId is absent', async () => {
      const { result } = renderHook(() => useUnstarFolder());
      result.current.mutate({ id: 'fold-1' });

      await waitFor(() => {
        expect(foldersApi.unstarFolder).toHaveBeenCalledWith('fold-1');
        expect(drivesApi.unstarDriveFolder).not.toHaveBeenCalled();
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder unstarred');
      });
    });

    it('toasts error on API failure', async () => {
      (foldersApi.unstarFolder as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useUnstarFolder());
      result.current.mutate({ id: 'fold-1' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to unstar folder');
      });
    });
  });

  describe('useDeleteDriveFolder', () => {
    it('calls drivesApi.deleteDriveFolder, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useDeleteDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1' });

      await waitFor(() => {
        expect(drivesApi.deleteDriveFolder).toHaveBeenCalledWith('d1', 'fold-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder deleted');
      });
    });

    it('toasts error on API failure', async () => {
      (drivesApi.deleteDriveFolder as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useDeleteDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete folder');
      });
      expect(invalidateAfterFileMutation).not.toHaveBeenCalled();
    });
  });

  describe('useRestoreDriveFolder', () => {
    it('calls drivesApi.restoreDriveFolder, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useRestoreDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1' });

      await waitFor(() => {
        expect(drivesApi.restoreDriveFolder).toHaveBeenCalledWith('d1', 'fold-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder restored');
      });
    });

    it('toasts error on API failure', async () => {
      (drivesApi.restoreDriveFolder as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useRestoreDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to restore folder');
      });
    });
  });

  describe('usePermanentDeleteDriveFolder', () => {
    it('calls drivesApi.deleteDriveFolderPermanent, invalidates, toasts success', async () => {
      const { result } = renderHook(() => usePermanentDeleteDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1' });

      await waitFor(() => {
        expect(drivesApi.deleteDriveFolderPermanent).toHaveBeenCalledWith('d1', 'fold-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder permanently deleted');
      });
    });

    it('toasts error on API failure', async () => {
      (drivesApi.deleteDriveFolderPermanent as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => usePermanentDeleteDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete folder');
      });
    });
  });

  describe('useRenameDriveFolder', () => {
    it('calls drivesApi.renameDriveFolder with driveId + folderId + name', async () => {
      const { result } = renderHook(() => useRenameDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1', name: 'New Name' });

      await waitFor(() => {
        expect(drivesApi.renameDriveFolder).toHaveBeenCalledWith('d1', 'fold-1', 'New Name');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'Folder renamed');
      });
    });

    it('toasts error on API failure', async () => {
      (drivesApi.renameDriveFolder as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useRenameDriveFolder());
      result.current.mutate({ driveId: 'd1', folderId: 'fold-1', name: 'New Name' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to rename folder');
      });
    });
  });
});
