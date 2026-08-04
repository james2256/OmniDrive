import type { D1Database } from '@cloudflare/workers-types';
import type { UserRow, InvitationCodeRow, AuditLogRow } from '../types/db';

/**
 * Data access layer for admin operations.
 *
 * Owns SQL for the `users`, `invitation_codes`, and `audit_logs` tables
 * as used by the admin route. The super-admin guard (is_super_admin check)
 * is also handled here. RBAC is binary (super_admin or not) — no layered
 * role checks, so no service layer is needed.
 */
export class AdminRepository {
  constructor(private db: D1Database) {}

  // ─── users ───

  /** Check if a user is a super admin (for the admin guard middleware). */
  findSuperAdminStatus(userId: string) {
    return this.db
      .prepare('SELECT is_super_admin FROM users WHERE id = ?')
      .bind(userId)
      .first<{ is_super_admin: number }>();
  }

  /** Count super admins — used by the last-super-admin guard before deletion. */
  async countSuperAdmins(): Promise<number> {
    const { count } = (await this.db
      .prepare('SELECT COUNT(*) as count FROM users WHERE is_super_admin = 1')
      .first<{ count: number }>()) ?? { count: 0 };
    return count;
  }

  /** Find all users (admin view) — limited fields, most recent 100. */
  findAllUsers() {
    return this.db
      .prepare(
        'SELECT id, username, email, name, avatar_url, is_super_admin, is_blocked FROM users ORDER BY created_at DESC LIMIT 100',
      )
      .all<UserRow>();
  }

  /** Check if a username already exists. */
  findByUsername(username: string) {
    return this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .bind(username)
      .first<{ id: string }>();
  }

  /** Check if an email already exists. */
  findByEmail(email: string) {
    return this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
  }

  /** Insert a new user (admin-created). */
  insertUser(params: {
    id: string;
    username: string;
    passwordHash: string;
    email: string | null;
    name: string;
    isSuperAdmin: number;
  }) {
    return this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, email, name, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        params.id,
        params.username,
        params.passwordHash,
        params.email,
        params.name,
        params.isSuperAdmin,
      )
      .run();
  }

  // ─── role / status / delete (admin user management) ───

  /** Promote a user to super admin. */
  promoteToAdmin(userId: string) {
    return this.db
      .prepare("UPDATE users SET is_super_admin = 1, updated_at = datetime('now') WHERE id = ?")
      .bind(userId)
      .run();
  }

  /**
   * Demote a super admin to member. Atomic last-admin protection:
   * WHERE clause blocks the UPDATE if this is the last super admin.
   * Check meta.changes === 0 to detect the guard fired (D1 FKs are off,
   * but the subquery + UPDATE are atomic at the statement level).
   */
  demoteFromAdmin(userId: string) {
    return this.db
      .prepare(
        `UPDATE users SET is_super_admin = 0, updated_at = datetime('now')
       WHERE id = ? AND (SELECT COUNT(*) FROM users WHERE is_super_admin = 1) > 1`,
      )
      .bind(userId)
      .run();
  }

  /** Block a user and delete all their sessions (immediate kick-out). */
  async blockUser(userId: string) {
    await this.db.batch([
      this.db
        .prepare("UPDATE users SET is_blocked = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(userId),
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    ]);
  }

  /** Unblock a user (they can log in again). */
  unblockUser(userId: string) {
    return this.db
      .prepare("UPDATE users SET is_blocked = 0, updated_at = datetime('now') WHERE id = ?")
      .bind(userId)
      .run();
  }

  /**
   * Permanently delete a user with manual cascade. Production D1 enforces FK +
   * ON DELETE CASCADE by default (developers.cloudflare.com/d1/sql-api/foreign-keys),
   * so the batch is redundant in production but defensive: it ensures correct
   * behavior on runtimes that don't enforce FK (better-sqlite3-based runtimes —
   * unit tests and the node-server Docker deployment — do not enable
   * PRAGMA foreign_keys) and survives any schema change that drops the FK.
   * We delete all 23 dependent tables + the user row in dependency order
   * (children before parents) via a single db.batch() which executes
   * statements in array order.
   */
  async deleteUser(userId: string) {
    await this.db.batch([
      // ─── Level 0: grandchildren (depend on intermediate tables) ───
      // Subqueries read from intermediate tables — they still exist at this point.
      this.db
        .prepare(
          'DELETE FROM s3_multipart_parts WHERE upload_id IN (SELECT upload_id FROM s3_multipart_uploads WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM shared_link_logs WHERE shared_link_id IN (SELECT id FROM shared_links WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM automation_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM sync_state WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM quota_cache WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM drive_folders WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM drive_tokens WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM s3_lifecycle_rules WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM workspace_policies WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?)',
        )
        .bind(userId),
      this.db
        .prepare(
          'DELETE FROM workspace_folders WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?)',
        )
        .bind(userId),
      // ─── Level 1: intermediate parents (depend on users; have grandchildren) ───
      this.db.prepare('DELETE FROM s3_multipart_uploads WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM shared_links WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM automation_rules WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM drive_accounts WHERE user_id = ?').bind(userId),
      // ─── Level 2: direct children of users (no dependents) ───
      this.db.prepare('DELETE FROM workspaces WHERE owner_id = ?').bind(userId),
      this.db.prepare('DELETE FROM files WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM workspace_members WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM audit_logs WHERE actor_id = ?').bind(userId),
      this.db.prepare('DELETE FROM invitation_codes WHERE created_by = ?').bind(userId),
      this.db.prepare('DELETE FROM s3_credentials WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM file_storage_stats WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM oauth_states WHERE user_id = ?').bind(userId),
      // ─── Level 3: root ───
      this.db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);
  }

  // ─── invitation_codes ───

  /** Find all invitation codes, most recent first. */
  findAllInvitations() {
    return this.db
      .prepare('SELECT * FROM invitation_codes ORDER BY created_at DESC')
      .all<InvitationCodeRow>();
  }

  /** Insert a new invitation code. */
  insertInvitation(params: { id: string; code: string; createdBy: string; maxUses: number }) {
    return this.db
      .prepare('INSERT INTO invitation_codes (id, code, created_by, max_uses) VALUES (?, ?, ?, ?)')
      .bind(params.id, params.code, params.createdBy, params.maxUses)
      .run();
  }

  /** Delete an invitation code. */
  deleteInvitation(id: string) {
    return this.db.prepare('DELETE FROM invitation_codes WHERE id = ?').bind(id).run();
  }

  // ─── audit_logs ───

  /** Find recent audit logs with actor email + workspace name via JOINs. */
  findRecentAuditLogs() {
    return this.db
      .prepare(
        'SELECT a.*, u.email as actor_email, w.name as workspace_name FROM audit_logs a JOIN users u ON a.actor_id = u.id LEFT JOIN workspaces w ON a.workspace_id = w.id ORDER BY a.created_at DESC LIMIT 100',
      )
      .all<AuditLogRow>();
  }
}
