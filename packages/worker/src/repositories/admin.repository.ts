import type { D1Database } from '@cloudflare/workers-types';

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
    return this.db.prepare('SELECT is_super_admin FROM users WHERE id = ?')
      .bind(userId).first<{ is_super_admin: number }>();
  }

  /** Find all users (admin view) — limited fields, most recent 100. */
  findAllUsers() {
    return this.db.prepare(
      'SELECT id, username, email, name, avatar_url, is_super_admin FROM users ORDER BY created_at DESC LIMIT 100'
    ).all();
  }

  /** Check if a username already exists. */
  findByUsername(username: string) {
    return this.db.prepare('SELECT id FROM users WHERE username = ?')
      .bind(username).first();
  }

  /** Check if an email already exists. */
  findByEmail(email: string) {
    return this.db.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email).first();
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
    return this.db.prepare(
      'INSERT INTO users (id, username, password_hash, email, name, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      params.id, params.username, params.passwordHash, params.email,
      params.name, params.isSuperAdmin,
    ).run();
  }

  // ─── invitation_codes ───

  /** Find all invitation codes, most recent first. */
  findAllInvitations() {
    return this.db.prepare('SELECT * FROM invitation_codes ORDER BY created_at DESC').all();
  }

  /** Insert a new invitation code. */
  insertInvitation(params: { id: string; code: string; createdBy: string; maxUses: number }) {
    return this.db.prepare(
      'INSERT INTO invitation_codes (id, code, created_by, max_uses) VALUES (?, ?, ?, ?)'
    ).bind(params.id, params.code, params.createdBy, params.maxUses).run();
  }

  /** Delete an invitation code. */
  deleteInvitation(id: string) {
    return this.db.prepare('DELETE FROM invitation_codes WHERE id = ?').bind(id).run();
  }

  // ─── audit_logs ───

  /** Find recent audit logs with actor email + workspace name via JOINs. */
  findRecentAuditLogs() {
    return this.db.prepare(
      'SELECT a.*, u.email as actor_email, w.name as workspace_name FROM audit_logs a JOIN users u ON a.actor_id = u.id LEFT JOIN workspaces w ON a.workspace_id = w.id ORDER BY a.created_at DESC LIMIT 100'
    ).all();
  }
}
