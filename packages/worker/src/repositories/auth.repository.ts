import type { D1Database } from '@cloudflare/workers-types';
import type { UserRow, InvitationCodeRow } from '../types/db';

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
    return this.db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  }

  /** Find a user by username (for login + register duplicate check). */
  findByUsername(username: string) {
    return this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .bind(username)
      .first<{ id: string }>();
  }

  /** Find a user by email (for register duplicate check). */
  findByEmail(email: string) {
    return this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
  }

  /** Find a user by ID (for post-insert read-back of atomically-set fields). */
  findById(id: string) {
    return this.db
      .prepare('SELECT id, is_super_admin FROM users WHERE id = ?')
      .bind(id)
      .first<{ id: string; is_super_admin: number }>();
  }

  /** Find a user by username with all auth fields (for login). */
  findByUsernameWithAuth(username: string) {
    return this.db
      .prepare(
        'SELECT id, username, password_hash, email, name, avatar_url, is_super_admin, is_blocked FROM users WHERE username = ?',
      )
      .bind(username)
      .first<UserRow>();
  }

  /** Find a user's password hash by ID (for change-password). */
  findPasswordHash(userId: string) {
    return this.db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(userId)
      .first<{ password_hash: string }>();
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
    // Atomically determine is_super_admin at INSERT time — prevents the
    // bootstrap race where two concurrent registrations both see isSetup=false
    // (no users) and both get isSuperAdmin=1. The subquery evaluates inside
    // the same statement, so only the first INSERT (when COUNT=0) sets
    // is_super_admin=1; the second sees COUNT=1 and gets 0.
    return this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, email, name, is_super_admin)
         VALUES (?, ?, ?, ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 0 END)`,
      )
      .bind(params.id, params.username, params.passwordHash, params.email, params.name)
      .run();
  }

  /** Update a user's password hash. */
  updatePasswordHash(userId: string, passwordHash: string) {
    return this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, userId)
      .run();
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
    return this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, data, expires_at, touched_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(params.id, params.userId, params.data, params.expiresAt, params.touchedAt)
      .run();
  }

  /** Find a session row by ID (for auth-guard session validation). */
  findSession(sessionId: string) {
    return this.db
      .prepare('SELECT data, expires_at, touched_at FROM sessions WHERE id = ?')
      .bind(sessionId)
      .first<{ data: string; expires_at: number; touched_at: number }>();
  }

  /**
   * Optimistic-concurrency TTL extension: UPDATE only if `touched_at` still
   * matches the value we read. The `WHERE touched_at = ?` guard prevents a
   * lost-update race where two concurrent requests both try to extend the same
   * session — only the first wins, saving ~90% of D1 writes vs unconditional
   * extension on every request. Run by auth-guard when a session hasn't been
   * touched in over an hour.
   */
  touchSession(sessionId: string, newExpiresAt: number, now: number, oldTouchedAt: number) {
    return this.db
      .prepare('UPDATE sessions SET expires_at = ?, touched_at = ? WHERE id = ? AND touched_at = ?')
      .bind(newExpiresAt, now, sessionId, oldTouchedAt)
      .run();
  }

  /** Delete a session by ID (for logout + expired/corrupted-session self-heal). */
  deleteSessionById(sessionId: string) {
    return this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }

  /** Delete all sessions for a user except the current one (for change-password). */
  deleteOtherSessions(userId: string, currentSessionId: string) {
    return this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .bind(userId, currentSessionId)
      .run();
  }

  /** Delete all sessions for a user (for sessions/revoke). */
  deleteAllSessions(userId: string) {
    return this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  }

  /** Delete sessions whose `expires_at` is before `now` (cron cleanup). */
  deleteExpiredSessions(now: number) {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  }

  // ─── oauth_states ───

  /**
   * Persist a PKCE state + code_verifier + userId for an OAuth flow. The
   * `created_at` timestamp drives a 10-min TTL (enforced by cleanup). Run by
   * `buildDriveOAuthUrl` (shared by auth.ts /google and drives.ts /connect).
   */
  insertOAuthState(state: string, codeVerifier: string, userId: string, createdAt: number) {
    return this.db
      .prepare(
        'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(state, codeVerifier, userId, createdAt)
      .run();
  }

  /** Delete OAuth states older than `cutoff` (cron cleanup, 10-min TTL). */
  deleteExpiredOAuthStates(cutoff: number) {
    return this.db.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(cutoff).run();
  }

  // ─── invitation_codes ───

  /**
   * Atomically consume an invitation code (no TOCTOU race).
   * Returns the consumed ID, or null if the code doesn't exist or is exhausted.
   */
  consumeInvitation(code: string) {
    return this.db
      .prepare(
        'UPDATE invitation_codes SET used_count = used_count + 1 WHERE code = ? AND (max_uses <= 0 OR used_count < max_uses) RETURNING id',
      )
      .bind(code)
      .first<{ id: string }>();
  }

  /** Check if an invitation code exists (for error messaging). */
  findInvitation(code: string) {
    return this.db
      .prepare('SELECT id FROM invitation_codes WHERE code = ?')
      .bind(code)
      .first<InvitationCodeRow>();
  }
}
