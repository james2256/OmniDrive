import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { ensureSchema, clearAllTables } from './helpers';
import worker from '../../src/index';

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

// ─── vi.hoisted keeps mock references available inside vi.mock factories ───
// vi.mock is hoisted above imports, so plain consts aren't in scope yet.
const mocks = vi.hoisted(() => ({
  // runScheduledSync iterates drive_accounts and calls Google Drive API —
  // stub it so the cron handler runs against real D1 with no network calls.
  runScheduledSync: vi.fn().mockResolvedValue(undefined),
  // AutomationEngine.processCronTrigger walks automation_rules and calls
  // Google Drive (trashFile for DELETE actions) — stub the whole class.
  processCronTrigger: vi.fn().mockResolvedValue(undefined),
}));

// Mock only the two Google-API-hitting paths, preserving every other export so
// the rest of the module graph (drives.ts / folders.ts importing syncDriveAccount
// / syncDriveFolder; automations.ts importing IS_ACTIVE / IS_INACTIVE) still
// resolves at module-load time.
vi.mock('../../src/services/sync', async (importOriginal) => {
  // importOriginal is typed by vitest to resolve to the real module's
  // namespace, so no `typeof import()` cast is needed (and that form is
  // banned by @typescript-eslint/consistent-type-imports).
  const actual = await importOriginal();
  return { ...actual, runScheduledSync: mocks.runScheduledSync };
});

vi.mock('../../src/services/automation.service', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // `new AutomationEngine(env, driveService)` constructs this. mockImplementation
    // must be a regular function (not arrow) so `new` can invoke it as a
    // constructor; returning an object overrides `this` so the instance is
    // { processCronTrigger }.
    AutomationEngine: vi.fn().mockImplementation(function () {
      return { processCronTrigger: mocks.processCronTrigger };
    }),
  };
});

// `scheduled` is optional on ExportedHandler — assert it exists (index.ts
// always exports it) so the call site stays type-safe.
const { scheduled } = worker;
if (!scheduled) throw new Error('worker.scheduled is not exported');

describe('Scheduled cron handler (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    mocks.runScheduledSync.mockClear();
    mocks.processCronTrigger.mockClear();
  });

  // Minimal ScheduledController + ExecutionContext. The handler ignores
  // `_event` (the cron string); ctx.waitUntil is only used by the mocked
  // AutomationEngine (which never calls it), so a no-op stub suffices.
  const scheduledController = {
    cron: '0 * * * *',
    scheduledTime: Date.now(),
  } as unknown as ScheduledController;
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

  it('runs all heavy operations in sequence and returns', async () => {
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
    )
      .bind('cron-user', 'cronuser', '$2a$10$dummy', 1)
      .run();
    // type='other' keeps this row out of runScheduledSync's
    // `WHERE type IN ('oauth','service_account')` filter — a belt-and-suspenders
    // guard in case the mock is ever removed.
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind('cron-drive', 'cron-user', 'cron@example.com', 'other')
      .run();

    await scheduled(scheduledController, env, ctx);

    expect(mocks.runScheduledSync).toHaveBeenCalledTimes(1);
    expect(mocks.runScheduledSync).toHaveBeenCalledWith(env);
    expect(mocks.processCronTrigger).toHaveBeenCalledTimes(1);
    expect(mocks.processCronTrigger).toHaveBeenCalledWith(ctx);
  });

  it('deletes expired sessions and keeps valid ones', async () => {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind('cron-user-sess', 'cronsess', '$2a$10$dummy')
      .run();

    const now = Date.now();
    // Expired session (expires_at in the past)
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('sess-expired', 'cron-user-sess', '{}', now - 1000, now - 1000)
      .run();
    // Valid session (expires_at in the future)
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('sess-valid', 'cron-user-sess', '{}', now + 7 * 24 * 60 * 60 * 1000, now)
      .run();

    await scheduled(scheduledController, env, ctx);

    const expired = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
      .bind('sess-expired')
      .first();
    expect(expired).toBeNull();

    const valid = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
      .bind('sess-valid')
      .first();
    expect(valid).not.toBeNull();
  });

  it('deletes stale oauth_states older than 10 minutes', async () => {
    const now = Date.now();
    // Stale: created 20 min ago (beyond the 10-min TTL)
    await env.DB.prepare(
      'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('state-stale', 'verifier', 'u1', now - 20 * 60 * 1000)
      .run();
    // Fresh: created now
    await env.DB.prepare(
      'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('state-fresh', 'verifier', 'u1', now)
      .run();

    await scheduled(scheduledController, env, ctx);

    const stale = await env.DB.prepare('SELECT state FROM oauth_states WHERE state = ?')
      .bind('state-stale')
      .first();
    expect(stale).toBeNull();

    const fresh = await env.DB.prepare('SELECT state FROM oauth_states WHERE state = ?')
      .bind('state-fresh')
      .first();
    expect(fresh).not.toBeNull();
  });

  it('deletes stale quota_cache entries older than 1 hour and keeps fresh ones', async () => {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind('cron-user-q', 'cronq', '$2a$10$dummy')
      .run();
    // Two drives: one carries a stale cache, the other a fresh cache.
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind('cron-drive-stale', 'cron-user-q', 'stale@example.com', 'other')
      .run();
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind('cron-drive-fresh', 'cron-user-q', 'fresh@example.com', 'other')
      .run();

    const now = Date.now();
    // Stale: updated 2h ago (beyond the 1h TTL)
    await env.DB.prepare(
      'INSERT INTO quota_cache (drive_account_id, payload, updated_at) VALUES (?, ?, ?)',
    )
      .bind('cron-drive-stale', '{}', now - 2 * 60 * 60 * 1000)
      .run();
    // Fresh: updated now
    await env.DB.prepare(
      'INSERT INTO quota_cache (drive_account_id, payload, updated_at) VALUES (?, ?, ?)',
    )
      .bind('cron-drive-fresh', '{"f":1}', now)
      .run();

    await scheduled(scheduledController, env, ctx);

    const stale = await env.DB.prepare('SELECT payload FROM quota_cache WHERE drive_account_id = ?')
      .bind('cron-drive-stale')
      .first();
    expect(stale).toBeNull();

    const fresh = await env.DB.prepare<{ payload: string }>(
      'SELECT payload FROM quota_cache WHERE drive_account_id = ?',
    )
      .bind('cron-drive-fresh')
      .first();
    expect(fresh).not.toBeNull();
    expect(fresh?.payload).toBe('{"f":1}');
  });

  // Note: category_cache cron cleanup was removed — the cache now lives until
  // explicitly invalidated by a file mutation (upload/trash/delete/sync), not
  // purged hourly by the cron. See FileRepository.invalidateCategoryCache.

  it('cleans up audit logs older than 30 days and keeps recent ones', async () => {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind('cron-user-a', 'crona', '$2a$10$dummy')
      .run();

    // Old audit log: 35 days ago → deleted by cleanupOldLogs(30).
    // `datetime('now','-35 days')` is embedded as a SQL expression (not a
    // bound literal) so SQLite evaluates it to a real timestamp; binding the
    // string "datetime('now','-35 days')" would store it verbatim.
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, created_at)
       VALUES (?, ?, ?, ?, datetime('now','-35 days'))`,
    )
      .bind('audit-old', null, 'cron-user-a', 'test.action')
      .run();
    // Fresh audit log: now (schema default) → remains
    await env.DB.prepare(
      'INSERT INTO audit_logs (id, workspace_id, actor_id, action_type) VALUES (?, ?, ?, ?)',
    )
      .bind('audit-fresh', null, 'cron-user-a', 'test.action')
      .run();

    await scheduled(scheduledController, env, ctx);

    const old = await env.DB.prepare('SELECT id FROM audit_logs WHERE id = ?')
      .bind('audit-old')
      .first();
    expect(old).toBeNull();

    const fresh = await env.DB.prepare('SELECT id FROM audit_logs WHERE id = ?')
      .bind('audit-fresh')
      .first();
    expect(fresh).not.toBeNull();
  });

  it('does not throw when D1 tables are empty (no-op cleanups)', async () => {
    await expect(scheduled(scheduledController, env, ctx)).resolves.toBeUndefined();
    expect(mocks.runScheduledSync).toHaveBeenCalledTimes(1);
    expect(mocks.processCronTrigger).toHaveBeenCalledTimes(1);
  });
});
