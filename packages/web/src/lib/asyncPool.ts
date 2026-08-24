/**
 * Concurrency-limited async generator. Yields results as they complete
 * (race-based, not batch-based) for maximum throughput on mixed file sizes.
 *
 * Pattern: tiny-async-pool — start up to `concurrency` promises at once,
 * yield whichever resolves first, immediately start the next item.
 *
 * The mapper returns `R | null` — null means "skip this item" (used by
 * fetchDownloadWithRetry to skip failed files without aborting the pool).
 *
 * Note: yields in completion order, not input order. ZIP entries will be in
 * completion order (cosmetic — extractors sort by name). client-zip
 * (packages/web/src/components/FolderDownloadModal.tsx) doesn't require
 * ordered entries — each entry has its own `name`.
 *
 * @param signal Optional AbortSignal — when aborted, the generator stops
 *               starting new items and returns. In-flight promises are
 *               aborted by the fetch caller (RequestInit.signal).
 */
export async function* asyncPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R | null>,
  signal?: AbortSignal,
): AsyncGenerator<{ result: R | null; index: number }> {
  const executing = new Set<Promise<{ result: R | null; index: number }>>();
  let i = 0;
  for (const item of items) {
    if (signal?.aborted) return;
    const index = i++;
    const p = fn(item, index).then(
      (result) => {
        executing.delete(p);
        return { result, index };
      },
      (err) => {
        // AbortError propagates (re-thrown by fetchDownloadWithRetry).
        // Other errors are caught by fetchDownloadWithRetry and returned as null,
        // so we should never reach here for those — but guard anyway.
        executing.delete(p);
        throw err;
      },
    );
    executing.add(p);
    if (executing.size >= concurrency) {
      yield await Promise.race(executing);
    }
  }
  while (executing.size > 0) {
    yield await Promise.race(executing);
  }
}
