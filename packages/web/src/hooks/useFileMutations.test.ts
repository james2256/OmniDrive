// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useStarFile,
  useUnstarFile,
  useDeleteFile,
  useRestoreFile,
  usePermanentDeleteFile,
  useRenameFile,
  useMoveFile,
  useMoveFileToDrive,
  useToggleStar,
} from './useFileMutations';
import { filesApi } from '../lib/api/files';
import { useToastStore } from '../stores/useToastStore';
import { invalidateAfterFileMutation } from '../lib/invalidate';

// Hoisted state shared with the vi.mock factories (factories run before
// the test-file body, so any variable they close over must be hoisted).
const captured = vi.hoisted(() => ({
  // Tracks every useMutation call in order so each hook's mutate fn is
  // individually assertable.
  mutations: [] as Array<{ mutate: ReturnType<typeof vi.fn>; options: any }>,
  // Mock mutate fns returned by the mocked useStarFolder / useUnstarFolder
  // (so useToggleStar's folder branch can be asserted without exercising
  // the real useFolderMutations implementation).
  starFolderMutate: vi.fn(),
  unstarFolderMutate: vi.fn(),
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

vi.mock('../lib/api/files', () => ({
  filesApi: {
    starFile: vi.fn(),
    unstarFile: vi.fn(),
    deleteFile: vi.fn(),
    restoreFile: vi.fn(),
    deleteFilePermanent: vi.fn(),
    renameFile: vi.fn(),
    moveFile: vi.fn(),
    moveFileToDrive: vi.fn(),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

vi.mock('../lib/invalidate', () => ({
  invalidateAfterFileMutation: vi.fn(),
}));

vi.mock('./useFolderMutations', () => ({
  useStarFolder: vi.fn(() => ({
    mutate: captured.starFolderMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useUnstarFolder: vi.fn(() => ({
    mutate: captured.unstarFolderMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

describe('useFileMutations', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    captured.mutations.length = 0;
    captured.starFolderMutate = vi.fn();
    captured.unstarFolderMutate = vi.fn();
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
    // Default all filesApi methods to resolve — individual tests can override.
    for (const m of Object.keys(filesApi) as Array<keyof typeof filesApi>) {
      (filesApi[m] as Mock).mockResolvedValue(undefined);
    }
  });

  describe('useStarFile', () => {
    it('calls filesApi.starFile, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useStarFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(filesApi.starFile).toHaveBeenCalledWith('file-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File starred');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.starFile as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useStarFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to star file');
      });
      expect(invalidateAfterFileMutation).not.toHaveBeenCalled();
    });
  });

  describe('useUnstarFile', () => {
    it('calls filesApi.unstarFile, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useUnstarFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(filesApi.unstarFile).toHaveBeenCalledWith('file-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File unstarred');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.unstarFile as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useUnstarFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to unstar file');
      });
    });
  });

  describe('useDeleteFile', () => {
    it('calls filesApi.deleteFile, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useDeleteFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(filesApi.deleteFile).toHaveBeenCalledWith('file-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File deleted');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.deleteFile as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useDeleteFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete file');
      });
    });
  });

  describe('useRestoreFile', () => {
    it('calls filesApi.restoreFile, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useRestoreFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(filesApi.restoreFile).toHaveBeenCalledWith('file-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File restored');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.restoreFile as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useRestoreFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to restore file');
      });
    });
  });

  describe('usePermanentDeleteFile', () => {
    it('calls filesApi.deleteFilePermanent, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => usePermanentDeleteFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(filesApi.deleteFilePermanent).toHaveBeenCalledWith('file-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File permanently deleted');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.deleteFilePermanent as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => usePermanentDeleteFile());
      result.current.mutate('file-1');

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete file');
      });
    });
  });

  describe('useRenameFile', () => {
    it('calls filesApi.renameFile with fileId + name, invalidates, and toasts success', async () => {
      const { result } = renderHook(() => useRenameFile());
      result.current.mutate({ fileId: 'file-1', name: 'new-name.txt' });

      await waitFor(() => {
        expect(filesApi.renameFile).toHaveBeenCalledWith('file-1', 'new-name.txt');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File renamed');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.renameFile as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useRenameFile());
      result.current.mutate({ fileId: 'file-1', name: 'new-name.txt' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to rename file');
      });
    });
  });

  describe('useMoveFile', () => {
    it('calls filesApi.moveFile with fileId + workspaceFolderId, invalidates, toasts success', async () => {
      const { result } = renderHook(() => useMoveFile());
      result.current.mutate({ fileId: 'file-1', workspaceFolderId: 'wf-1' });

      await waitFor(() => {
        expect(filesApi.moveFile).toHaveBeenCalledWith('file-1', 'wf-1');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File moved');
      });
    });

    it('passes null workspaceFolderId through to the API', async () => {
      const { result } = renderHook(() => useMoveFile());
      result.current.mutate({ fileId: 'file-1', workspaceFolderId: null });

      await waitFor(() => {
        expect(filesApi.moveFile).toHaveBeenCalledWith('file-1', null);
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.moveFile as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useMoveFile());
      result.current.mutate({ fileId: 'file-1', workspaceFolderId: 'wf-1' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to move file');
      });
    });
  });

  describe('useMoveFileToDrive', () => {
    it('calls filesApi.moveFileToDrive with fileId + targetDriveId, invalidates, toasts', async () => {
      const { result } = renderHook(() => useMoveFileToDrive());
      result.current.mutate({ fileId: 'file-1', targetDriveId: 'd2' });

      await waitFor(() => {
        expect(filesApi.moveFileToDrive).toHaveBeenCalledWith('file-1', 'd2');
        expect(invalidateAfterFileMutation).toHaveBeenCalledTimes(1);
        expect(addToast).toHaveBeenCalledWith('success', 'File moved to another drive');
      });
    });

    it('toasts error on API failure', async () => {
      (filesApi.moveFileToDrive as Mock).mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useMoveFileToDrive());
      result.current.mutate({ fileId: 'file-1', targetDriveId: 'd2' });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('error', 'Failed to move file');
      });
    });
  });

  describe('useToggleStar', () => {
    it('calls starFile.mutate when type=file and not currently starred', () => {
      const { result } = renderHook(() => useToggleStar());
      // useStarFile is capturedMutations[0], useUnstarFile is [1].
      const starFileMutate = captured.mutations[0].mutate;
      const unstarFileMutate = captured.mutations[1].mutate;

      result.current('file-1', 'file', false);

      expect(starFileMutate).toHaveBeenCalledWith('file-1');
      expect(unstarFileMutate).not.toHaveBeenCalled();
    });

    it('calls unstarFile.mutate when type=file and currently starred', () => {
      const { result } = renderHook(() => useToggleStar());
      const starFileMutate = captured.mutations[0].mutate;
      const unstarFileMutate = captured.mutations[1].mutate;

      result.current('file-1', 'file', true);

      expect(unstarFileMutate).toHaveBeenCalledWith('file-1');
      expect(starFileMutate).not.toHaveBeenCalled();
    });

    it('calls starFolder.mutate when type=folder and not currently starred (no driveId)', () => {
      const { result } = renderHook(() => useToggleStar());

      result.current('fold-1', 'folder', false);

      expect(captured.starFolderMutate).toHaveBeenCalledWith({ id: 'fold-1', driveId: undefined });
      expect(captured.unstarFolderMutate).not.toHaveBeenCalled();
    });

    it('passes driveId through to starFolder when present', () => {
      const { result } = renderHook(() => useToggleStar());

      result.current('fold-1', 'folder', false, 'd1');

      expect(captured.starFolderMutate).toHaveBeenCalledWith({ id: 'fold-1', driveId: 'd1' });
    });

    it('calls unstarFolder.mutate when type=folder and currently starred', () => {
      const { result } = renderHook(() => useToggleStar());

      result.current('fold-1', 'folder', true, 'd1');

      expect(captured.unstarFolderMutate).toHaveBeenCalledWith({ id: 'fold-1', driveId: 'd1' });
      expect(captured.starFolderMutate).not.toHaveBeenCalled();
    });
  });
});
