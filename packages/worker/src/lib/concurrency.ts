/**
 * Run async tasks with a bounded concurrency limit.
 *
 * Mirrors the pattern in useUploadStore.ts:40-51 (frontend), written fresh
 * for the worker (frontend modules can't be imported in the worker).
 *
 * Results are returned in the same order as the input tasks. If any task
 * rejects, the first rejection is thrown after all in-flight tasks settle
 * (remaining queued tasks are not started). This prevents unhandled
 * rejections from orphaned promises while still surfacing errors.
 *
 * Callers that need best-effort semantics (no throw) should catch inside
 * each task — the real callers (drives.ts quota fetch, drive-quota.ts sync)
 * already do this via per-task try/catch blocks.
 *
 * @param tasks - Array of zero-arg async functions to execute
 * @param limit - Maximum number of tasks to run concurrently (must be >= 1)
 * @returns Array of results in the same order as `tasks`
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();
  let firstError: unknown = null;

  for (let i = 0; i < tasks.length; i++) {
    const p = tasks[i]().then(
      (r) => {
        results[i] = r;
      },
      (e) => {
        if (firstError === null) firstError = e;
      },
    );
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
    // Stop scheduling new tasks after the first error
    if (firstError !== null) break;
  }

  await Promise.all(executing);
  if (firstError !== null) throw firstError;
  return results;
}
