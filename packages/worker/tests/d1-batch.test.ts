import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchInChunks, batchUpsertUnitsWithCheckpoint, type BatchUnit } from '../src/lib/d1-batch';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

function makeStmt(): D1PreparedStatement {
  // Minimal stub — only the surface batchInChunks touches is the reference itself.
  return {} as D1PreparedStatement;
}

function makeDb(batchFn: (stmts: D1PreparedStatement[]) => Promise<unknown>): D1Database {
  return { batch: vi.fn(batchFn) } as unknown as D1Database;
}

describe('batchInChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-op for an empty statement array (db.batch never called)', async () => {
    const batch = vi.fn();
    const db = { batch } as unknown as D1Database;
    await batchInChunks(db, []);
    expect(batch).not.toHaveBeenCalled();
  });

  it('executes a single statement in one batch call', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const stmts = [makeStmt()];
    await batchInChunks(db, stmts);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(stmts);
  });

  it('chunks at the D1_BATCH_SIZE (100) boundary — exactly 100 → 1 call', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const stmts = Array.from({ length: 100 }, makeStmt);
    await batchInChunks(db, stmts);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(stmts);
  });

  it('chunks at the D1_BATCH_SIZE (100) boundary — 101 → 2 calls (100 then 1)', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const stmts = Array.from({ length: 101 }, makeStmt);
    await batchInChunks(db, stmts);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenNthCalledWith(1, stmts.slice(0, 100));
    expect(batch).toHaveBeenNthCalledWith(2, stmts.slice(100, 101));
  });

  it('slices 250 statements into 3 chunks (100, 100, 50)', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const stmts = Array.from({ length: 250 }, makeStmt);
    await batchInChunks(db, stmts);
    expect(batch).toHaveBeenCalledTimes(3);
    expect(batch).toHaveBeenNthCalledWith(1, stmts.slice(0, 100));
    expect(batch).toHaveBeenNthCalledWith(2, stmts.slice(100, 200));
    expect(batch).toHaveBeenNthCalledWith(3, stmts.slice(200, 250));
  });

  it('propagates the error from db.batch on partial failure (later chunks not executed)', async () => {
    const err = new Error('D1 batch failed');
    const batch = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(err);
    const db = { batch } as unknown as D1Database;
    const stmts = Array.from({ length: 101 }, makeStmt);
    await expect(batchInChunks(db, stmts)).rejects.toThrow('D1 batch failed');
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it('propagates the error from the very first chunk', async () => {
    const err = new Error('First chunk boom');
    const batch = vi.fn().mockRejectedValue(err);
    const db = { batch } as unknown as D1Database;
    const stmts = Array.from({ length: 50 }, makeStmt);
    await expect(batchInChunks(db, stmts)).rejects.toThrow('First chunk boom');
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('executes all statements: every statement object is passed exactly once', async () => {
    const seen: D1PreparedStatement[] = [];
    const db = makeDb(async (s: D1PreparedStatement[]) => {
      seen.push(...s);
    });
    const stmts = Array.from({ length: 250 }, makeStmt);
    await batchInChunks(db, stmts);
    expect(seen.length).toBe(250);
    expect(new Set(seen).size).toBe(250); // every reference unique and present
  });
});

describe('batchUpsertUnitsWithCheckpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 and makes no db.batch call when units empty and no checkpoint', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const result = await batchUpsertUnitsWithCheckpoint(db, [], null);
    expect(result).toBe(0);
    expect(batch).not.toHaveBeenCalled();
  });

  it('returns 1 and makes one db.batch call with just the checkpoint when units empty', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const checkpoint = makeStmt();
    const result = await batchUpsertUnitsWithCheckpoint(db, [], checkpoint);
    expect(result).toBe(1);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith([checkpoint]);
  });

  it('executes a single unit in one batch call (no checkpoint)', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const units: BatchUnit[] = [{ stmt: makeStmt(), deltas: [makeStmt()] }];
    const result = await batchUpsertUnitsWithCheckpoint(db, units, null);
    expect(result).toBe(1);
    expect(batch).toHaveBeenCalledTimes(1);
    // Verify stmt order: stmt first, then its deltas
    expect(batch).toHaveBeenCalledWith([units[0]!.stmt, units[0]!.deltas[0]]);
  });

  it('appends checkpoint to the LAST chunk only (not the first)', async () => {
    // Critical invariant: checkpoint must go in the last chunk so it only
    // advances if ALL writes succeed. If a bad refactor moves it to the first
    // chunk, this test catches it immediately.
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    // 250 units → 3 chunks (100, 100, 50)
    const units: BatchUnit[] = Array.from({ length: 250 }, () => ({
      stmt: makeStmt(),
      deltas: [],
    }));
    const checkpoint = makeStmt();
    const result = await batchUpsertUnitsWithCheckpoint(db, units, checkpoint);
    expect(result).toBe(3);
    expect(batch).toHaveBeenCalledTimes(3);
    // First chunk: NO checkpoint
    const firstCall = batch.mock.calls[0]![0] as D1PreparedStatement[];
    expect(firstCall).not.toContain(checkpoint);
    // Second chunk: NO checkpoint
    const secondCall = batch.mock.calls[1]![0] as D1PreparedStatement[];
    expect(secondCall).not.toContain(checkpoint);
    // Third (last) chunk: HAS checkpoint at the end
    const lastCall = batch.mock.calls[2]![0] as D1PreparedStatement[];
    expect(lastCall[lastCall.length - 1]).toBe(checkpoint);
  });

  it('returns chunk count as subrequest count (150 units → 2)', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const units: BatchUnit[] = Array.from({ length: 150 }, () => ({
      stmt: makeStmt(),
      deltas: [],
    }));
    const result = await batchUpsertUnitsWithCheckpoint(db, units, null);
    expect(result).toBe(2);
  });

  it('interleaves stmt + deltas in the correct order within a chunk', async () => {
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const stmt1 = makeStmt();
    const delta1a = makeStmt();
    const delta1b = makeStmt();
    const stmt2 = makeStmt();
    const delta2 = makeStmt();
    const units: BatchUnit[] = [
      { stmt: stmt1, deltas: [delta1a, delta1b] },
      { stmt: stmt2, deltas: [delta2] },
    ];
    await batchUpsertUnitsWithCheckpoint(db, units, null);
    // Order: stmt1, delta1a, delta1b, stmt2, delta2
    expect(batch).toHaveBeenCalledWith([stmt1, delta1a, delta1b, stmt2, delta2]);
  });

  it('propagates error from db.batch (later chunks not executed)', async () => {
    const err = new Error('D1 batch failed');
    const batch = vi
      .fn()
      .mockResolvedValueOnce(undefined) // chunk 1 succeeds
      .mockRejectedValueOnce(err); // chunk 2 fails
    const db = { batch } as unknown as D1Database;
    const units: BatchUnit[] = Array.from({ length: 150 }, () => ({
      stmt: makeStmt(),
      deltas: [],
    }));
    await expect(batchUpsertUnitsWithCheckpoint(db, units, null)).rejects.toThrow(
      'D1 batch failed',
    );
    expect(batch).toHaveBeenCalledTimes(2); // chunk 3 never executed
  });

  it('appends checkpoint when single chunk is also the last chunk', async () => {
    // Edge case: 1 unit (1 chunk, also the last chunk) + checkpoint.
    // The single chunk IS the last chunk → checkpoint appended.
    const batch = vi.fn().mockResolvedValue(undefined);
    const db = { batch } as unknown as D1Database;
    const stmt = makeStmt();
    const checkpoint = makeStmt();
    const units: BatchUnit[] = [{ stmt, deltas: [] }];
    await batchUpsertUnitsWithCheckpoint(db, units, checkpoint);
    // Single chunk is also the last chunk → checkpoint appended
    expect(batch).toHaveBeenCalledWith([stmt, checkpoint]);
  });
});
