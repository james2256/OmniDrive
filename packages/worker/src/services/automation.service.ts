import type { RuleCondition, AutomationRule, RuleAction } from '../types/automation';
import type { Env } from '../types/env';

export interface AutomationFile {
  [key: string]: unknown;
}

export interface DbFile extends AutomationFile {
  id: string;
  user_id: string;
}

export function evaluateCondition(file: AutomationFile, conditions: RuleCondition[]): boolean {
  if (!conditions || conditions.length === 0) return true;
  
  return conditions.every(cond => {
    const rawFieldValue = file[cond.field];
    const value = rawFieldValue != null ? String(rawFieldValue).toLowerCase() : '';
    const target = cond.value != null ? String(cond.value).toLowerCase() : '';
    
    switch (cond.operator) {
      case 'endswith': return value.endsWith(target);
      case 'contains': return value.includes(target);
      case 'equals': return value === target;
      default: return false;
    }
  });
}

export class AutomationEngine {
  constructor(private env: Env) {}

  async processEventTrigger(file: DbFile, ctx: ExecutionContext) {
    const db = this.env.DB;
    const { results } = await db.prepare(
      `SELECT * FROM automation_rules WHERE trigger_type = 'event' AND is_active = 1 AND user_id = ?`
    ).bind(file.user_id).all();

    for (const row of results) {
      const conditions = JSON.parse(row.conditions as string || '[]') as RuleCondition[];
      if (evaluateCondition(file, conditions)) {
        const actions = JSON.parse(row.actions as string || '[]') as RuleAction[];
        ctx.waitUntil(this.executeActions(row.id as string, file, actions));
      }
    }
  }

  async processCronTrigger(ctx: ExecutionContext) {
    const db = this.env.DB;
    const { results } = await db.prepare(`SELECT * FROM automation_rules WHERE trigger_type = 'cron' AND is_active = 1`).all();
    
    for (const row of results) {
      const conditions = JSON.parse(row.conditions as string || '[]') as RuleCondition[];
      const actions = JSON.parse(row.actions as string || '[]') as RuleAction[];
      
      const { results: files } = await db.prepare(`SELECT * FROM files WHERE user_id = ? AND is_trashed = 0`).bind(row.user_id as string).all();
      for (const file of files) {
        if (evaluateCondition(file as AutomationFile, conditions)) {
          ctx.waitUntil(this.executeActions(row.id as string, file as DbFile, actions));
        }
      }
    }
  }

  private async executeActions(ruleId: string, file: DbFile, actions: RuleAction[]) {
    try {
      for (const action of actions) {
        const targetFolderId = action.targetFolderId || (action as any).target_folder_id;
        if (action.type === 'move' && targetFolderId) {
          await this.env.DB.prepare('UPDATE files SET virtual_folder_id = ?, updated_at = datetime("now") WHERE id = ?')
            .bind(targetFolderId, file.id).run();
        } else if (action.type === 'delete') {
          await this.env.DB.prepare('UPDATE files SET is_trashed = 1 WHERE id = ?')
            .bind(file.id).run();
        }
      }
      
      await this.env.DB.prepare('INSERT INTO automation_logs (id, rule_id, status, details) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), ruleId, 'success', JSON.stringify({ fileId: file.id })).run();
    } catch (error: any) {
      await this.env.DB.prepare('INSERT INTO automation_logs (id, rule_id, status, details) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), ruleId, 'error', error.message).run();
    }
  }
}
