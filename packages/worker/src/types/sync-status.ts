/**
 * Sync status for drive accounts and workspace folders.
 *
 * Single source of truth for the worker package — replaces 12 inline
 * `'idle' | 'syncing' | 'error'` union literals across 3 files.
 *
 * The web package has its own copy (`web/src/types/sync-status.ts`) matching
 * this type. // ponytail: extract a `@omnidrive/shared-types` workspace
 * package when the 5th shared type is added — currently duplicated to avoid
 * cross-package `rootDir` violations (web tsconfig has `rootDir: "src"`).
 *
 * // ponytail: add a DB CHECK constraint (requires table recreation —
 * see migration 0006 for the pattern). Deferred because SQLite can't
 * `ALTER ADD CHECK` on an existing column.
 */
export type SyncStatus = 'idle' | 'syncing' | 'error';
