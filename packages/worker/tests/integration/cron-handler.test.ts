import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { ensureSchema, clearAllTables } from './helpers';
import worker from '../../src/index';
import type { SyncJobMessage } from '../../src/types/env';

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
  // AutomationEngine.processCronTrigger walks automation_rules and calls
  // Google Drive (trashFile for DELETE actions) — stub the whole class.
  processCronTrigger: vi.fn().mockResolvedValue(undefined),
  // runLifecycleExpiration + cleanupOrphanMultipartUploads hit Google Drive API —
  // stub them so the queue consumer's maintenance branch runs against real D1
  // with no network calls.
  runLifecycleExpiration: vi.fn().mockResolvedValue(undefined),
  cleanupOrphanMultipartUploads: vi.fn().mockResolvedValue(undefined),
  // syncDriveAccount hits Google Drive API (full delta/tree walk) — stub it
  // so the queue consumer's sync branch runs without network calls.
  syncDriveAccount: vi.fn().mockResolvedValue(undefined),
  // PolicyService.processAutoDeleteRetentionPolicies trashes files via Google
  // Drive API — stub the class so the maintenance branch runs clean.
  processAutoDeleteRetentionPolicies: vi.fn().mockResolvedValue(undefined),
}));

// Mock only the Google-API-hitting paths, preserving every other export so
// the rest of the module graph (drives.ts / folders.ts importing syncDriveAccount
// / syncDriveFolder; automations.ts importing IS_ACTIVE / IS_INACTIVE) still
// resolves at module-load time.
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

vi.mock('../../src/services/s3-lifecycle', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runLifecycleExpiration: mocks.runLifecycleExpiration,
    cleanupOrphanMultipartUploads: mocks.cleanupOrphanMultipartUploads,
  };
});

vi.mock('../../src/services/sync', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, syncDriveAccount: mocks.syncDriveAccount };
});

vi.mock('../../src/services/policy.service', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // `new PolicyService(env.DB, driveService)` constructs this. mockImplementation
    // must be a regular function (not arrow) so `new` can invoke it as a
    // constructor (matches the AutomationEngine mock pattern above).
    PolicyService: vi.fn().mockImplementation(function () {
      return { processAutoDeleteRetentionPolicies: mocks.processAutoDeleteRetentionPolicies };
    }),
  };
});

// `scheduled` and `queue` are optional on ExportedHandler — assert they exist.
const { scheduled, queue } = worker;
if (!scheduled) throw new Error('worker.scheduled is not exported');
if (!queue) throw new Error('worker.queue is not exported');

// Build mock env with SYNC_QUEUE — the cron handler dispatches all heavy work
// to the queue, so the mock must be present. The queue consumer itself never
// touches SYNC_QUEUE, but Env requires it; reusing the same factory keeps both
// handler test suites consistent.
function makeMockEnv() {
  return {
    ...env,
    SYNC_QUEUE: {
      send: vi.fn(async (_msg: unknown) => undefined),
      sendBatch: vi.fn(async () => undefined),
      metrics: vi.fn(async () => ({ backlogCount: 0, backlogBytes: 0 })),
    },
  } as any;
}

describe('Scheduled cron handler (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    mocks.processCronTrigger.mockClear();
    mocks.runLifecycleExpiration.mockClear();
    mocks.cleanupOrphanMultipartUploads.mockClear();
    mocks.syncDriveAccount.mockClear();
    mocks.processAutoDeleteRetentionPolicies.mockClear();
  });

  // vitest-pool-workers runs inside a Cloudflare Worker and sends mock state
  // back to the Node runner via structured clone. D1Database (stored as a call
  // arg when the handler passes env.DB to mocked services) can't be cloned —
  // clearing mock state in afterEach (not just beforeEach) ensures no
  // non-serializable args remain when vitest serializes the test result.
  afterEach(() => {
    mocks.processCronTrigger.mockClear();
    mocks.runLifecycleExpiration.mockClear();
    mocks.cleanupOrphanMultipartUploads.mockClear();
    mocks.syncDriveAccount.mockClear();
    mocks.processAutoDeleteRetentionPolicies.mockClear();
  });

  // Minimal ScheduledController + ExecutionContext. The handler ignores
  // `_event` (the cron string); ctx.waitUntil is only used by the mocked
  // AutomationEngine (which never calls it), so a no-op stub suffices.
  const scheduledController = {
    cron: '0 * * * *',
    scheduledTime: Date.now(),
  } as unknown as ScheduledController;
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

  it('dispatches drive sync + maintenance via sendBatch, then runs D1 cleanup', async () => {
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
    )
      .bind('cron-user', 'cronuser', '$2a$10$dummy', 1)
      .run();
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind('cron-drive', 'cron-user', 'cron@example.com', 'oauth')
      .run();

    const mockEnv = makeMockEnv();

    await scheduled(scheduledController, mockEnv, ctx);

    // 1 sendBatch call with 2 messages (1 sync + 1 maintenance) — a single
    // Queues API subrequest regardless of drive count.
    expect(mockEnv.SYNC_QUEUE.sendBatch).toHaveBeenCalledTimes(1);
    expect(mockEnv.SYNC_QUEUE.sendBatch).toHaveBeenCalledWith([
      { body: { type: 'sync', driveId: 'cron-drive' } },
      { body: { type: 'maintenance' } },
    ]);
    expect(mockEnv.SYNC_QUEUE.send).not.toHaveBeenCalled();
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

    await scheduled(scheduledController, makeMockEnv(), ctx);

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

    await scheduled(scheduledController, makeMockEnv(), ctx);

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

    await scheduled(scheduledController, makeMockEnv(), ctx);

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

  // Note: category_cache was replaced by file_storage_stats (delta-maintained,
  // no cron cleanup needed). The cron no longer touches storage stats.

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

    await scheduled(scheduledController, makeMockEnv(), ctx);

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
    await expect(scheduled(scheduledController, makeMockEnv(), ctx)).resolves.toBeUndefined();
  });
});

describe('Queue consumer (integration)', () => {
  // The queue consumer reads env.DB directly and constructs a driveService
  // via createDriveService — it never touches env.SYNC_QUEUE. All
  // Google-API-hitting services are mocked at module level (syncDriveAccount,
  // runLifecycleExpiration, cleanupOrphanMultipartUploads, AutomationEngine,
  // PolicyService) so the consumer runs against real D1 with no network calls.

  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
    mocks.syncDriveAccount.mockClear();
    mocks.runLifecycleExpiration.mockClear();
    mocks.cleanupOrphanMultipartUploads.mockClear();
    mocks.processCronTrigger.mockClear();
    mocks.processAutoDeleteRetentionPolicies.mockClear();
  });

  // Same rationale as the scheduled describe: clear mock state before
  // vitest-pool-workers serializes the test result across the Worker→Node
  // boundary (env.DB / driveService in mock.calls can't be structured-cloned).
  afterEach(() => {
    mocks.syncDriveAccount.mockClear();
    mocks.runLifecycleExpiration.mockClear();
    mocks.cleanupOrphanMultipartUploads.mockClear();
    mocks.processCronTrigger.mockClear();
    mocks.processAutoDeleteRetentionPolicies.mockClear();
  });

  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

  // Minimal Message<SyncJobMessage> — only body/ack/retry are exercised by
  // the handler; id/timestamp are required by the type but ignored.
  function makeMessage(body: SyncJobMessage) {
    return {
      body,
      id: `msg-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as Message<SyncJobMessage>;
  }

  function makeBatch(messages: Message<SyncJobMessage>[]) {
    return {
      messages,
      queue: 'sync-jobs',
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<SyncJobMessage>;
  }

  async function insertDrive(id: string, userId: string, email: string) {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind(userId, userId.replace(/-/g, ''), '$2a$10$dummy')
      .run();
    await env.DB.prepare(
      'INSERT INTO drive_accounts (id, user_id, email, type) VALUES (?, ?, ?, ?)',
    )
      .bind(id, userId, email, 'oauth')
      .run();
  }

  it('sync message: looks up the drive, calls syncDriveAccount, and acks', async () => {
    await insertDrive('queue-drive', 'queue-user', 'queue@example.com');

    const msg = makeMessage({ type: 'sync', driveId: 'queue-drive' });

    await queue(makeBatch([msg]), makeMockEnv(), ctx);

    expect(mocks.syncDriveAccount).toHaveBeenCalledTimes(1);
    // Args 2 (env.DB) and 3 (driveService) are non-serializable Cloudflare
    // bindings — assert via anything() to avoid passing them as expected
    // values (which would trigger chai.inspect on a D1Database).
    expect(mocks.syncDriveAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-drive' }),
      expect.anything(),
      expect.anything(),
    );
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('sync message for a drive deleted between enqueue and consume: acks without calling syncDriveAccount', async () => {
    // findById returns null → handler skips syncDriveAccount and still acks
    // (the job is done; there is nothing left to sync).
    const msg = makeMessage({ type: 'sync', driveId: 'gone' });

    await queue(makeBatch([msg]), makeMockEnv(), ctx);

    expect(mocks.syncDriveAccount).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('maintenance message: runs lifecycle + orphans + automations + retention, then acks', async () => {
    const msg = makeMessage({ type: 'maintenance' });

    await queue(makeBatch([msg]), makeMockEnv(), ctx);

    expect(mocks.runLifecycleExpiration).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupOrphanMultipartUploads).toHaveBeenCalledTimes(1);
    expect(mocks.processCronTrigger).toHaveBeenCalledTimes(1);
    expect(mocks.processAutoDeleteRetentionPolicies).toHaveBeenCalledTimes(1);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('retries (does not ack) when syncDriveAccount throws', async () => {
    await insertDrive('queue-drive-err', 'queue-user-err', 'queueerr@example.com');

    mocks.syncDriveAccount.mockRejectedValueOnce(new Error('Google API down'));

    const msg = makeMessage({ type: 'sync', driveId: 'queue-drive-err' });

    await queue(makeBatch([msg]), makeMockEnv(), ctx);

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
  });
});
