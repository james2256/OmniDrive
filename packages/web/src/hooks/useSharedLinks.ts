import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSharedLinks } from '../lib/api';
import type { SharedLink } from '../lib/api';

/** Query key factory for shared-link queries. */
export const sharedKeys = {
  all: ['sharedLinks'] as const,
};

/**
 * Replaces `sharedStore.fetchSharedLinks` + `sharedLinks` + `isLoading`.
 *
 * Cached for 30s (queryClient default staleTime). Multiple consumers share
 * one request.
 */
export function useSharedLinks() {
  return useQuery<SharedLink[]>({
    queryKey: sharedKeys.all,
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
 *
 * Returns a function that invalidates the shared-links cache, triggering a
 * refetch on all `useSharedLinks()` / `useIsTargetShared()` consumers.
 */
export function useInvalidateSharedLinks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sharedKeys.all });
}
