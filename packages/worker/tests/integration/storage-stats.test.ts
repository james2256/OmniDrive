import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { ensureSchema, clearAllTables } from './helpers';
import { FileRepository } from '../../src/repositories/file.repository';

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database;
    KV: KVNamespace;
    JWT_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    FRONTEND_URL: string;
    WORKER_URL: string;
  }
}

async function insertUser(id: string, username: string): Promise<void> {
  await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .bind(id, username, '$2a$10$dummy')
    .run();
}

async function insertFile(params: {
  id: string;
  userId: string;
  driveId: string;
  googleFileId: string;
  name: string;
  mimeType: string;
  size: number;
  isTrashed?: number;
}): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name, mime_type, size, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      params.id,
      params.userId,
      params.driveId,
      params.googleFileId,
      params.name,
      params.mimeType,
      params.size,
      params.isTrashed ?? 0,
    )
    .run();
}

async function insertDrive(id: string, userId: string, email: string): Promise<void> {
  await env.DB.prepare('INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)')
    .bind(id, userId, email, 'oauth')
    .run();
}

describe('Storage Stats (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  it('getStorageStats returns per-mime totals after upload delta', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Simulate upload: insert file + apply delta
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(1);
    expect(results[0].mime_type).toBe('image/jpeg');
    expect(results[0].total_size).toBe(5000);
  });

  it('trash subtracts size from stats', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Upload
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);

    // Trash (mark trashed + apply negative delta)
    await env.DB.prepare('UPDATE files SET is_trashed = 1 WHERE id = ?').bind('f1').run();
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(1);
    expect(results[0].total_size).toBe(0); // MAX(0, 5000 - 5000) = 0
  });

  it('restore adds size back to stats', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Upload + trash
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
      isTrashed: 1,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    // Restore
    await env.DB.prepare('UPDATE files SET is_trashed = 0 WHERE id = ?').bind('f1').run();
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results[0].total_size).toBe(5000);
  });

  it('permanent delete of trashed file does not change stats', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    // Upload + trash
    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5000,
      isTrashed: 1,
    });
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 5000 }]);
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    // Permanent delete (file already trashed — no delta needed)
    await repo.delete('f1', 'u1');

    const { results } = await repo.getStorageStats('u1');
    expect(results[0].total_size).toBe(0); // unchanged
  });

  it('multiple mime types tracked independently', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');
    const repo = new FileRepository(env.DB);

    await repo.applyStorageDeltas([
      { userId: 'u1', mimeType: 'image/jpeg', delta: 3000 },
      { userId: 'u1', mimeType: 'video/mp4', delta: 10000 },
      { userId: 'u1', mimeType: 'application/pdf', delta: 2000 },
    ]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(3);
    const byMime = Object.fromEntries(results.map((r) => [r.mime_type, r.total_size]));
    expect(byMime['image/jpeg']).toBe(3000);
    expect(byMime['video/mp4']).toBe(10000);
    expect(byMime['application/pdf']).toBe(2000);
  });

  it('CASE WHEN clamp prevents negative totals on conflict (drift scenario)', async () => {
    await insertUser('u1', 'alice');
    const repo = new FileRepository(env.DB);

    // First insert (positive — normal upload)
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: 3000 }]);

    // Second delta: larger negative than current total (simulates drift)
    // ON CONFLICT should clamp to 0, not go negative
    await repo.applyStorageDeltas([{ userId: 'u1', mimeType: 'image/jpeg', delta: -5000 }]);

    const { results } = await repo.getStorageStats('u1');
    expect(results).toHaveLength(1);
    expect(results[0].total_size).toBe(0); // clamped, not -2000
  });

  it('findExistingForDelta returns correct old states', async () => {
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');

    await insertFile({
      id: 'f1',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g-file-1',
      name: 'active.pdf',
      mimeType: 'application/pdf',
      size: 1000,
    });
    await insertFile({
      id: 'f2',
      userId: 'u1',
      driveId: 'd1',
      googleFileId: 'g-file-2',
      name: 'trashed.jpg',
      mimeType: 'image/jpeg',
      size: 2000,
      isTrashed: 1,
    });

    const repo = new FileRepository(env.DB);
    const states = await repo.findExistingForDelta('d1', ['g-file-1', 'g-file-2', 'g-nonexistent']);

    expect(states.size).toBe(2); // only existing files
    const active = states.get('g-file-1');
    expect(active?.size).toBe(1000);
    expect(active?.mimeType).toBe('application/pdf');
    expect(active?.isTrashed).toBe(false);

    const trashed = states.get('g-file-2');
    expect(trashed?.size).toBe(2000);
    expect(trashed?.mimeType).toBe('image/jpeg');
    expect(trashed?.isTrashed).toBe(true);

    expect(states.has('g-nonexistent')).toBe(false);
  });

  it('findExistingForDelta handles >100 file IDs without D1 variable overflow', async () => {
    // Regression test: CHUNK was 500, causing 501 bind variables > D1's 100 limit.
    // The error was "D1_ERROR: too many SQL variables at offset 321".
    await insertUser('u1', 'alice');
    await insertDrive('d1', 'u1', 'alice@gmail.com');

    // Insert 150 files — exceeds the old CHUNK=500? No, but exceeds D1's 100-variable limit.
    // With CHUNK=99 (the fix), this produces 2 chunks (99 + 51), each under 100.
    for (let i = 0; i < 150; i++) {
      await insertFile({
        id: `f${i}`,
        userId: 'u1',
        driveId: 'd1',
        googleFileId: `g-file-${i}`,
        name: `file-${i}.txt`,
        mimeType: 'text/plain',
        size: 100,
      });
    }

    const repo = new FileRepository(env.DB);
    const ids = Array.from({ length: 150 }, (_, i) => `g-file-${i}`);
    const states = await repo.findExistingForDelta('d1', ids);

    expect(states.size).toBe(150);
    expect(states.get('g-file-0')?.size).toBe(100);
    expect(states.get('g-file-149')?.size).toBe(100);
  });
});
