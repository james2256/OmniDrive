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
    return this.db
      .prepare(
        `
      SELECT w.id, w.name, w.created_at, w.updated_at
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ? ORDER BY w.name ASC
    `,
      )
      .bind(userId)
      .all();
  }

  /** Find a workspace by ID + membership (returns null if not a member). */
  findByIdAndMember(workspaceId: string, userId: string) {
    return this.db
      .prepare(
        `
      SELECT w.* FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE w.id = ? AND wm.user_id = ?
    `,
      )
      .bind(workspaceId, userId)
      .first();
  }

  /** Find a workspace by ID + ownership (returns null if not owner). */
  findByIdAndOwner(workspaceId: string, ownerId: string) {
    return this.db
      .prepare('SELECT id FROM workspaces WHERE id = ? AND owner_id = ?')
      .bind(workspaceId, ownerId)
      .first();
  }

  /** Get the sync TTL for a workspace. */
  findSyncTtl(workspaceId: string) {
    return this.db
      .prepare('SELECT sync_ttl_minutes FROM workspaces WHERE id = ?')
      .bind(workspaceId)
      .first<{ sync_ttl_minutes: number }>();
  }

  /** Check if a workspace exists (by ID only, no membership check). */
  exists(workspaceId: string) {
    return this.db.prepare('SELECT id FROM workspaces WHERE id = ?').bind(workspaceId).first();
  }

  // ─── Mutations ───

  /** Create a workspace + add the creator as 'owner' member. Returns the workspace ID. */
  async createWorkspace(name: string, userId: string): Promise<string> {
    const workspaceId = generateId();
    const memberId = generateId();
    await this.db.batch([
      this.db
        .prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind(workspaceId, name, userId),
      this.db
        .prepare(
          'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
        )
        .bind(memberId, workspaceId, userId, 'owner'),
    ]);
    return workspaceId;
  }

  /** Rename a workspace. */
  rename(workspaceId: string, name: string) {
    return this.db
      .prepare('UPDATE workspaces SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(name, workspaceId)
      .run();
  }

  /**
   * Delete a workspace with manual cascade. D1 FKs are OFF, so
   * ON DELETE CASCADE / SET NULL are documentation-only.
   *
   * Cascade order (children before parents):
   *  1. s3_multipart_parts (via uploads subquery)
   *  2. s3_multipart_uploads (workspace_id FK)
   *  3. s3_lifecycle_rules (workspace_id FK)
   *  4. workspace_policies (workspace_id FK)
   *  5. workspace_folders (workspace_id FK — subfolders handled by self-FK in FolderRepository)
   *  6. s3_credentials (workspace_id FK)
   *  7. files — NULL out workspace_id + workspace_folder_id (files survive workspace
   *     deletion; they're Google Drive files, not workspace-owned. Service also calls
   *     detachFromWorkspace, but we null here too for safety.)
   *  8. audit_logs — NULL out workspace_id (ON DELETE SET NULL intent)
   *  9. workspace_members (workspace_id FK)
   * 10. workspaces (the row itself)
   *
   * Uses db.batch() for atomicity (single round-trip).
   */
  async delete(workspaceId: string) {
    await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM s3_multipart_parts WHERE upload_id IN (SELECT upload_id FROM s3_multipart_uploads WHERE workspace_id = ?)',
        )
        .bind(workspaceId),
      this.db.prepare('DELETE FROM s3_multipart_uploads WHERE workspace_id = ?').bind(workspaceId),
      this.db.prepare('DELETE FROM s3_lifecycle_rules WHERE workspace_id = ?').bind(workspaceId),
      this.db.prepare('DELETE FROM workspace_policies WHERE workspace_id = ?').bind(workspaceId),
      this.db.prepare('DELETE FROM workspace_folders WHERE workspace_id = ?').bind(workspaceId),
      this.db.prepare('DELETE FROM s3_credentials WHERE workspace_id = ?').bind(workspaceId),
      this.db
        .prepare(
          'UPDATE files SET workspace_id = NULL, workspace_folder_id = NULL WHERE workspace_id = ?',
        )
        .bind(workspaceId),
      this.db
        .prepare('UPDATE audit_logs SET workspace_id = NULL WHERE workspace_id = ?')
        .bind(workspaceId),
      this.db.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(workspaceId),
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').bind(workspaceId),
    ]);
  }

  // ─── Member management ───

  /** Find a user by email (for adding members). Returns null if not found. */
  findUserByEmail(email: string) {
    return this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
  }

  /** Add a member to a workspace. Throws on UNIQUE constraint (already a member). */
  addMember(workspaceId: string, userId: string, role: string) {
    const memberId = generateId();
    return this.db
      .prepare(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
      )
      .bind(memberId, workspaceId, userId, role)
      .run();
  }

  /** Count owners in a workspace (for last-owner check). */
  countOwners(workspaceId: string) {
    return this.db
      .prepare(
        'SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = ? AND role = ?',
      )
      .bind(workspaceId, 'owner')
      .first<{ count: number }>();
  }

  /** Remove a member from a workspace. */
  removeMember(workspaceId: string, targetUserId: string) {
    return this.db
      .prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, targetUserId)
      .run();
  }

  // ─── Audit logs + policies ───

  /** Find audit logs for a workspace, with actor email via JOIN. */
  findAuditLogs(workspaceId: string) {
    return this.db
      .prepare(
        'SELECT a.*, u.email as actor_email FROM audit_logs a JOIN users u ON a.actor_id = u.id WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100',
      )
      .bind(workspaceId)
      .all();
  }

  /** Find all policies for a workspace. */
  findPolicies(workspaceId: string) {
    return this.db
      .prepare('SELECT * FROM workspace_policies WHERE workspace_id = ?')
      .bind(workspaceId)
      .all();
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
    await this.db
      .prepare(
        'INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        policyId,
        params.workspaceId,
        params.targetType,
        params.targetId,
        params.policyType,
        params.config,
      )
      .run();
    return this.db.prepare('SELECT * FROM workspace_policies WHERE id = ?').bind(policyId).first();
  }

  /** Delete a policy. */
  deletePolicy(policyId: string, workspaceId: string) {
    return this.db
      .prepare('DELETE FROM workspace_policies WHERE id = ? AND workspace_id = ?')
      .bind(policyId, workspaceId)
      .run();
  }
}
