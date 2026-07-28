import { useMutation, useQueryClient } from '@tanstack/react-query';
import { drivesApi } from '../lib/api/drives';
import { foldersApi } from '../lib/api/folders';
import { useToastStore } from '../stores/useToastStore';
import { invalidateAfterFileMutation } from '../lib/invalidate';

export function useStarFolder() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ id, driveId }: { id: string; driveId?: string }) =>
      driveId ? drivesApi.starDriveFolder(driveId, id) : foldersApi.starFolder(id),
    onSuccess: () => {
      addToast('success', 'Folder starred');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to star folder'),
  });
}

export function useUnstarFolder() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ id, driveId }: { id: string; driveId?: string }) =>
      driveId ? drivesApi.unstarDriveFolder(driveId, id) : foldersApi.unstarFolder(id),
    onSuccess: () => {
      addToast('success', 'Folder unstarred');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to unstar folder'),
  });
}

export function useDeleteDriveFolder() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ driveId, folderId }: { driveId: string; folderId: string }) =>
      drivesApi.deleteDriveFolder(driveId, folderId),
    onSuccess: () => {
      addToast('success', 'Folder deleted');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to delete folder'),
  });
}

export function useRestoreDriveFolder() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ driveId, folderId }: { driveId: string; folderId: string }) =>
      drivesApi.restoreDriveFolder(driveId, folderId),
    onSuccess: () => {
      addToast('success', 'Folder restored');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to restore folder'),
  });
}

export function usePermanentDeleteDriveFolder() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ driveId, folderId }: { driveId: string; folderId: string }) =>
      drivesApi.deleteDriveFolderPermanent(driveId, folderId),
    onSuccess: () => {
      addToast('success', 'Folder permanently deleted');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to delete folder'),
  });
}

export function useRenameDriveFolder() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({
      driveId,
      folderId,
      name,
    }: {
      driveId: string;
      folderId: string;
      name: string;
    }) => drivesApi.renameDriveFolder(driveId, folderId, name),
    onSuccess: () => {
      addToast('success', 'Folder renamed');
      invalidateAfterFileMutation(qc);
    },
    onError: () => addToast('error', 'Failed to rename folder'),
  });
}
