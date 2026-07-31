import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
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

  /**
   * List all workspaces a user is a member of, with their role in each.
   *
   * Distinct from `findWorkspacesByUser`: that returns a column subset ordered
   * by `name ASC` (used by folder.service.ts's workspace dropdown); this returns
   * `w.*` + `wm.role` ordered by `created_at DESC` (used by the workspaces list
   * page, which shows the role badge + most-recent-first). The two shapes are
   * intentionally separate — consolidating would change one caller's sort order.
   */
  findWorkspacesWithRole(userId: string) {
    return this.db
      .prepare(
        `
      SELECT w.*, wm.role
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC
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

  /** Find a workspace by ID (no membership check). Returns the full row. */
  findById(workspaceId: string) {
    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').bind(workspaceId).first();
  }

  /**
   * Return a prepared used_bytes UPDATE statement (not run) for batch operations.
   * Used by PolicyService retention auto-delete to batch DELETE file + UPDATE
   * used_bytes atomically. `sizeDelta` may be negative (deletion).
   */
  updateUsedBytesStmt(workspaceId: string, sizeDelta: number): D1PreparedStatement {
    return this.db
      .prepare('UPDATE workspaces SET used_bytes = COALESCE(used_bytes, 0) + ? WHERE id = ?')
      .bind(sizeDelta, workspaceId);
  }

  /** List all workspaces for a user (S3 ListBuckets). Scopes to s3WorkspaceId if set. */
  findBucketsByUser(userId: string, s3WorkspaceId: string | null = null) {
    return this.db
      .prepare(
        `SELECT w.id, w.name, w.created_at 
         FROM workspaces w 
         JOIN workspace_members wm ON w.id = wm.workspace_id 
         WHERE wm.user_id = ? 
           AND (? IS NULL OR w.id = ?)
         ORDER BY w.name`,
      )
      .bind(userId, s3WorkspaceId, s3WorkspaceId)
      .all();
  }

  /**
   * Resolve a bucket name to a workspace + role for the user (S3 resolveBucket).
   * If s3WorkspaceId is provided, scopes the query to that workspace.
   */
  resolveBucket(bucketName: string, userId: string, s3WorkspaceId: string | null) {
    return this.db
      .prepare(
        `SELECT w.id, wm.role FROM workspaces w
         JOIN workspace_members wm ON w.id = wm.workspace_id
         WHERE w.name = ? AND wm.user_id = ?
           AND (? IS NULL OR w.id = ?)`,
      )
      .bind(bucketName, userId, s3WorkspaceId, s3WorkspaceId)
      .first();
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

  /**
   * Return a prepared workspace_members INSERT statement (not run) for batch
   * composition. This is the `Stmt` variant of `addMember` — used by
   * `WorkspaceService.addMember` to batch the member INSERT + audit-log INSERT
   * atomically via `db.batch([...])`, so a crash mid-op never leaves a member
   * without an audit row (or vice-versa). The caller supplies `memberId` so the
   * audit row can reference it before the batch commits.
   */
  addMemberStmt(
    memberId: string,
    workspaceId: string,
    userId: string,
    role: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
      )
      .bind(memberId, workspaceId, userId, role);
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

  /**
   * Read a user's workspace role (the RBAC primitive). Used by the lib/rbac
   * `getWorkspaceRole` utility, which is called from 18 sites across services +
   * routes. Returns `null` if the user is not a member of the workspace.
   */
  findMemberRole(workspaceId: string, userId: string) {
    return this.db
      .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, userId)
      .first<{ role: string }>();
  }

  /** Remove a member from a workspace. */
  removeMember(workspaceId: string, targetUserId: string) {
    return this.db
      .prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, targetUserId)
      .run();
  }

  /**
   * Return a prepared workspace_members DELETE statement (not run) for batch
   * composition. This is the `Stmt` variant of `removeMember` — used by
   * `WorkspaceService.removeMember` to batch the member DELETE + audit-log
   * INSERT atomically via `db.batch([...])`.
   */
  removeMemberStmt(workspaceId: string, targetUserId: string): D1PreparedStatement {
    return this.db
      .prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, targetUserId);
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

  // ─── Policy reads (quota + retention enforcement) ───

  /** Read the current `used_bytes` for a workspace (quota check). */
  findUsedBytes(workspaceId: string) {
    return this.db
      .prepare('SELECT used_bytes FROM workspaces WHERE id = ?')
      .bind(workspaceId)
      .first<{ used_bytes: number }>();
  }

  /** Read the `storage_quota` policy config for a workspace (null if none set). */
  findStorageQuotaPolicy(workspaceId: string) {
    return this.db
      .prepare(
        `SELECT config FROM workspace_policies
       WHERE workspace_id = ? AND policy_type = 'storage_quota'`,
      )
      .bind(workspaceId)
      .first<{ config: string }>();
  }

  /**
   * Read the `data_retention` policy config that protects a given folder.
   * Matches either a workspace-scoped policy (`target_type = 'workspace'`) or a
   * folder-scoped policy on this exact folder (`target_type = 'folder'` AND
   * `target_id = folderId`). The folderId is bound twice (anchor + recursive).
   */
  findRetentionPolicyForFolder(folderId: string) {
    return this.db
      .prepare(
        `SELECT p.config
       FROM workspace_policies p
       JOIN workspace_folders f ON f.workspace_id = p.workspace_id
       WHERE f.id = ? AND p.policy_type = 'data_retention'
         AND (p.target_type = 'workspace' OR (p.target_type = 'folder' AND p.target_id = ?))`,
      )
      .bind(folderId, folderId)
      .first<{ config: string }>();
  }

  /**
   * Find all `data_retention` policies whose config `action` is `auto_delete`.
   * The `action` is nested in the JSON `config` column, so the filter uses
   * `json_extract`. Used by the retention cron sweep.
   */
  findAllAutoDeleteRetentionPolicies() {
    return this.db
      .prepare(
        `SELECT * FROM workspace_policies WHERE policy_type = 'data_retention' AND json_extract(config, '$.action') = 'auto_delete'`,
      )
      .all<{
        id: string;
        workspace_id: string;
        target_type: string;
        target_id: string | null;
        config: string;
      }>();
  }
}
