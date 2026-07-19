import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 *
 * `staleTime: 30_000` — drives and shared links don't change every second;
 * showing 30s-old cached data is fine and avoids duplicate refetches when
 * navigating between pages.
 *
 * `retry: 1` — retry once on failure (network blips), but don't hammer the
 * worker on a hard 500.
 *
 * `refetchOnWindowFocus: false` — this is an SPA; window focus changes are
 * frequent and would trigger unnecessary refetches.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
