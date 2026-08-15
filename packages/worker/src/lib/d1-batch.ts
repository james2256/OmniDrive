import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/** D1's batch() has a statement-count limit. Chunk to stay under it. */
const D1_BATCH_SIZE = 100;

/**
 * Batch-execute prepared statements in chunks of 100.
 *
 * Used by FileRepository.applyStorageDeltas to stay under D1's batch()
 * statement-count limit. Sync paths (initial/incremental/lazy-load) use
 * batchUpsertUnitsWithCheckpoint for per-file atomic grouping instead.
 */
export async function batchInChunks(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += D1_BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + D1_BATCH_SIZE));
  }
}

/**
 * A unit of work for atomic batched writes. Each unit pairs a primary DML
 * statement (UPSERT / DELETE / mark-trashed) with the file_storage_stats
 * delta statements that must commit alongside it.
 *
 * Grouping per-file ensures that on retry, if a chunk's db.batch() failed,
 * both the file's DML and its deltas are absent — findExistingForDelta
 * sees the old state, computeStorageDelta recomputes the delta, and it
 * is applied exactly once. This prevents the double-counting that a flat
 * proportional distribution of deltas would cause.
 */
export interface BatchUnit {
  stmt: D1PreparedStatement;
  deltas: D1PreparedStatement[];
}

/**
 * Batch-execute units of (stmt + deltas) atomically in chunks of 100 units.
 *
 * Each chunk's db.batch() contains all primary stmts + all deltas for those
 * units + the checkpoint (appended to the last chunk). If a chunk fails,
 * the previous chunks are already committed, but the checkpoint hasn't
 * advanced — the next retry re-processes from the last saved checkpoint.
 *
 * Returns the number of db.batch() calls (D1 subrequests) used.
 */
export async function batchUpsertUnitsWithCheckpoint(
  db: D1Database,
  units: BatchUnit[],
  checkpointStmt: D1PreparedStatement | null,
): Promise<number> {
  if (units.length === 0 && !checkpointStmt) return 0;

  let subrequestCount = 0;

  // Handle the edge case: no units but a checkpoint exists (e.g., page with
  // only folders, no files — checkpoint still needs to advance).
  if (units.length === 0 && checkpointStmt) {
    await db.batch([checkpointStmt]);
    return 1;
  }

  for (let i = 0; i < units.length; i += D1_BATCH_SIZE) {
    const chunk = units.slice(i, i + D1_BATCH_SIZE);
    const isLastChunk = i + D1_BATCH_SIZE >= units.length;

    const stmts: D1PreparedStatement[] = [];
    for (const unit of chunk) {
      stmts.push(unit.stmt);
      stmts.push(...unit.deltas);
    }

    if (isLastChunk && checkpointStmt) {
      stmts.push(checkpointStmt);
    }

    await db.batch(stmts);
    subrequestCount++;
  }

  return subrequestCount;
}
