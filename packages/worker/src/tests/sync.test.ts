import { test, expect, vi } from 'vitest';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { runScheduledSync } from '../services/sync';
import { batchInChunks } from '../lib/d1-batch';

test('batchInChunks chunks statements per D1 batch() guidance', async () => {
  const batch = vi.fn().mockResolvedValue([]);
  const db = { batch } as unknown as D1Database;

  const stmts = Array.from({ length: 250 }, (_, i) => ({ i }) as D1PreparedStatement);
  await batchInChunks(db, stmts);

  expect(batch).toHaveBeenCalledTimes(3);
  expect(batch.mock.calls[0][0]).toHaveLength(100);
  expect(batch.mock.calls[1][0]).toHaveLength(100);
  expect(batch.mock.calls[2][0]).toHaveLength(50);
});

test('runScheduledSync does not throw on empty drive list', async () => {
  // Verify that runScheduledSync completes without error when there are no drives.
  // The function should make the initial SELECT for drive_accounts, find 0 rows,
  // and exit the loop without calling any sync logic.
  const allMock = vi.fn().mockResolvedValue({ results: [] });
  const firstMock = vi.fn().mockResolvedValue(null);
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      all: allMock,
      first: firstMock,
      bind: vi.fn().mockReturnValue({ all: allMock, first: firstMock }),
    }),
  } as unknown as D1Database;

  await runScheduledSync({
    DB: mockDb,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    TOKEN_ENCRYPTION_KEY: '',
  });

  // With 0 drives, the drive_accounts SELECT ran but no sync_state lock was attempted.
  expect(allMock).toHaveBeenCalledTimes(1);
  expect(firstMock).not.toHaveBeenCalled();
});
