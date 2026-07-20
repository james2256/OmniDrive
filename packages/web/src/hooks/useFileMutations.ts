import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToastStore } from '../stores/toastStore';
import { invalidateAfterFileMutation } from '../lib/invalidate';
import { useQueryClient } from '@tanstack/react-query';

export function useStarFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.starFile(fileId),
    onSuccess: () => { addToast('success', 'File starred'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to star file'),
  });
}

export function useUnstarFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.unstarFile(fileId),
    onSuccess: () => { addToast('success', 'File unstarred'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to unstar file'),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.deleteFile(fileId),
    onSuccess: () => { addToast('success', 'File deleted'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to delete file'),
  });
}

export function useRestoreFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.restoreFile(fileId),
    onSuccess: () => { addToast('success', 'File restored'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to restore file'),
  });
}

export function usePermanentDeleteFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (fileId: string) => api.deleteFilePermanent(fileId),
    onSuccess: () => { addToast('success', 'File permanently deleted'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to delete file'),
  });
}

export function useRenameFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ fileId, name }: { fileId: string; name: string }) => api.renameFile(fileId, name),
    onSuccess: () => { addToast('success', 'File renamed'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to rename file'),
  });
}

export function useMoveFile() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ fileId, workspaceFolderId }: { fileId: string; workspaceFolderId?: string | null }) =>
      api.moveFile(fileId, workspaceFolderId),
    onSuccess: () => { addToast('success', 'File moved'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to move file'),
  });
}

export function useMoveFileToDrive() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ fileId, targetDriveId }: { fileId: string; targetDriveId: string }) =>
      api.moveFileToDrive(fileId, targetDriveId),
    onSuccess: () => { addToast('success', 'File moved to another drive'); invalidateAfterFileMutation(qc); },
    onError: () => addToast('error', 'Failed to move file'),
  });
}
