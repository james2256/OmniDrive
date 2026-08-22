import type { RuleCondition, RuleAction } from '../types/automation';
import type { Env } from '../types/env';
import type { DriveProvider } from '../types/drive-provider';
import type { FileRow } from '../types/db';
import { logErrorNoCtx } from '../lib/logger';
import { FileRepository } from '../repositories/file.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { AutomationRepository } from '../repositories/automation.repository';

export const ACTION_MOVE: RuleAction['type'] = 'move';
export const ACTION_DELETE: RuleAction['type'] = 'delete';

export const IS_ACTIVE = 1;
export const IS_INACTIVE = 0;
export const IS_NOT_TRASHED = 0;
export const IS_TRASHED = 1;

export const BATCH_SIZE = 100;

export interface AutomationFile {
  name: string;
  extension: string;
  [key: string]: unknown;
}

export interface DbFile extends AutomationFile {
  id: string;
  user_id: string;
}

/**
 * Convert a FileRow (DB row without an `extension` column) into a DbFile by
 * deriving `extension` from `name`. This avoids unsafe casts — FileRow's index
 * signature types `extension` as `unknown`, while DbFile requires `string`.
 * evaluateCondition still recomputes if empty, so this is a hint, not a source
 * of truth.
 */
export function toDbFile(row: FileRow): DbFile {
  const parts = row.name.split('.');
  const extension = parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
  return { ...row, extension };
}

interface ParsedRule {
  id: string;
  userId: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export function evaluateCondition(file: AutomationFile, conditions: RuleCondition[]): boolean {
  if (!conditions || conditions.length === 0) return true;

  // Compute extension if missing
  const evalFile = { ...file };
  if (!evalFile.extension && evalFile.name) {
    const parts = evalFile.name.split('.');
    evalFile.extension = parts.length > 1 ? (parts.pop() || '').toLowerCase() : '';
  }

  return conditions.every((cond) => {
    const rawFieldValue = evalFile[cond.field];
    const value = rawFieldValue != null ? String(rawFieldValue).toLowerCase() : '';
    const target = cond.value != null ? String(cond.value).toLowerCase() : '';

    switch (cond.operator) {
      case 'endswith':
        return value.endsWith(target);
      case 'contains':
        return value.includes(target);
      case 'equals':
        return value === target;
      default:
        return false;
    }
  });
}

export function parseRule(row: Record<string, unknown>): ParsedRule | null {
  try {
    const conditions = JSON.parse((row.conditions as string) || '[]') as RuleCondition[];
    const actions = JSON.parse((row.actions as string) || '[]') as RuleAction[];
    return {
      id: row.id as string,
      userId: row.user_id as string,
      conditions,
      actions,
    };
  } catch (err) {
    logErrorNoCtx('Automation rule skipped — malformed JSON in conditions/actions', err, {
      ruleId: row.id,
      userId: row.user_id,
    });
    return null;
  }
}

export class AutomationEngine {
  constructor(
    private env: Env,
    private driveProvider: DriveProvider,
  ) {}

  async processEventTrigger(file: DbFile, ctx: ExecutionContext) {
    const automationRepo = new AutomationRepository(this.env.DB);
    const { results } = await automationRepo.findActiveEventRulesForUser(file.user_id);

    for (const row of results) {
      const rule = parseRule(row as Record<string, unknown>);
      if (rule && evaluateCondition(file, rule.conditions)) {
        ctx.waitUntil(this.executeActions(rule.id, file, rule.actions));
      }
    }
  }

  async processCronTrigger(ctx: ExecutionContext) {
    const MAX_AUTOMATION_ACTIONS_PER_CYCLE = 5;
    const automationRepo = new AutomationRepository(this.env.DB);
    const fileRepo = new FileRepository(this.env.DB);
    const { results } = await automationRepo.findActiveCronRules();

    // Group rules by user_id
    const rulesByUser = new Map<string, ParsedRule[]>();
    for (const row of results) {
      const rule = parseRule(row as Record<string, unknown>);
      if (rule) {
        const userRules = rulesByUser.get(rule.userId) || [];
        userRules.push(rule);
        rulesByUser.set(rule.userId, userRules);
      }
    }

    let actionCount = 0;
    for (const [userId, rules] of rulesByUser.entries()) {
      let cursor: { name: string; id: string } | null = null;
      let hasMore = true;

      while (hasMore) {
        const { results: files } = await fileRepo.findBatchForCron(
          userId,
          IS_NOT_TRASHED,
          cursor,
          BATCH_SIZE,
        );

        if (files.length === 0) {
          break;
        }

        for (const file of files) {
          const dbFile = toDbFile(file);
          for (const rule of rules) {
            if (evaluateCondition(dbFile, rule.conditions)) {
              if (actionCount >= MAX_AUTOMATION_ACTIONS_PER_CYCLE) break;
              actionCount++;
              ctx.waitUntil(this.executeActions(rule.id, dbFile, rule.actions));
            }
          }
          if (actionCount >= MAX_AUTOMATION_ACTIONS_PER_CYCLE) break;
        }

        if (actionCount >= MAX_AUTOMATION_ACTIONS_PER_CYCLE || files.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          const last = files[files.length - 1] as { name: string; id: string };
          cursor = { name: last.name, id: last.id };
        }
      }
      if (actionCount >= MAX_AUTOMATION_ACTIONS_PER_CYCLE) break;
    }
  }

  private async executeActions(ruleId: string, file: DbFile, actions: RuleAction[]) {
    const fileRepo = new FileRepository(this.env.DB);
    const folderRepo = new FolderRepository(this.env.DB);
    const automationRepo = new AutomationRepository(this.env.DB);
    try {
      const stmts: D1PreparedStatement[] = [];

      for (const action of actions) {
        const targetFolderId =
          action.targetFolderId ??
          (action as RuleAction & { target_folder_id?: string }).target_folder_id;

        if (action.type === ACTION_MOVE && targetFolderId) {
          // Validate the target folder belongs to a workspace the user can access.
          // Without this, a crafted rule could point workspace_folder_id at any
          // UUID — leaking another user's workspace folder name via breadcrumbs.
          const membership = await folderRepo.findMembership(
            targetFolderId as string,
            file.user_id,
          );
          if (!membership) {
            logErrorNoCtx('Automation MOVE: target folder not accessible by user', undefined, {
              fileId: file.id,
              targetFolderId,
              userId: file.user_id,
            });
            continue;
          }
          stmts.push(fileRepo.updateWorkspaceFolderStmt(file.id, targetFolderId as string));
        } else if (action.type === ACTION_DELETE) {
          // Skip non-owned files — automation rules shouldn't trash teammate files.
          if (file.owned_by_me !== 1) continue;
          // Call Google Drive API to trash the file so sync doesn't revert it.
          // If the API call fails, skip the D1 update — the file would reappear
          // on next sync anyway (Google says not trashed → UPSERT resets is_trashed=0).
          try {
            await this.driveProvider.trashFile(
              file.drive_account_id as string,
              file.google_file_id as string,
            );
          } catch (err) {
            logErrorNoCtx('Automation DELETE: Google API call failed', err, { fileId: file.id });
            continue;
          }
          stmts.push(fileRepo.markTrashedStmt(file.id, IS_TRASHED));
        }
      }

      if (actions.length > 0) {
        stmts.push(
          automationRepo.insertLogStmt(ruleId, 'success', JSON.stringify({ fileId: file.id })),
        );
      }

      if (stmts.length > 0) {
        await this.env.DB.batch(stmts);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await automationRepo.insertLogStmt(ruleId, 'error', errorMessage).run();
    }
  }
}
