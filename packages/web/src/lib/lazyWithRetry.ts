import { lazy } from 'react';

/**
 * Wraps React.lazy() with a one-time auto-reload on chunk fetch failure.
 *
 * After a deploy, old index.html may reference stale chunk hashes that 404.
 * This catches the error, reloads once (fetching fresh index.html), and guards
 * against infinite loops via a sessionStorage flag.
 *
 * The flag is cleared on success so the retry mechanism works on every deploy,
 * not just the first one. Without clearing, a user who experienced one chunk
 * failure would never get the auto-retry on a subsequent deploy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn()
      .then((result) => {
        sessionStorage.removeItem('chunk-retry');
        return result;
      })
      .catch((err: Error) => {
        if (!sessionStorage.getItem('chunk-retry')) {
          sessionStorage.setItem('chunk-retry', '1');
          window.location.reload();
        }
        throw err;
      }),
  );
}
