import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { authGuard } from '../src/middleware/auth-guard';
import { AppError } from '../src/lib/errors';
import type { AppContext, Env } from '../src/types/env';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      touched_at INTEGER NOT NULL
    );
  `);
  return db;
}

function mockContext(db: D1Database, cookie: string | undefined): AppContext {
  const headers = new Headers();
  if (cookie) {
    headers.set('Cookie', `omnidrive_sid=${cookie}`);
  }
  return {
    env: {
      DB: db,
      KV: {} as KVNamespace,
      JWT_SECRET: 'test-secret-at-least-32-characters-long',
      TOKEN_ENCRYPTION_KEY: 'test-encryption-key-32-chars!!!',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      FRONTEND_URL: 'https://example.com',
      WORKER_URL: 'https://api.example.com',
    } as Env,
    req: {
      header: (name: string) => headers.get(name),
      raw: { headers } as unknown as Request,
    } as unknown as AppContext['req'],
    set: vi.fn(),
    get: vi.fn(),
    executionCtx: { waitUntil: vi.fn() } as unknown as AppContext['executionCtx'],
  } as unknown as AppContext;
}

// Wrap a better-sqlite3 DB in the minimal D1-shaped interface authGuard uses
function wrapSqlite(db: Database.Database): D1Database {
  const makeExecutor = (sql: string, binds: unknown[] = []) => ({
    all: () => ({
      results: binds.length ? db.prepare(sql).all(...binds) : db.prepare(sql).all(),
      success: true,
      meta: { changes: 0 },
    }),
    first: <T = unknown>() =>
      (binds.length ? db.prepare(sql).get(...binds) : db.prepare(sql).get()) as T | null,
    run: () => {
      const info = binds.length ? db.prepare(sql).run(...binds) : db.prepare(sql).run();
      return { success: true, meta: { changes: info.changes } };
    },
    bind: (...newBinds: unknown[]) => makeExecutor(sql, newBinds),
  });
  return { prepare: (sql: string) => makeExecutor(sql) } as unknown as D1Database;
}

describe('authGuard', () => {
  it('throws 401 when no cookie is present', async () => {
    const db = wrapSqlite(createDb());
    const c = mockContext(db, undefined);

    await expect(authGuard(c, () => Promise.resolve())).rejects.toThrow(AppError);
    await expect(authGuard(c, () => Promise.resolve())).rejects.toMatchObject({
      status: 401,
      message: 'Not authenticated',
    });
  });

  it('throws 401 when session does not exist', async () => {
    const rawDb = createDb();
    const db = wrapSqlite(rawDb);
    const c = mockContext(db, 'nonexistent-session');

    await expect(authGuard(c, () => Promise.resolve())).rejects.toMatchObject({
      status: 401,
      message: 'Session expired',
    });
    rawDb.close();
  });

  it('throws 401 and deletes session when expired', async () => {
    const rawDb = createDb();
    rawDb
      .prepare('INSERT INTO sessions (id, data, expires_at, touched_at) VALUES (?, ?, ?, ?)')
      .run('sess-1', JSON.stringify({ userId: 'u1' }), Date.now() - 1000, Date.now() - 1000);
    const db = wrapSqlite(rawDb);
    const c = mockContext(db, 'sess-1');

    await expect(authGuard(c, () => Promise.resolve())).rejects.toMatchObject({
      status: 401,
      message: 'Session expired',
    });

    // Session should be deleted
    const row = rawDb
      .prepare('SELECT COUNT(*) as count FROM sessions WHERE id = ?')
      .get('sess-1') as { count: number };
    expect(row.count).toBe(0);
    rawDb.close();
  });

  it('throws 401 and deletes session when JSON is corrupted (self-heal)', async () => {
    const rawDb = createDb();
    rawDb
      .prepare('INSERT INTO sessions (id, data, expires_at, touched_at) VALUES (?, ?, ?, ?)')
      .run('sess-corrupt', '{"userId":"u1" BAD JSON', Date.now() + 10000, Date.now() - 2000);
    const db = wrapSqlite(rawDb);
    const c = mockContext(db, 'sess-corrupt');

    await expect(authGuard(c, () => Promise.resolve())).rejects.toMatchObject({
      status: 401,
      message: 'Session expired',
    });

    // Corrupted session should be deleted (self-heal)
    const row = rawDb
      .prepare('SELECT COUNT(*) as count FROM sessions WHERE id = ?')
      .get('sess-corrupt') as { count: number };
    expect(row.count).toBe(0);
    rawDb.close();
  });

  it('sets userId and session on context when valid', async () => {
    const rawDb = createDb();
    const sessionData = {
      userId: 'u1',
      username: 'alice',
      email: null,
      name: 'Alice',
      avatarUrl: null,
      role: 'member' as const,
      createdAt: Date.now(),
    };
    rawDb
      .prepare('INSERT INTO sessions (id, data, expires_at, touched_at) VALUES (?, ?, ?, ?)')
      .run('sess-valid', JSON.stringify(sessionData), Date.now() + 10000, Date.now() - 2000);
    const db = wrapSqlite(rawDb);
    const c = mockContext(db, 'sess-valid');

    await authGuard(c, () => Promise.resolve());

    expect(c.set).toHaveBeenCalledWith('userId', 'u1');
    expect(c.set).toHaveBeenCalledWith('session', sessionData);
    rawDb.close();
  });
});
