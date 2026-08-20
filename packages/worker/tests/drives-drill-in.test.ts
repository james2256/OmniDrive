import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from '../src/types/context';
import { drivesRouter } from '../src/routes/drives';
import { UpstreamError } from '../src/lib/errors';

// Mock batchUpsertFolderContents — the drill-in routes call it after listFolderContents.
vi.mock('../src/services/sync', () => ({
  batchUpsertFolderContents: vi.fn(async () => undefined),
}));

// Mock createDriveService — tests control listFolderContents behavior per-test.
const listFolderContentsMock = vi.fn();
vi.mock('../src/lib/drive-factory', () => ({
  createDriveService: vi.fn(() => ({
    listFolderContents: listFolderContentsMock,
  })),
}));

const USER_ID = 'user-1';
const SESSION_ID = 'session-abc';
const DRIVE_ID = 'drive-1';
const FOLDER_ID = 'folder-1';

/**
 * Build a Hono app with mocked DB + session for the drill-in routes.
 * `opts.d1Files` / `opts.d1Folders` control what the D1-only read returns
 * after listFolderContents (the cached rows shown when Google is unavailable).
 */
function buildApp(
  opts: { d1Files?: any[]; d1Folders?: any[]; driveRow?: any; folderRow?: any } = {},
) {
  const d1Files = opts.d1Files ?? [];
  const d1Folders = opts.d1Folders ?? [];
  // Allow null driveRow (for 404 tests) — `??` would fall back to the default
  // on null, so we check for undefined explicitly.
  const driveRow =
    opts.driveRow !== undefined
      ? opts.driveRow
      : {
          id: DRIVE_ID,
          user_id: USER_ID,
          google_account_id: 'g-1',
          email: 'alice@example.com',
          name: 'Alice Drive',
          type: 'oauth',
          is_primary: 1,
          root_folder_id: 'root-id',
          total_quota: 1000,
          used_quota: 100,
          quota_override: null,
          quota_updated_at: null,
          sync_status: 'idle',
          sync_error_message: null,
          sync_paused: 0,
          last_synced_at: null,
          created_at: '2024-01-01T00:00:00Z',
        };
  const folderRow = opts.folderRow ?? null;

  const sessionRow = {
    data: JSON.stringify({ userId: USER_ID, role: 'member', createdAt: Date.now() }),
    expires_at: Date.now() + 86_400_000,
    touched_at: Date.now() - 7_200_000,
  };

  const db = {
    prepare: vi.fn((sql: string) => {
      // Session lookup
      if (sql.includes('FROM sessions')) {
        return {
          bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(sessionRow), run: vi.fn() })),
        };
      }
      // drive_accounts lookup (findFullByIdAndUser)
      if (sql.includes('FROM drive_accounts')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(driveRow),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        };
      }
      // Cached files lookup (findFilesByParent)
      if (sql.includes('FROM files') && sql.includes('google_parent_id')) {
        return {
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({ results: d1Files }),
            first: vi.fn().mockResolvedValue(null),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        };
      }
      // Cached folders lookup (findDriveFoldersByParent)
      if (sql.includes('FROM drive_folders') && sql.includes('google_parent_id')) {
        return {
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({ results: d1Folders }),
            first: vi.fn().mockResolvedValue(folderRow),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        };
      }
      // Breadcrumb path CTE (findBreadcrumbPath)
      if (sql.includes('WITH RECURSIVE')) {
        return {
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({ results: [] }),
          })),
        };
      }
      // findDriveFolderByGoogleId
      if (sql.includes('FROM drive_folders') && sql.includes('google_folder_id')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(folderRow),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        };
      }
      // Default — return empty results
      return {
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
      };
    }),
  };

  const app = new Hono<AppContext>();
  app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
  app.route('/drives', drivesRouter);

  return {
    app,
    env: {
      DB: db,
      KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      },
      SYNC_QUEUE: { send: vi.fn(async () => undefined), sendBatch: vi.fn(async () => undefined) },
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      TOKEN_ENCRYPTION_KEY: 'test-key',
      FRONTEND_URL: 'http://localhost:5173',
      WORKER_URL: 'http://localhost:8888',
    },
  };
}

describe('GET /drives/:driveId/external-folders/:googleFolderId — D1-only drill-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached D1 rows (no Google API call, no lock conflict)', async () => {
    // The external-folders GET route is now D1-only (mirrors FilesPage drill-in
    // at drives.ts:324). It does NOT call listFolderContents or
    // batchUpsertFolderContents — so there's no 409-on-navigation risk.
    // Background sync populates D1; the user clicks "Sync" (POST /sync) for
    // a live refresh.
    const cachedFiles = [
      {
        id: 'f1',
        google_file_id: 'gfile-1',
        name: 'notes.docx',
        owned_by_me: 1,
        is_trashed: 0,
        size: 1024,
        mime_type: 'application/pdf',
      },
    ];
    const { app, env } = buildApp({ d1Files: cachedFiles });

    const res = await app.request(
      `/drives/${DRIVE_ID}/external-folders/${FOLDER_ID}`,
      {
        method: 'GET',
        headers: { Cookie: `omnidrive_sid=${SESSION_ID}` },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe('notes.docx');
    // listFolderContents must NOT be called — the route is D1-only.
    expect(listFolderContentsMock).not.toHaveBeenCalled();
  });

  it('returns 404 when drive not found', async () => {
    // findByIdAndUser returns null → NotFoundError('Drive not found').
    const { app, env } = buildApp({ driveRow: null });

    const res = await app.request(
      `/drives/${DRIVE_ID}/external-folders/${FOLDER_ID}`,
      {
        method: 'GET',
        headers: { Cookie: `omnidrive_sid=${SESSION_ID}` },
      },
      env,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Drive not found');
  });

  it('returns empty arrays when D1 has no cached rows for the folder', async () => {
    // Folder never synced (no files/folders in D1) → returns empty arrays,
    // not an error. The user sees an empty folder and can click "Sync".
    const { app, env } = buildApp({ d1Files: [], d1Folders: [] });

    const res = await app.request(
      `/drives/${DRIVE_ID}/external-folders/${FOLDER_ID}`,
      {
        method: 'GET',
        headers: { Cookie: `omnidrive_sid=${SESSION_ID}` },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toEqual([]);
    expect(body.subfolders).toEqual([]);
  });
});

describe('POST /drives/:driveId/folders/:googleFolderId/sync — lazy sync 502 fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached D1 rows when Google returns 404 (lost access)', async () => {
    // First-time drill-in to an unsynced folder that was unshared.
    // The idempotency check (is_synced=0) → calls Google → 404 → caught.
    listFolderContentsMock.mockRejectedValue(new UpstreamError('Failed: 404 notFound'));

    const cachedFiles = [
      {
        id: 'f1',
        google_file_id: 'gfile-1',
        name: 'cached.docx',
        owned_by_me: 1,
        is_trashed: 0,
        size: 256,
        mime_type: 'application/pdf',
      },
    ];
    // folderRow with is_synced=0 (so the idempotency check doesn't short-circuit)
    const folderRow = {
      id: 'df1',
      google_folder_id: FOLDER_ID,
      name: 'ProjectX',
      is_synced: 0,
      owned_by_me: 0,
      is_trashed: 0,
    };
    const { app, env } = buildApp({ d1Files: cachedFiles, folderRow });

    const res = await app.request(
      `/drives/${DRIVE_ID}/folders/${FOLDER_ID}/sync`,
      {
        method: 'POST',
        headers: { Cookie: `omnidrive_sid=${SESSION_ID}` },
      },
      env,
    );

    // Must be 200 (not 502).
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe('cached.docx');
  });
});
