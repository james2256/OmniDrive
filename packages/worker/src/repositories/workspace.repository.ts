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

  // ─── Member management ───

  /** Find a user by email (for adding members). Returns null if not found. */
  findUserByEmail(email: string) {
    return this.db.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email).first<{ id: string }>();
  }

  /** Add a member to a workspace. Throws on UNIQUE constraint (already a member). */
  addMember(workspaceId: string, userId: string, role: string) {
    const memberId = generateId();
    return this.db.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).bind(memberId, workspaceId, userId, role).run();
  }

  /** Count owners in a workspace (for last-owner check). */
  countOwners(workspaceId: string) {
    return this.db.prepare(
      'SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = ? AND role = ?'
    ).bind(workspaceId, 'owner').first<{ count: number }>();
  }

  /** Remove a member from a workspace. */
  removeMember(workspaceId: string, targetUserId: string) {
    return this.db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, targetUserId).run();
  }

  // ─── Audit logs + policies ───

  /** Find audit logs for a workspace, with actor email via JOIN. */
  findAuditLogs(workspaceId: string) {
    return this.db.prepare(
      'SELECT a.*, u.email as actor_email FROM audit_logs a JOIN users u ON a.actor_id = u.id WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(workspaceId).all();
  }

  /** Find all policies for a workspace. */
  findPolicies(workspaceId: string) {
    return this.db.prepare('SELECT * FROM workspace_policies WHERE workspace_id = ?')
      .bind(workspaceId).all();
  }

  /** Create a policy. Returns the created policy row. */
  async createPolicy(params: {
    workspaceId: string;
    targetType: string;
    targetId: string | null;
    policyType: string;
    config: string;
  }): Promise<unknown> {
    const policyId = generateId();
    await this.db.prepare(
      'INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(policyId, params.workspaceId, params.targetType, params.targetId, params.policyType, params.config).run();
    return this.db.prepare('SELECT * FROM workspace_policies WHERE id = ?').bind(policyId).first();
  }

  /** Delete a policy. */
  deletePolicy(policyId: string, workspaceId: string) {
    return this.db.prepare('DELETE FROM workspace_policies WHERE id = ? AND workspace_id = ?')
      .bind(policyId, workspaceId).run();
  }
}
