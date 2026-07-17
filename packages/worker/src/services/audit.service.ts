import { generateId } from '../lib/id';

export class AuditService {
  constructor(private db: D1Database) {}

  async logEvent(params: {
    workspaceId: string | null;
    actorId: string;
    actionType: string;
    resourceId?: string | null;
    resourceName?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const id = generateId();
    await this.db.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, resource_id, resource_name, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      params.workspaceId,
      params.actorId,
      params.actionType,
      params.resourceId || null,
      params.resourceName || null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ).run();
  }

  async cleanupOldLogs(daysToKeep = 30) {
    await this.db.prepare(
      `DELETE FROM audit_logs WHERE created_at < datetime('now', '-' || ? || ' days')`
    ).bind(daysToKeep).run();
  }
}
