import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { drivesApi } from '../lib/api/drives';
import { useToastStore } from '../stores/useToastStore';
import { qk } from '../lib/queryKeys';
import type { DriveAccount, AggregateQuota } from '../types';

interface DrivesResponse {
  drives: DriveAccount[];
  aggregate: AggregateQuota;
}

/**
 * Replaces `driveStore.fetchDrives` + `drives` + `isLoading` + `aggregate`.
 *
 * Multiple components calling this hook share a single request — TanStack
 * deduplicates automatically. Cached data is served instantly (staleTime:
 * 30s) with a background refetch.
 */
export function useDrives() {
  return useQuery<DrivesResponse>({
    queryKey: qk.drives,
    queryFn: () => drivesApi.getDrives(),
  });
}

/**
 * Replaces `driveStore.removeDrive`.
 *
 * Pessimistic: waits for the server to confirm disconnection, then invalidates
 * the drives cache so all `useDrives()` consumers refetch with the new list.
 */
export function useRemoveDrive() {
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  return useMutation({
    mutationFn: (driveId: string) => drivesApi.disconnectDrive(driveId),
    onSuccess: () => {
      addToast('success', 'Drive disconnected');
      queryClient.invalidateQueries({ queryKey: qk.drives });
    },
    onError: () => addToast('error', 'Failed to disconnect drive'),
  });
}

/**
 * Replaces `driveStore.triggerSync`. Pure API passthrough — the caller is
 * responsible for invalidating the drives cache (via `useDrives().refetch()`
 * or `queryClient.invalidateQueries`) to read the updated `syncPaused` status.
 */
export function useTriggerSync() {
  return useMutation({
    mutationFn: (driveId: string) => drivesApi.triggerSync(driveId),
  });
}

/**
 * Resolve a drive account by ID, with its index for color-badging.
 * Standardized fallback: returns { drive: null, index: -1 } when the ID
 * is absent OR not found — fixes the ExternalPage divergence (M-11) that
 * returned drives[0] for unknown IDs (showing the wrong drive's badge).
 */
export function useGetDriveInfo(drives: DriveAccount[]) {
  return useCallback(
    (driveAccountId?: string): { drive: DriveAccount | null; index: number } => {
      if (!driveAccountId) return { drive: null, index: -1 };
      const index = drives.findIndex((d) => d.id === driveAccountId);
      if (index === -1) return { drive: null, index: -1 };
      return { drive: drives[index], index };
    },
    [drives],
  );
}
