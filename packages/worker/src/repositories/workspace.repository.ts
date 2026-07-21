import type { D1Database } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';

/**
 * Data access layer for the `workspaces` and `workspace_members` tables.
 *
 * Serves both `folders.ts` and `workspaces.ts` (future migration).
 * All SQL for workspaces + workspace_members lives here.
 */
export class WorkspaceRepository {
  constructor(private db: D1Database) {}

  // ─── Reads ───

  /** List all workspaces a user is a member of, ordered by name. */
  findWorkspacesByUser(userId: string) {
    return this.db.prepare(`
      SELECT w.id, w.name, w.created_at, w.updated_at
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ? ORDER BY w.name ASC
    `).bind(userId).all();
  }

  /** Find a workspace by ID + membership (returns null if not a member). */
  findByIdAndMember(workspaceId: string, userId: string) {
    return this.db.prepare(`
      SELECT w.* FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE w.id = ? AND wm.user_id = ?
    `).bind(workspaceId, userId).first();
  }

  /** Find a workspace by ID + ownership (returns null if not owner). */
  findByIdAndOwner(workspaceId: string, ownerId: string) {
    return this.db.prepare('SELECT id FROM workspaces WHERE id = ? AND owner_id = ?')
      .bind(workspaceId, ownerId).first();
  }

  /** Get the sync TTL for a workspace. */
  findSyncTtl(workspaceId: string) {
    return this.db.prepare('SELECT sync_ttl_minutes FROM workspaces WHERE id = ?')
      .bind(workspaceId).first<{ sync_ttl_minutes: number }>();
  }

  /** Check if a workspace exists (by ID only, no membership check). */
  exists(workspaceId: string) {
    return this.db.prepare('SELECT id FROM workspaces WHERE id = ?')
      .bind(workspaceId).first();
  }

  // ─── Mutations ───

  /** Create a workspace + add the creator as 'owner' member. Returns the workspace ID. */
  async createWorkspace(name: string, userId: string): Promise<string> {
    const workspaceId = generateId();
    const memberId = generateId();
    await this.db.batch([
      this.db.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)').bind(workspaceId, name, userId),
      this.db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').bind(memberId, workspaceId, userId, 'owner'),
    ]);
    return workspaceId;
  }

  /** Rename a workspace. */
  rename(workspaceId: string, name: string) {
    return this.db.prepare('UPDATE workspaces SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(name, workspaceId).run();
  }

  /** Delete a workspace. */
  delete(workspaceId: string) {
    return this.db.prepare('DELETE FROM workspaces WHERE id = ?')
      .bind(workspaceId).run();
  }
}
