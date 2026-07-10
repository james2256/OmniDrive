import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from '../src/types/env';
import { filesRouter } from '../src/routes/files';

const SESSION_ID = 'test-session';
const USER_ID = 'user-1';
const FILE_ID = 'file-1';
const FOLDER_ID = 'folder-ws-1';
const WORKSPACE_ID = 'ws-1';

function makeDb() {
  const now = Date.now();
  let updateBinds: unknown[] = [];

  return {
    updateBinds: () => updateBinds,
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
              touched_at: now,
            };
          }
          if (sql.includes('FROM workspace_folders')) {
            return { workspace_id: WORKSPACE_ID };
          }
          return null;
        },
        async run() {
          if (sql.includes('UPDATE files SET workspace_folder_id')) {
            updateBinds = binds;
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

describe('PATCH /files/:id/move', () => {
  it('accepts workspaceFolderId and updates workspace_folder_id', async () => {
    const db = makeDb();
    const app = new Hono<AppContext>();
    app.onError((err: { message: string; status?: number }, c) =>
      c.json({ error: err.message }, err.status || 500),
    );
    app.route('/files', filesRouter);

    const res = await app.request(`/files/${FILE_ID}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `omnidrive_sid=${SESSION_ID}`,
      },
      body: JSON.stringify({ workspaceFolderId: FOLDER_ID }),
    }, {
      DB: db,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      JWT_SECRET: 'test-secret',
      TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
      FRONTEND_URL: 'http://localhost',
      WORKER_URL: 'http://localhost',
    } as AppContext['Bindings']);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(db.updateBinds()).toEqual([FOLDER_ID, WORKSPACE_ID, FILE_ID, USER_ID]);
  });
});