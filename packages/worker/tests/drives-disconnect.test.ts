import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from '../src/types/env';
import { drivesRouter } from '../src/routes/drives';
import { GoogleDriveService } from '../src/services/google-drive';

const USER_ID = 'user-1';
const DRIVE_ID = 'drive-1';
const NEXT_DRIVE_ID = 'drive-2';

describe('DELETE /api/drives/:id', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const SESSION_ID = 'session-abc';

  const buildApp = (db: unknown) => {
    const kvDelete = vi.fn().mockResolvedValue(undefined);
    const kvGet = vi.fn().mockResolvedValue(null);
    const kvPut = vi.fn().mockResolvedValue(undefined);

    const sessionRow = {
      data: JSON.stringify({ userId: USER_ID, role: 'member', createdAt: Date.now() }),
      expires_at: Date.now() + 86_400_000,
      touched_at: Date.now(), // recent — skips session extension, avoids UPDATE
    };
    const wrappedDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM sessions')) {
          return { bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(sessionRow), run: vi.fn() })) };
        }
        return (db as any).prepare(sql);
      }),
    };

    const app = new Hono<AppContext>();
    app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
    app.route('/drives', drivesRouter);
    return {
      app,
      env: {
        DB: wrappedDb,
        KV: {
          get: kvGet,
          put: kvPut,
          delete: kvDelete,
        },
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        TOKEN_ENCRYPTION_KEY: 'test-key',
      },
      requestInit: {
        method: 'DELETE',
        headers: { Cookie: `omnidrive_sid=${SESSION_ID}` },
      } as RequestInit,
    };
  };

  it('returns 404 when drive does not belong to user', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue(null),
        })),
      })),
    };

    const { app, env, requestInit } = buildApp(db);
    const res = await app.request(`/drives/${DRIVE_ID}`, requestInit, env);
    expect(res.status).toBe(404);
  });

  it('disconnects oauth drive, revokes tokens, and reassigns primary', async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const firstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: DRIVE_ID,
        user_id: USER_ID,
        type: 'oauth',
        is_primary: 1,
      })
      .mockResolvedValueOnce({ id: NEXT_DRIVE_ID });

    const db = {
      prepare: vi.fn((_sql: string) => ({
        bind: vi.fn(() => ({
          first: firstMock,
          run: runMock,
        })),
      })),
    };

    const revokeSpy = vi.spyOn(GoogleDriveService.prototype, 'revokeTokens').mockResolvedValue(undefined);

    const { app, env, requestInit } = buildApp(db);
    const res = await app.request(`/drives/${DRIVE_ID}`, requestInit, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(revokeSpy).toHaveBeenCalledWith(DRIVE_ID);
    expect(runMock).toHaveBeenCalled();
    // Tokens now deleted via D1 (drive_tokens table), not KV
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM drive_tokens'));
  });

  it('skips token revoke for service account drives', async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const firstMock = vi.fn().mockResolvedValue({
      id: DRIVE_ID,
      user_id: USER_ID,
      type: 'service_account',
      is_primary: 0,
    });

    const db = {
      prepare: vi.fn((_sql: string) => ({
        bind: vi.fn(() => ({
          first: firstMock,
          run: runMock,
        })),
      })),
    };

    const revokeSpy = vi.spyOn(GoogleDriveService.prototype, 'revokeTokens').mockResolvedValue(undefined);

    const { app, env, requestInit } = buildApp(db);
    const res = await app.request(`/drives/${DRIVE_ID}`, requestInit, env);

    expect(res.status).toBe(200);
    expect(revokeSpy).not.toHaveBeenCalled();
    // Tokens now deleted via D1 (drive_tokens table), not KV
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM drive_tokens'));
  });
});