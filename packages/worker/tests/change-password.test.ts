import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { AppContext } from '../src/types/env';
import { authRouter } from '../src/routes/auth';
import { hashPassword } from '../src/lib/password';

const SESSION_ID = 'sess-1';
const USER_ID = 'user-1';
const OLD_PASSWORD = 'OldPass123';
const NEW_PASSWORD = 'NewPass456';

interface DbState {
  passwordHash: string;
  deletedSessions: string[];
  updatedHash: string | null;
}

function makeDb(state: DbState) {
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
              data: JSON.stringify({ userId: USER_ID, username: 'admin' }),
              expires_at: now + 100_000,
              touched_at: now,
            };
          }
          if (sql.includes('password_hash FROM users')) {
            return { password_hash: state.passwordHash };
          }
          return null;
        },
        async run() {
          if (sql.includes('UPDATE users SET password_hash')) {
            state.updatedHash = binds[0] as string;
          }
          if (sql.includes('DELETE FROM sessions WHERE user_id') && sql.includes('AND id !=')) {
            state.deletedSessions.push(`others-except-${binds[1]}`);
          }
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  };
}

async function makeApp(state: DbState) {
  state.passwordHash = await hashPassword(OLD_PASSWORD);
  const app = new Hono<AppContext>();
  app.onError((err: any, c) => c.json({ error: err.message }, err.status || 500));
  app.route('/auth', authRouter);
  const env = { DB: makeDb(state) };
  const call = (body: unknown) =>
    app.request(
      '/auth/change-password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `omnidrive_sid=${SESSION_ID}` },
        body: JSON.stringify(body),
      },
      env as any
    );
  return { call, state };
}

describe('POST /auth/change-password', () => {
  it('rejects wrong current password', async () => {
    const { call, state } = await makeApp({
      passwordHash: '',
      deletedSessions: [],
      updatedHash: null,
    });
    const res = await call({ currentPassword: 'WrongPass1', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(state.updatedHash).toBeNull();
  });

  it('rejects weak new password', async () => {
    const { call, state } = await makeApp({
      passwordHash: '',
      deletedSessions: [],
      updatedHash: null,
    });
    const res = await call({ currentPassword: OLD_PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(state.updatedHash).toBeNull();
  });

  it('updates hash and revokes other sessions', async () => {
    const { call, state } = await makeApp({
      passwordHash: '',
      deletedSessions: [],
      updatedHash: null,
    });
    const res = await call({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(state.updatedHash).toBeTruthy();
    expect(state.updatedHash).not.toBe(state.passwordHash);
    expect(state.deletedSessions).toContain(`others-except-${SESSION_ID}`);
  });
});
