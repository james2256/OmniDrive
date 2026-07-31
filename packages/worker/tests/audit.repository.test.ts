import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRepository } from '../src/repositories/audit.repository';

// ─── Mock D1 (chainable prepare/bind/run) ──────────────────────

function makeMockDb() {
  const preparedStmts: { sql: string; binds: any[] }[] = [];
  const runCalls: { sql: string; binds: any[] }[] = [];

  const db: any = {
    prepare: vi.fn((sql: string) => {
      const makeBound = (binds: any[]) => ({
        run: vi.fn(async () => {
          runCalls.push({ sql, binds });
          return { success: true, meta: { changes: 1 } };
        }),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
      });
      return {
        bind: vi.fn((...binds: any[]) => {
          preparedStmts.push({ sql, binds });
          return makeBound(binds);
        }),
        ...makeBound([]),
      };
    }),
    batch: vi.fn(async (stmts: any[]) =>
      stmts.map(() => ({ success: true, meta: { changes: 1 } })),
    ),
  };

  return { db, preparedStmts, runCalls };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('AuditRepository', () => {
  let repo: AuditRepository;
  let db: any;
  let runCalls: { sql: string; binds: any[] }[];
  let preparedStmts: { sql: string; binds: any[] }[];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = makeMockDb();
    db = mock.db;
    runCalls = mock.runCalls;
    preparedStmts = mock.preparedStmts;
    repo = new AuditRepository(db);
  });

  describe('insertLogStmt', () => {
    it('builds an INSERT stmt with all fields and JSON-stringified metadata (not run)', () => {
      const stmt = repo.insertLogStmt({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'file.upload',
        resourceId: 'file-1',
        resourceName: 'doc.pdf',
        metadata: { size: 1024, mime: 'application/pdf' },
      });

      // Returned object is the bound executor (has run/first/all for batch composition).
      expect(stmt).toBeTruthy();
      expect(typeof (stmt as any).run).toBe('function');
      // prepare + bind each called once.
      expect(db.prepare).toHaveBeenCalledTimes(1);
      expect(preparedStmts).toHaveLength(1);
      // .run() NOT called yet — caller defers to db.batch().
      expect(runCalls).toHaveLength(0);

      const { sql, binds } = preparedStmts[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(sql).toContain('workspace_id');
      expect(sql).toContain('actor_id');
      expect(sql).toContain('action_type');
      expect(sql).toContain('resource_id');
      expect(sql).toContain('resource_name');
      expect(sql).toContain('metadata');
      // 7 binds: id, workspaceId, actorId, actionType, resourceId, resourceName, metadata(JSON).
      expect(binds).toHaveLength(7);
      expect(binds[0]).toMatch(UUID_RE); // generated id
      expect(binds[1]).toBe('ws-1');
      expect(binds[2]).toBe('user-1');
      expect(binds[3]).toBe('file.upload');
      expect(binds[4]).toBe('file-1');
      expect(binds[5]).toBe('doc.pdf');
      expect(binds[6]).toBe(JSON.stringify({ size: 1024, mime: 'application/pdf' }));
    });

    it('defaults optional fields to null when omitted', () => {
      repo.insertLogStmt({
        workspaceId: null,
        actorId: 'user-2',
        actionType: 'user.login',
      });

      const { binds } = preparedStmts[0];
      expect(binds).toHaveLength(7);
      expect(binds[1]).toBeNull(); // workspaceId
      expect(binds[2]).toBe('user-2');
      expect(binds[3]).toBe('user.login');
      expect(binds[4]).toBeNull(); // resourceId (undefined ?? null)
      expect(binds[5]).toBeNull(); // resourceName (undefined ?? null)
      expect(binds[6]).toBeNull(); // metadata (undefined → null, no JSON.stringify)
    });

    it('JSON-stringifies empty metadata object to "{}"', () => {
      repo.insertLogStmt({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'ws.create',
        metadata: {},
      });
      expect(preparedStmts[0].binds[6]).toBe('{}');
    });

    it('passes resourceId/resourceName through as null when explicitly null', () => {
      repo.insertLogStmt({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'a',
        resourceId: null,
        resourceName: null,
      });
      const { binds } = preparedStmts[0];
      expect(binds[4]).toBeNull();
      expect(binds[5]).toBeNull();
    });

    it('invokes .run() on the prepared statement when the caller runs it', async () => {
      // insertLogStmt returns the Stmt; the caller decides .run() vs db.batch([...]).
      await repo
        .insertLogStmt({
          workspaceId: null,
          actorId: 'u1',
          actionType: 'a',
        })
        .run();
      expect(runCalls).toHaveLength(1);
      expect(preparedStmts).toHaveLength(1);
    });

    it('enables batch insert of multiple log events in one db.batch() call', async () => {
      const stmt1 = repo.insertLogStmt({
        workspaceId: 'ws-1',
        actorId: 'u1',
        actionType: 'a',
      });
      const stmt2 = repo.insertLogStmt({
        workspaceId: 'ws-1',
        actorId: 'u2',
        actionType: 'b',
      });
      await db.batch([stmt1, stmt2]);

      expect(db.batch).toHaveBeenCalledTimes(1);
      expect(db.batch).toHaveBeenCalledWith([stmt1, stmt2]);
      // Neither stmt was run individually — batch owns the execution.
      expect(runCalls).toHaveLength(0);
    });

    it('generates a fresh UUID id for each prepared statement', () => {
      const stmt1 = repo.insertLogStmt({
        workspaceId: null,
        actorId: 'u1',
        actionType: 'a',
      });
      const stmt2 = repo.insertLogStmt({
        workspaceId: null,
        actorId: 'u2',
        actionType: 'b',
      });
      const id1 = preparedStmts[0].binds[0];
      const id2 = preparedStmts[1].binds[0];
      expect(id1).toMatch(UUID_RE);
      expect(id2).toMatch(UUID_RE);
      expect(id1).not.toBe(id2);
      // Touch stmts to silence unused-var (the stmts are passed via binds).
      expect(stmt1).toBeTruthy();
      expect(stmt2).toBeTruthy();
    });
  });

  describe('cleanupOldLogs', () => {
    it('default daysToKeep=30 — deletes logs older than 30 days', async () => {
      await repo.cleanupOldLogs();
      expect(runCalls).toHaveLength(1);
      const { sql, binds } = runCalls[0];
      expect(sql).toContain('DELETE FROM audit_logs');
      expect(sql).toContain("datetime('now', '-' || ? || ' days')");
      expect(binds).toEqual([30]);
    });

    it('daysToKeep=30 — explicit pass-through bind', async () => {
      await repo.cleanupOldLogs(30);
      expect(runCalls[0].binds).toEqual([30]);
      expect(runCalls[0].sql).toContain("datetime('now', '-' || ? || ' days')");
    });

    it('daysToKeep=7 — custom retention window', async () => {
      await repo.cleanupOldLogs(7);
      expect(runCalls[0].binds).toEqual([7]);
    });

    it('daysToKeep=0 — edge case: deletes all rows older than now', async () => {
      // SQLite evaluates datetime('now', '-0 days') = datetime('now').
      // All rows with created_at < now are deleted.
      await repo.cleanupOldLogs(0);
      expect(runCalls[0].binds).toEqual([0]);
      // SQL is parameterized — the literal '0' is NOT in the SQL, only the bind placeholder.
      expect(runCalls[0].sql).toContain("'-' || ? || ' days'");
    });

    it('uses parameterized SQL — daysToKeep is a bind param, not interpolated', async () => {
      await repo.cleanupOldLogs(30);
      // The literal '30' is NOT interpolated into the SQL string.
      expect(runCalls[0].sql).not.toContain('-30 days');
      expect(runCalls[0].sql).toContain('?');
    });

    it('uses a single bind parameter (no off-by-one in bind count)', async () => {
      await repo.cleanupOldLogs(90);
      expect(runCalls[0].binds).toHaveLength(1);
      expect(runCalls[0].binds[0]).toBe(90);
    });
  });
});
