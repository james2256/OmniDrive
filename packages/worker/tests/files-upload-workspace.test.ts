import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from '../src/types/env';
import { filesRouter } from '../src/routes/files';

// These tests guard against IDOR / quota abuse on the upload endpoints:
// workspaceId arrives in the request body, so /upload/init and /upload/finalize
// must reject callers who are not editors of that workspace BEFORE touching
// its quota or attaching a file to it.

const SESSION_ID = 'test-session';
const USER_ID = 'user-1';

interface DbConfig {
  // role of USER_ID in the target workspace, or null for non-member
  role: string | null;
  drives?: Record<string, unknown>[];
  storageWrites: unknown[][];
}

// Minimal D1 mock: routes queries by SQL substring. Only the tables the upload
// handlers and authGuard touch are modelled.
function makeDb(config: DbConfig) {
  const now = Date.now();
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        async first() {
          if (sql.includes('FROM sessions')) {
            return {
              data: JSON.stringify({ userId: USER_ID }),
              expires_at: now + 100_000,
              touched_at: now, // fresh, so authGuard skips the TTL-extend write
            };
          }
          if (sql.includes('FROM workspace_members')) {
            return config.role ? { role: config.role } : null;
          }
          if (sql.includes('used_bytes FROM workspaces')) {
            return { used_bytes: 0 };
          }
          if (sql.includes('workspace_policies')) {
            return null; // no quota policy => checkQuota passes
          }
          if (sql.includes('FROM drive_accounts WHERE id')) {
            return config.drives?.[0] ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes('UPDATE workspaces SET used_bytes')) {
            config.storageWrites.push(binds);
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          if (sql.includes('FROM drive_accounts WHERE user_id')) {
            return { results: config.drives ?? [] };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
}

function makeApp(config: DbConfig) {
  const app = new Hono<AppContext>();
  app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
  app.route('/files', filesRouter);
  const env = {
    DB: makeDb(config),
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    TOKEN_ENCRYPTION_KEY: '',
  };
  const call = (path: string, body: unknown) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `omnidrive_sid=${SESSION_ID}` },
        body: JSON.stringify(body),
      },
      env as any
    );
  return { call, config };
}

describe('upload workspace membership guard', () => {
  it('finalize: non-member is rejected 403 and workspace storage is not changed', async () => {
    const { call, config } = makeApp({ role: null, storageWrites: [] });
    const res = await call('/files/upload/finalize', {
      googleFileId: 'gfile-1',
      driveAccountId: 'drive-1',
      workspaceId: 'ws-other',
    });
    expect(res.status).toBe(403);
    expect(config.storageWrites).toHaveLength(0);
  });

  it('finalize: viewer (below editor) is rejected 403', async () => {
    const { call, config } = makeApp({ role: 'viewer', storageWrites: [] });
    const res = await call('/files/upload/finalize', {
      googleFileId: 'gfile-1',
      driveAccountId: 'drive-1',
      workspaceId: 'ws-1',
    });
    expect(res.status).toBe(403);
    expect(config.storageWrites).toHaveLength(0);
  });

  it('init: non-member is rejected 403', async () => {
    const { call } = makeApp({ role: null, storageWrites: [] });
    const res = await call('/files/upload/init', {
      name: 'f.txt',
      mimeType: 'text/plain',
      size: 100,
      workspaceId: 'ws-other',
    });
    expect(res.status).toBe(403);
  });

  it('init: editor member passes the membership guard', async () => {
    // Editor clears the 403 guard; with no connected drives the handler then
    // fails later with 400 "No connected drives". The point is: NOT 403.
    const { call } = makeApp({ role: 'editor', storageWrites: [], drives: [] });
    const res = await call('/files/upload/init', {
      name: 'f.txt',
      mimeType: 'text/plain',
      size: 100,
      workspaceId: 'ws-1',
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
  });
});
