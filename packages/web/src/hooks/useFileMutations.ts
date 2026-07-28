import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../lib/api';
import { useToastStore } from '../stores/useToastStore';
import { invalidateAfterFileMutation } from '../lib/invalidate';
import { useStarFolder, useUnstarFolder } from './useFolderMutations';

export function useStarFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.starFile(fileId),
    onSuccess: () => {
      addToast('success', 'File starred');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to star file'),
  });
}

export function useUnstarFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.unstarFile(fileId),
    onSuccess: () => {
      addToast('success', 'File unstarred');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to unstar file'),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.deleteFile(fileId),
    onSuccess: () => {
      addToast('success', 'File deleted');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to delete file'),
  });
}

export function useRestoreFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.restoreFile(fileId),
    onSuccess: () => {
      addToast('success', 'File restored');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to restore file'),
  });
}

export function usePermanentDeleteFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.deleteFilePermanent(fileId),
    onSuccess: () => {
      addToast('success', 'File permanently deleted');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to delete file'),
  });
}

export function useRenameFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ fileId, name }: { fileId: string; name: string }) =>
      api.renameFile(fileId, name),
    onSuccess: () => {
      addToast('success', 'File renamed');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to rename file'),
  });
}

export function useMoveFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({
      fileId,
      workspaceFolderId,
    }: {
      fileId: string;
      workspaceFolderId?: string | null;
    }) => api.moveFile(fileId, workspaceFolderId),
    onSuccess: () => {
      addToast('success', 'File moved');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to move file'),
  });
}

export function useMoveFileToDrive() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ fileId, targetDriveId }: { fileId: string; targetDriveId: string }) =>
      api.moveFileToDrive(fileId, targetDriveId),
    onSuccess: () => {
      addToast('success', 'File moved to another drive');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to move file'),
  });
}

/**
 * Unified star-toggle for files AND folders (workspace + Google Drive).
 * 4-arg signature: driveId selects the Google-Drive-folder endpoint when
 * present; absent driveId falls back to the workspace-folder endpoint.
 * Fixes Bug 1 (Dashboard dropped driveId) and M-10 (ExternalPage missing
 * the workspace-folder else-branch) by giving every page the same logic.
 */
export function useToggleStar() {
  const starFile = useStarFile();
  const unstarFile = useUnstarFile();
  const starFolder = useStarFolder();
  const unstarFolder = useUnstarFolder();

  return useCallback(
    (id: string, type: 'file' | 'folder', currentStarStatus: boolean, driveId?: string) => {
      if (type === 'file') {
        if (currentStarStatus) {
          unstarFile.mutate(id);
        } else {
          starFile.mutate(id);
        }
      } else {
        if (currentStarStatus) {
          unstarFolder.mutate({ id, driveId });
        } else {
          starFolder.mutate({ id, driveId });
        }
      }
    },
    [starFile, unstarFile, starFolder, unstarFolder],
  );
}
