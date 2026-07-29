import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchInChunks } from '../src/lib/d1-batch';
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
