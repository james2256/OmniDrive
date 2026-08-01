/**
 * Sync status for drive accounts and workspace folders.
 *
 * Mirrors the worker's `SyncStatus` (`packages/worker/src/types/sync-status.ts`).
 * // ponytail: extract a `@omnidrive/shared-types` workspace package when
 * the 5th shared type is added — currently duplicated to avoid cross-package
 * `rootDir` violations (web tsconfig has `rootDir: "src"`, which blocks
 * imports from `packages/worker/src/` with `TS6059`).
 */
export type SyncStatus = 'idle' | 'syncing' | 'error';
