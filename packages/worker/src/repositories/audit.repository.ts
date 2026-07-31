import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';

/**
 * Data access layer for the `audit_logs` table — INSERT + retention cleanup.
 *
 * Audit-log READS live elsewhere (cross-table JOINs that belong with their
 * consuming domain): `AdminRepository.findRecentAuditLogs` (admin view) and
 * `WorkspaceRepository.findAuditLogs` (workspace view). Cascade mutations
 * (`UPDATE … SET workspace_id = NULL`, `DELETE … WHERE actor_id = ?`) live in
 * `WorkspaceRepository.delete` and `AdminRepository.deleteUser`. This repo
 * owns only the write path + the cron-driven age cleanup — the two operations
 * that are pure `audit_logs` SQL with no foreign JOIN.
 */
export class AuditRepository {
  constructor(private db: D1Database) {}

  /**
   * Build a prepared audit-log INSERT statement (not run) for batch composition.
   * Used by `WorkspaceService.addMember` / `removeMember` to write the audit
   * row atomically in the same `db.batch([...])` as the membership change, so a
   * crash mid-op never leaves a member change without its audit trail (or vice-versa).
   *
   * `metadata` is JSON-stringified; undefined → null (no `"undefined"` string).
   */
  insertLogStmt(params: {
    workspaceId: string | null;
    actorId: string;
    actionType: string;
    resourceId?: string | null;
    resourceName?: string | null;
    metadata?: Record<string, unknown>;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, resource_id, resource_name, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        generateId(),
        params.workspaceId,
        params.actorId,
        params.actionType,
        params.resourceId ?? null,
        params.resourceName ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      );
  }

  /**
   * DELETE audit logs older than `daysToKeep` days. Run by the scheduled cron.
   * The cutoff is computed in SQL via `datetime('now', '-' || ? || ' days')` so
   * the bound value is a plain integer (not interpolated into the SQL string).
   */
  cleanupOldLogs(daysToKeep = 30) {
    return this.db
      .prepare(`DELETE FROM audit_logs WHERE created_at < datetime('now', '-' || ? || ' days')`)
      .bind(daysToKeep)
      .run();
  }
}
