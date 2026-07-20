import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getSharedLinks, deleteSharedLink } from '../lib/api';
import type { SharedLink } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useToastStore } from '../stores/useToastStore';

/**
 * Replaces `sharedStore.fetchSharedLinks` + `sharedLinks` + `isLoading`.
 *
 * Cached for 30s (queryClient default staleTime). Multiple consumers share
 * one request.
 */
export function useSharedLinks() {
  return useQuery<SharedLink[]>({
    queryKey: qk.sharedLinks,
    queryFn: async () => {
      const { links } = await getSharedLinks();
      return links;
    },
  });
}

/**
 * Replaces `sharedStore.isTargetShared`. Derives from cached data — no
 * separate fetch. Returns false while data is loading.
 */
export function useIsTargetShared(targetId: string | undefined, targetType: 'file' | 'folder'): boolean {
  const { data: sharedLinks = [] } = useSharedLinks();
  if (!targetId) return false;
  return sharedLinks.some(
    (link) => link.targetId === targetId && link.targetType === targetType,
  );
}

/**
 * Replaces the non-reactive `useSharedStore.getState().fetchSharedLinks()`
 * pattern used in ShareModal/EditShareModal after mutations.
 */
export function useInvalidateSharedLinks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.sharedLinks });
}

/** Revoke (delete) a shared link. Invalidates the shared-links cache. */
export function useRevokeSharedLink() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (id: string) => deleteSharedLink(id),
    onSuccess: () => {
      addToast('success', 'Link revoked successfully');
      qc.invalidateQueries({ queryKey: qk.sharedLinks });
    },
    onError: () => addToast('error', 'Failed to revoke link'),
  });
}
