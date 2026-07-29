import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../../src/index';
import { ensureSchema, clearAllTables } from './helpers';
import { hashPassword } from '../../src/lib/password';
import type { SessionData } from '../../src/types/env';

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

const ORIGIN = 'http://localhost:5173';

async function insertUserAndSession(username: string): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${username}`;
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, username, passwordHash, 1)
    .run();

  const now = Date.now();
  const sessionData: SessionData = {
    userId,
    username,
    email: null,
    name: username,
    avatarUrl: null,
    role: 'super_admin',
    createdAt: now,
  };
  const sessionId = `session-${username}-${now}`;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sessionId, userId, JSON.stringify(sessionData), now + 7 * 24 * 60 * 60 * 1000, now)
    .run();

  return { userId, cookie: `omnidrive_sid=${sessionId}` };
}

describe('Automations routes (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // ─── Auth ───

  it('GET / requires authentication (401 without cookie)', async () => {
    const res = await app.request('/api/automations', { headers: { Origin: ORIGIN } }, env);
    expect(res.status).toBe(401);
  });

  it('POST / requires authentication (401 without cookie)', async () => {
    const res = await app.request(
      '/api/automations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ name: 'rule', trigger_type: 'event' }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('PATCH /:id/toggle requires authentication (401 without cookie)', async () => {
    const res = await app.request(
      '/api/automations/rule-1/toggle',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ is_active: false }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  // ─── GET / (list) ───

  it('GET / returns empty list for a user with no rules', async () => {
    const { cookie } = await insertUserAndSession('alice');
    const res = await app.request(
      '/api/automations',
      { headers: { Cookie: cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: unknown[] };
    expect(body.rules).toEqual([]);
  });

  it('GET / returns only the authenticated user rules (user isolation)', async () => {
    const alice = await insertUserAndSession('alice');
    const bob = await insertUserAndSession('bob');

    // Seed a rule for each user directly via D1
    await env.DB.prepare(
      'INSERT INTO automation_rules (id, user_id, name, trigger_type, is_active) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('rule-alice', alice.userId, 'Alice rule', 'event', 1)
      .run();
    await env.DB.prepare(
      'INSERT INTO automation_rules (id, user_id, name, trigger_type, is_active) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('rule-bob', bob.userId, 'Bob rule', 'cron', 1)
      .run();

    const res = await app.request(
      '/api/automations',
      { headers: { Cookie: alice.cookie, Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: { id: string; name: string }[] };
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].id).toBe('rule-alice');
    expect(body.rules[0].name).toBe('Alice rule');
  });

  // ─── POST / (create) ───

  it('POST / creates a rule and returns 201 with an id', async () => {
    const { userId, cookie } = await insertUserAndSession('carol');

    const res = await app.request(
      '/api/automations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          name: 'Move PDFs',
          trigger_type: 'event',
          trigger_config: { source: 'upload' },
          conditions: [{ field: 'name', operator: 'endswith', value: '.pdf' }],
          actions: [{ type: 'move', targetFolderId: 'folder-1' }],
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBeTruthy();

    // Row persisted with serialized config/conditions/actions
    const row = await env.DB.prepare(
      'SELECT user_id, name, trigger_type, trigger_config, conditions, actions, is_active FROM automation_rules WHERE id = ?',
    )
      .bind(body.id)
      .first<{
        user_id: string;
        name: string;
        trigger_type: string;
        trigger_config: string;
        conditions: string;
        actions: string;
        is_active: number;
      }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.name).toBe('Move PDFs');
    expect(row?.trigger_type).toBe('event');
    expect(row?.is_active).toBe(1); // defaults to active
    expect(JSON.parse(row?.trigger_config ?? '{}')).toEqual({ source: 'upload' });
    expect(JSON.parse(row?.conditions ?? '[]')).toHaveLength(1);
    expect(JSON.parse(row?.actions ?? '[]')).toHaveLength(1);
  });

  it('POST / with empty optional arrays stores [] (not undefined)', async () => {
    const { cookie } = await insertUserAndSession('dave');

    const res = await app.request(
      '/api/automations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Bare rule', trigger_type: 'cron' }),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const row = await env.DB.prepare(
      'SELECT conditions, actions FROM automation_rules WHERE id = ?',
    )
      .bind(body.id)
      .first<{ conditions: string; actions: string }>();
    // The route coerces missing arrays to [] before JSON.stringify
    expect(row?.conditions).toBe('[]');
    expect(row?.actions).toBe('[]');
  });

  it('POST / rejects empty name (zod min(1) → 400)', async () => {
    const { cookie } = await insertUserAndSession('erin');

    const res = await app.request(
      '/api/automations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: '', trigger_type: 'event' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('name');
  });

  it('POST / rejects missing name (zod type check → 400)', async () => {
    const { cookie } = await insertUserAndSession('erin2');

    const res = await app.request(
      '/api/automations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ trigger_type: 'event' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    // zod's type check fires before the min() custom message, so the error
    // reports the type mismatch rather than the field name.
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('string');
  });

  it('POST / rejects invalid trigger_type (zod → 400)', async () => {
    const { cookie } = await insertUserAndSession('frank');

    const res = await app.request(
      '/api/automations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Bad', trigger_type: 'webhook' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('trigger_type');
  });

  // ─── PATCH /:id/toggle ───

  it('PATCH /:id/toggle deactivates an active rule (204)', async () => {
    const { userId, cookie } = await insertUserAndSession('grace');
    await env.DB.prepare(
      'INSERT INTO automation_rules (id, user_id, name, trigger_type, is_active) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('rule-grace', userId, 'Grace rule', 'event', 1)
      .run();

    const res = await app.request(
      '/api/automations/rule-grace/toggle',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ is_active: false }),
      },
      env,
    );

    expect(res.status).toBe(204);
    const row = await env.DB.prepare('SELECT is_active FROM automation_rules WHERE id = ?')
      .bind('rule-grace')
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(0);
  });

  it('PATCH /:id/toggle reactivates an inactive rule (204)', async () => {
    const { userId, cookie } = await insertUserAndSession('heidi');
    await env.DB.prepare(
      'INSERT INTO automation_rules (id, user_id, name, trigger_type, is_active) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('rule-heidi', userId, 'Heidi rule', 'cron', 0)
      .run();

    const res = await app.request(
      '/api/automations/rule-heidi/toggle',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ is_active: true }),
      },
      env,
    );

    expect(res.status).toBe(204);
    const row = await env.DB.prepare('SELECT is_active FROM automation_rules WHERE id = ?')
      .bind('rule-heidi')
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(1);
  });

  it('PATCH /:id/toggle on a nonexistent rule → 404', async () => {
    const { cookie } = await insertUserAndSession('ivan');

    const res = await app.request(
      '/api/automations/rule-missing/toggle',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ is_active: false }),
      },
      env,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('PATCH /:id/toggle on another user rule → 404 (no cross-user toggle)', async () => {
    const alice = await insertUserAndSession('alice2');
    const bob = await insertUserAndSession('bob2');
    await env.DB.prepare(
      'INSERT INTO automation_rules (id, user_id, name, trigger_type, is_active) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('rule-bob2', bob.userId, 'Bob rule', 'event', 1)
      .run();

    const res = await app.request(
      '/api/automations/rule-bob2/toggle',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: alice.cookie, Origin: ORIGIN },
        body: JSON.stringify({ is_active: false }),
      },
      env,
    );

    // toggleActive scopes by user_id → 0 rows changed → 404
    expect(res.status).toBe(404);
  });

  it('PATCH /:id/toggle rejects missing is_active (zod → 400)', async () => {
    const { userId, cookie } = await insertUserAndSession('judy');
    await env.DB.prepare(
      'INSERT INTO automation_rules (id, user_id, name, trigger_type, is_active) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('rule-judy', userId, 'Judy rule', 'event', 1)
      .run();

    const res = await app.request(
      '/api/automations/rule-judy/toggle',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});
