import { test, expect, vi } from 'vitest';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { activeSyncs, runD1Batch } from '../services/sync';

test('activeSyncs lock exists', () => {
  expect(activeSyncs).toBeInstanceOf(Set);
});

test('runD1Batch chunks statements per D1 batch() guidance', async () => {
  const batch = vi.fn().mockResolvedValue([]);
  const db = { batch } as unknown as D1Database;

  const stmts = Array.from({ length: 250 }, (_, i) => ({ i }) as D1PreparedStatement);
  await runD1Batch(db, stmts);

  expect(batch).toHaveBeenCalledTimes(3);
  expect(batch.mock.calls[0][0]).toHaveLength(100);
  expect(batch.mock.calls[1][0]).toHaveLength(100);
  expect(batch.mock.calls[2][0]).toHaveLength(50);
});