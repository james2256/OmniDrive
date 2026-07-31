import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';

/**
 * Data access layer for the `automation_rules` table.
 *
 * All SQL for automation rules lives here — routes never write inline SQL.
 */
export class AutomationRepository {
  constructor(private db: D1Database) {}

  /** Find all automation rules for a user. */
  findAllByUser(userId: string) {
    return this.db.prepare('SELECT * FROM automation_rules WHERE user_id = ?').bind(userId).all();
  }

  /** Insert a new automation rule. */
  insert(params: {
    id: string;
    userId: string;
    name: string;
    triggerType: string;
    triggerConfig: string;
    conditions: string;
    actions: string;
  }) {
    return this.db
      .prepare(
        'INSERT INTO automation_rules (id, user_id, name, trigger_type, trigger_config, conditions, actions) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        params.id,
        params.userId,
        params.name,
        params.triggerType,
        params.triggerConfig,
        params.conditions,
        params.actions,
      )
      .run();
  }

  /** Toggle the active state of a rule. Returns true if a row was updated. */
  async toggleActive(ruleId: string, userId: string, isActive: number): Promise<boolean> {
    const { meta } = await this.db
      .prepare(
        'UPDATE automation_rules SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      )
      .bind(isActive, ruleId, userId)
      .run();
    return meta.changes > 0;
  }

  /**
   * Return a prepared automation_logs INSERT statement (not run) for batch
   * operations. Used by AutomationEngine to log success/error per file.
   */
  insertLogStmt(ruleId: string, status: string, details: string): D1PreparedStatement {
    return this.db
      .prepare('INSERT INTO automation_logs (id, rule_id, status, details) VALUES (?, ?, ?, ?)')
      .bind(generateId(), ruleId, status, details);
  }
}
