import type { D1Database } from '@cloudflare/workers-types';

/**
 * Data access layer for the `sync_state` table.
 *
 * `sync_state` is the per-drive sync coordination table: it holds the
 * cross-isolate lock (status = 'syncing'), the incremental-sync cursor
 * (change_token), the initial-sync resume point (next_page_token), and the
 * last outcome (last_synced_at / error_message). All SQL for this table
 * lives here — the sync engine (`services/sync.ts`) never writes inline SQL
 * for `sync_state`.
 */
export class SyncStateRepository {
  constructor(private db: D1Database) {}

  /**
   * Acquire the cross-isolate sync lock via a conditional UPSERT+RETURNING.
   *
   * INSERTs a 'syncing' row, or — if a row already exists — UPDATEs it to
   * 'syncing' only when the current status is NOT already 'syncing'. The
   * `RETURNING` clause yields the drive_account_id when the lock is acquired;
   * a `null` return means another isolate (or direct caller) is already
   * syncing and this invocation must back off.
   *
   * Uses `.first()` (not `.run()`) so the RETURNING result is readable.
   */
  acquireLock(driveId: string) {
    return this.db
      .prepare(
        `INSERT INTO sync_state (drive_account_id, status) VALUES (?, 'syncing')
         ON CONFLICT(drive_account_id) DO UPDATE SET status = 'syncing', error_message = NULL
         WHERE sync_state.status != 'syncing'
         RETURNING drive_account_id`,
      )
      .bind(driveId)
      .first<{ drive_account_id: string }>();
  }

  /**
   * Read the persisted sync cursor for a drive (change_token + next_page_token).
   * Used at the start of every sync cycle to decide between initial and
   * incremental sync and to resume a paused initial sync.
   */
  findSyncState(driveId: string) {
    return this.db
      .prepare('SELECT * FROM sync_state WHERE drive_account_id = ?')
      .bind(driveId)
      .first<{ change_token: string | null; next_page_token: string | null }>();
  }

  /**
   * Mark a drive's sync as idle WITHOUT touching the change token.
   *
   * Used when an initial sync pauses (external-subrequest budget hit or
   * shutdown): next_page_token was already saved per-page, so the next cron
   * cycle resumes from there. 'idle' (not 'error') keeps the UI from showing
   * a false failure.
   */
  setIdle(driveId: string) {
    return this.db
      .prepare("UPDATE sync_state SET status = 'idle' WHERE drive_account_id = ?")
      .bind(driveId)
      .run();
  }

  /**
   * Persist a successful sync completion: status='idle', last_synced_at=now,
   * change_token = the fresh token, next_page_token = NULL.
   *
   * UPSERT (not UPDATE) so the very first completion — where the lock INSERT
   * created the row moments ago — is handled by the ON CONFLICT branch.
   */
  upsertIdleCompleted(driveId: string, changeToken: string) {
    return this.db
      .prepare(
        `INSERT INTO sync_state (drive_account_id, status, last_synced_at, change_token, next_page_token) VALUES (?, 'idle', CURRENT_TIMESTAMP, ?, NULL) ON CONFLICT(drive_account_id) DO UPDATE SET status = 'idle', last_synced_at = CURRENT_TIMESTAMP, change_token = excluded.change_token, next_page_token = NULL`,
      )
      .bind(driveId, changeToken)
      .run();
  }

  /**
   * Persist a sync failure: status='error', error_message = the message.
   * UPSERT so the row (created by the lock) is updated rather than inserted.
   */
  upsertError(driveId: string, message: string) {
    return this.db
      .prepare(
        `INSERT INTO sync_state (drive_account_id, status, error_message) VALUES (?, 'error', ?) ON CONFLICT(drive_account_id) DO UPDATE SET status = 'error', error_message = excluded.error_message`,
      )
      .bind(driveId, message)
      .run();
  }

  /**
   * Save the next-page checkpoint during an initial sync.
   *
   * Called after every Google Drive page so a crash or budget-pause mid-sync
   * resumes from the last fully-processed page on the next cron cycle.
   */
  updateNextPageToken(driveId: string, nextPageToken: string) {
    return this.db
      .prepare('UPDATE sync_state SET next_page_token = ? WHERE drive_account_id = ?')
      .bind(nextPageToken, driveId)
      .run();
  }
}
