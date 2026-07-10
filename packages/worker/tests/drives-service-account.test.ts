import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from '../src/types/env';
import { drivesRouter } from '../src/routes/drives';

vi.mock('../src/lib/google-service-account', () => ({
  parseServiceAccountJson: vi.fn(() => ({
    type: 'service_account',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    project_id: 'test-project',
  })),
  fetchServiceAccountAccessToken: vi.fn(async () => ({
    accessToken: 'ya29.test-token',
    expiresAt: Date.now() + 3_600_000,
  })),
  verifySharedFolderAccess: vi.fn(async () => ({ id: 'folder-abc', name: 'Team Drive Folder' })),
}));

vi.mock('../src/lib/crypto', () => ({
  encrypt: vi.fn(async (value: string) => `enc:${value}`),
}));

vi.mock('../src/services/sync', () => ({
  syncDriveAccount: vi.fn(async () => undefined),
}));

const USER_ID = 'user-1';
const SESSION_ID = 'session-abc';
const VALID_SA_JSON = JSON.stringify({ type: 'service_account', client_email: 'sa@test.iam.gserviceaccount.com' });

describe('POST /api/drives/service-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const buildApp = () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const firstMock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({
        id: 'drive-sa-1',
        user_id: USER_ID,
        google_account_id: 'sa@test.iam.gserviceaccount.com',
        email: 'sa@test.iam.gserviceaccount.com',
        name: 'Team Drive Folder',
        type: 'service_account',
        is_primary: 1,
        root_folder_id: 'folder-abc',
      });

    const db = {
      prepare: vi.fn((_sql: string) => ({
        bind: vi.fn(() => ({
          first: firstMock,
          run: runMock,
        })),
      })),
    };

    const kvPut = vi.fn().mockResolvedValue(undefined);
    const kvGet = vi.fn().mockResolvedValue(null);

    const sessionRow = {
      data: JSON.stringify({ userId: USER_ID, role: 'member', createdAt: Date.now() }),
      expires_at: Date.now() + 86_400_000,
      touched_at: Date.now() - 7_200_000,
    };
    const wrappedDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM sessions')) {
          return { bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(sessionRow), run: vi.fn() })) };
        }
        return db.prepare(sql);
      }),
    };

    const app = new Hono<AppContext>();
    app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
    app.route('/drives', drivesRouter);

    return {
      app,
      env: {
        DB: wrappedDb,
        KV: { get: kvGet, put: kvPut, delete: vi.fn() },
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        TOKEN_ENCRYPTION_KEY: 'test-key',
      },
      runMock,
      db,
    };
  };

  it('creates a service account drive and stores encrypted credentials', async () => {
    const { app, env, runMock, db } = buildApp();
    const executionCtx = { waitUntil: vi.fn() };
    const res = await app.request(
      '/drives/service-account',
      {
        method: 'POST',
        headers: {
          Cookie: `omnidrive_sid=${SESSION_ID}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credentials: VALID_SA_JSON, folderId: 'folder-abc' }),
      },
      env,
      executionCtx
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, driveId: expect.any(String) });
    expect(runMock).toHaveBeenCalled();
    // Tokens now stored in D1 drive_tokens table, not KV
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('drive_tokens'));
  });

  it('validates required fields', async () => {
    const { app, env } = buildApp();
    const res = await app.request(
      '/drives/service-account',
      {
        method: 'POST',
        headers: {
          Cookie: `omnidrive_sid=${SESSION_ID}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credentials: '', folderId: '' }),
      },
      env
    );

    expect(res.status).toBe(400);
  });
});