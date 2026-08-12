import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/** D1's batch() has a statement-count limit. Chunk to stay under it. */
const D1_BATCH_SIZE = 100;

/**
 * Batch-execute prepared statements in chunks of 100.
 *
 * Used by sync.ts's batchUpsertFolderContents to stay under D1's batch()
 * statement-count limit.
 */
export async function batchInChunks(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += D1_BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + D1_BATCH_SIZE));
  }
}
