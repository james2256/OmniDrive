import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '../src/services/audit.service';

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

describe('AuditService', () => {
  let service: AuditService;
  let db: any;
  let runCalls: { sql: string; binds: any[] }[];
  let preparedStmts: { sql: string; binds: any[] }[];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = makeMockDb();
    db = mock.db;
    runCalls = mock.runCalls;
    preparedStmts = mock.preparedStmts;
    service = new AuditService(db);
  });

  describe('logEvent', () => {
    it('inserts an audit log row with all fields and JSON-stringified metadata', async () => {
      await service.logEvent({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'file.upload',
        resourceId: 'file-1',
        resourceName: 'doc.pdf',
        metadata: { size: 1024, mime: 'application/pdf' },
      });

      expect(runCalls).toHaveLength(1);
      const { sql, binds } = runCalls[0];
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

    it('defaults optional fields to null when omitted', async () => {
      await service.logEvent({
        workspaceId: null,
        actorId: 'user-2',
        actionType: 'user.login',
      });

      const { binds } = runCalls[0];
      expect(binds).toHaveLength(7);
      expect(binds[1]).toBeNull(); // workspaceId
      expect(binds[2]).toBe('user-2');
      expect(binds[3]).toBe('user.login');
      expect(binds[4]).toBeNull(); // resourceId (undefined || null)
      expect(binds[5]).toBeNull(); // resourceName (undefined || null)
      expect(binds[6]).toBeNull(); // metadata (undefined → null, no JSON.stringify)
    });

    it('JSON-stringifies empty metadata object to "{}"', async () => {
      await service.logEvent({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'ws.create',
        metadata: {},
      });
      expect(runCalls[0].binds[6]).toBe('{}');
    });

    it('passes resourceId/resourceName through as null when explicitly null', async () => {
      await service.logEvent({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'a',
        resourceId: null,
        resourceName: null,
      });
      const { binds } = runCalls[0];
      expect(binds[4]).toBeNull();
      expect(binds[5]).toBeNull();
    });

    it('invokes .run() on the prepared statement (not just prepare/bind)', async () => {
      await service.logEvent({
        workspaceId: null,
        actorId: 'u1',
        actionType: 'a',
      });
      expect(runCalls).toHaveLength(1);
      expect(preparedStmts).toHaveLength(1);
    });
  });

  describe('prepareLogEvent', () => {
    it('returns a bound prepared statement without running it', () => {
      const stmt = service.prepareLogEvent({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'file.delete',
        resourceId: 'file-9',
      });

      // Returned object is the bound executor (has run/first/all).
      expect(stmt).toBeTruthy();
      expect(typeof (stmt as any).run).toBe('function');
      // prepare + bind each called once.
      expect(db.prepare).toHaveBeenCalledTimes(1);
      expect(preparedStmts).toHaveLength(1);
      // .run() NOT called yet — caller defers to db.batch().
      expect(runCalls).toHaveLength(0);
    });

    it('records correct binds for the prepared statement', () => {
      service.prepareLogEvent({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actionType: 'file.delete',
        resourceId: 'file-9',
      });
      const { sql, binds } = preparedStmts[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(binds[1]).toBe('ws-1');
      expect(binds[2]).toBe('user-1');
      expect(binds[3]).toBe('file.delete');
      expect(binds[4]).toBe('file-9');
    });

    it('enables batch insert of multiple log events in one db.batch() call', async () => {
      const stmt1 = service.prepareLogEvent({
        workspaceId: 'ws-1',
        actorId: 'u1',
        actionType: 'a',
      });
      const stmt2 = service.prepareLogEvent({
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
      const stmt1 = service.prepareLogEvent({
        workspaceId: null,
        actorId: 'u1',
        actionType: 'a',
      });
      const stmt2 = service.prepareLogEvent({
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
      await service.cleanupOldLogs();
      expect(runCalls).toHaveLength(1);
      const { sql, binds } = runCalls[0];
      expect(sql).toContain('DELETE FROM audit_logs');
      expect(sql).toContain("datetime('now', '-' || ? || ' days')");
      expect(binds).toEqual([30]);
    });

    it('daysToKeep=30 — explicit pass-through bind', async () => {
      await service.cleanupOldLogs(30);
      expect(runCalls[0].binds).toEqual([30]);
      expect(runCalls[0].sql).toContain("datetime('now', '-' || ? || ' days')");
    });

    it('daysToKeep=7 — custom retention window', async () => {
      await service.cleanupOldLogs(7);
      expect(runCalls[0].binds).toEqual([7]);
    });

    it('daysToKeep=0 — edge case: deletes all rows older than now', async () => {
      // SQLite evaluates datetime('now', '-0 days') = datetime('now').
      // All rows with created_at < now are deleted.
      await service.cleanupOldLogs(0);
      expect(runCalls[0].binds).toEqual([0]);
      // SQL is parameterized — the literal '0' is NOT in the SQL, only the bind placeholder.
      expect(runCalls[0].sql).toContain("'-' || ? || ' days'");
    });

    it('uses parameterized SQL — daysToKeep is a bind param, not interpolated', async () => {
      await service.cleanupOldLogs(30);
      // The literal '30' is NOT interpolated into the SQL string.
      expect(runCalls[0].sql).not.toContain('-30 days');
      expect(runCalls[0].sql).toContain('?');
    });

    it('uses a single bind parameter (no off-by-one in bind count)', async () => {
      await service.cleanupOldLogs(90);
      expect(runCalls[0].binds).toHaveLength(1);
      expect(runCalls[0].binds[0]).toBe(90);
    });
  });
});
