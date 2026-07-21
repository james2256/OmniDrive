import type { D1Database } from '@cloudflare/workers-types';

/**
 * Data access layer for the `users`, `sessions`, and `invitation_codes` tables
 * as used by the auth route. The OAuth callback route (/callback) keeps its
 * inline SQL — it's interleaved with Google API + encryption + waitUntil.
 *
 * ponytail: merge with AdminRepository into a UserRepository when a 3rd
 * route needs users-table queries. Currently AdminRepository and AuthRepository
 * both touch users, but serve different use cases (admin view vs auth flow).
 */
export class AuthRepository {
  constructor(private db: D1Database) {}

  // ─── users ───

  /** Count total users (for setup-status check). */
  countUsers() {
    return this.db.prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();
  }

  /** Find a user by username (for login + register duplicate check). */
  findByUsername(username: string) {
    return this.db.prepare('SELECT id FROM users WHERE username = ?')
      .bind(username).first();
  }

  /** Find a user by email (for register duplicate check). */
  findByEmail(email: string) {
    return this.db.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email).first();
  }

  /** Find a user by username with all auth fields (for login). */
  findByUsernameWithAuth(username: string) {
    return this.db.prepare(
      'SELECT id, username, password_hash, email, name, avatar_url, is_super_admin FROM users WHERE username = ?'
    ).bind(username).first();
  }

  /** Find a user's password hash by ID (for change-password). */
  findPasswordHash(userId: string) {
    return this.db.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(userId).first<{ password_hash: string }>();
  }

  /** Insert a new user (register). */
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

  /** Update a user's password hash. */
  updatePasswordHash(userId: string, passwordHash: string) {
    return this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, userId).run();
  }

  // ─── sessions ───

  /** Insert a new session. */
  insertSession(params: {
    id: string;
    userId: string;
    data: string;
    expiresAt: number;
    touchedAt: number;
  }) {
    return this.db.prepare(
      'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      params.id, params.userId, params.data,
      params.expiresAt, params.touchedAt,
    ).run();
  }

  /** Delete a session by ID (for logout). */
  deleteSessionById(sessionId: string) {
    return this.db.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(sessionId).run();
  }

  /** Delete all sessions for a user except the current one (for change-password). */
  deleteOtherSessions(userId: string, currentSessionId: string) {
    return this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .bind(userId, currentSessionId).run();
  }

  /** Delete all sessions for a user (for sessions/revoke). */
  deleteAllSessions(userId: string) {
    return this.db.prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(userId).run();
  }

  // ─── invitation_codes ───

  /**
   * Atomically consume an invitation code (no TOCTOU race).
   * Returns the consumed ID, or null if the code doesn't exist or is exhausted.
   */
  consumeInvitation(code: string) {
    return this.db.prepare(
      'UPDATE invitation_codes SET used_count = used_count + 1 WHERE code = ? AND (max_uses <= 0 OR used_count < max_uses) RETURNING id'
    ).bind(code).first<{ id: string }>();
  }

  /** Check if an invitation code exists (for error messaging). */
  findInvitation(code: string) {
    return this.db.prepare('SELECT id FROM invitation_codes WHERE code = ?')
      .bind(code).first();
  }
}
