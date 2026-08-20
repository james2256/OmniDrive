import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRepository } from '../src/repositories/auth.repository';

/**
 * Direct unit tests for AuthRepository. Each method is exercised in isolation
 * against a mocked D1 (prepare/bind/all/first/run chain). Verifies SQL fragments
 * and bind values. Complementary to integration/repositories.test.ts (which
 * exercises the same repository through a real D1 / Miniflare).
 *
 * NOTE: the task spec referenced methods named `findById`, `findByGoogleId`,
 * `create`, `updateName` — those do not exist on AuthRepository. Tests cover
 * the actual exports (countUsers, findByUsername, findByEmail, findByUsernameWithAuth,
 * findPasswordHash, insertUser, updatePasswordHash, insertSession, deleteSessionById,
 * deleteOtherSessions, deleteAllSessions, consumeInvitation, findInvitation).
 */

describe('AuthRepository', () => {
  let repo: AuthRepository;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let mockBind: ReturnType<typeof vi.fn>;
  let mockAll: ReturnType<typeof vi.fn>;
  let mockFirst: ReturnType<typeof vi.fn>;
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll = vi.fn().mockResolvedValue({ results: [] });
    mockFirst = vi.fn().mockResolvedValue(null);
    mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    mockBind = vi.fn().mockReturnValue({ all: mockAll, first: mockFirst, run: mockRun });
    mockPrepare = vi.fn().mockReturnValue({
      bind: mockBind,
      all: mockAll,
      first: mockFirst,
      run: mockRun,
    });
    const mockDb = { prepare: mockPrepare } as any;
    repo = new AuthRepository(mockDb);
  });

  // ─── users reads ───

  describe('countUsers', () => {
    it('SELECTs COUNT(*) as count with no bind', async () => {
      mockFirst.mockResolvedValueOnce({ count: 5 });

      const result = await repo.countUsers();

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as count FROM users'),
      );
      expect(mockBind).not.toHaveBeenCalled();
      expect(result).toEqual({ count: 5 });
    });
  });

  describe('findByUsername', () => {
    it('selects id by username with a single bind', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'u1' });

      const result = await repo.findByUsername('alice');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE username = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('alice');
      expect(result).toEqual({ id: 'u1' });
    });

    it('returns null when the username is not found', async () => {
      mockFirst.mockResolvedValueOnce(null);
      const result = await repo.findByUsername('nobody');
      expect(result).toBeNull();
      expect(mockBind).toHaveBeenCalledWith('nobody');
    });
  });

  describe('findByEmail', () => {
    it('selects id by email with a single bind', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'u1' });

      const result = await repo.findByEmail('a@b.com');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE email = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('a@b.com');
      expect(result).toEqual({ id: 'u1' });
    });
  });

  describe('findByUsernameWithAuth', () => {
    it('selects all auth fields needed for login verification', async () => {
      mockFirst.mockResolvedValueOnce({
        id: 'u1',
        username: 'alice',
        password_hash: '$2a$...',
        email: 'a@b.com',
        name: 'Alice',
        avatar_url: null,
        is_super_admin: 1,
        is_blocked: 0,
      });

      const result = await repo.findByUsernameWithAuth('alice');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT id, username, password_hash, email, name, avatar_url');
      expect(sql).toContain('is_super_admin, is_blocked');
      expect(sql).toContain('FROM users WHERE username = ?');
      expect(mockBind).toHaveBeenCalledWith('alice');
      expect(result).toEqual(expect.objectContaining({ id: 'u1', is_super_admin: 1 }));
    });
  });

  describe('findPasswordHash', () => {
    it('selects password_hash by user id', async () => {
      mockFirst.mockResolvedValueOnce({ password_hash: '$2a$hash' });

      const result = await repo.findPasswordHash('u-1');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT password_hash FROM users WHERE id = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ password_hash: '$2a$hash' });
    });
  });

  // ─── users mutations ───

  describe('insertUser', () => {
    it('INSERTs a user with 5 fields (is_super_admin set atomically by DB subquery)', async () => {
      await repo.insertUser({
        id: 'u-new',
        username: 'carol',
        passwordHash: '$2a$hash',
        email: 'c@d.com',
        name: 'Carol',
        isSuperAdmin: 1, // ignored — DB subquery (CASE WHEN COUNT=0) overrides
      });

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
      // Only 5 binds — is_super_admin is computed by the SQL subquery, not bound
      expect(mockBind).toHaveBeenCalledWith('u-new', 'carol', '$2a$hash', 'c@d.com', 'Carol');
    });

    it('passes null email through unchanged (column accepts NULL)', async () => {
      await repo.insertUser({
        id: 'u-2',
        username: 'dave',
        passwordHash: '$2a$hash',
        email: null,
        name: 'Dave',
        isSuperAdmin: 0,
      });

      expect(mockBind).toHaveBeenCalledWith('u-2', 'dave', '$2a$hash', null, 'Dave');
    });
  });

  describe('updatePasswordHash', () => {
    it('UPDATEs password_hash, binds new hash then userId', async () => {
      await repo.updatePasswordHash('u-1', '$2a$newhash');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET password_hash = ? WHERE id = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('$2a$newhash', 'u-1');
    });
  });

  // ─── sessions ───

  describe('insertSession', () => {
    it('INSERTs a session row with id, user_id, data, expires_at, touched_at', async () => {
      await repo.insertSession({
        id: 's-1',
        userId: 'u-1',
        data: '{"userId":"u-1"}',
        expiresAt: 1700000000,
        touchedAt: 1699999000,
      });

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sessions'));
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('(id, user_id, data, expires_at, touched_at)');
      expect(mockBind).toHaveBeenCalledWith(
        's-1',
        'u-1',
        '{"userId":"u-1"}',
        1700000000,
        1699999000,
      );
    });
  });

  describe('deleteSessionById', () => {
    it('DELETEs a single session by id', async () => {
      await repo.deleteSessionById('s-1');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions WHERE id = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('s-1');
    });
  });

  describe('deleteOtherSessions', () => {
    it('DELETEs sessions for a user except the current one (id != ?)', async () => {
      await repo.deleteOtherSessions('u-1', 'current-session');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM sessions WHERE user_id = ? AND id != ?');
      expect(mockBind).toHaveBeenCalledWith('u-1', 'current-session');
    });
  });

  describe('deleteAllSessions', () => {
    it('DELETEs all sessions for a user', async () => {
      await repo.deleteAllSessions('u-1');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions WHERE user_id = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('u-1');
    });
  });

  // ─── invitation_codes ───

  describe('consumeInvitation', () => {
    it('atomically increments used_count + returns id when code is valid and under cap', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'inv-1' });

      const result = await repo.consumeInvitation('CODE123');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE invitation_codes SET used_count = used_count + 1');
      expect(sql).toContain('WHERE code = ?');
      expect(sql).toContain('(max_uses <= 0 OR used_count < max_uses)');
      expect(sql).toContain('RETURNING id');
      expect(mockBind).toHaveBeenCalledWith('CODE123');
      expect(result).toEqual({ id: 'inv-1' });
    });

    it('returns null when the code is exhausted or does not exist', async () => {
      mockFirst.mockResolvedValueOnce(null);

      const result = await repo.consumeInvitation('EXHAUSTED');

      expect(result).toBeNull();
      expect(mockBind).toHaveBeenCalledWith('EXHAUSTED');
    });
  });

  describe('findInvitation', () => {
    it('selects id by code (existence check, no consumption)', async () => {
      mockFirst.mockResolvedValueOnce({ id: 'inv-1' });

      const result = await repo.findInvitation('CODE123');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM invitation_codes WHERE code = ?'),
      );
      expect(mockBind).toHaveBeenCalledWith('CODE123');
      expect(result).toEqual({ id: 'inv-1' });
    });
  });

  // ─── PR 3: session read/touch + oauth_states + cron cleanup ───

  describe('findSession', () => {
    it('SELECTs data, expires_at, touched_at by session id via .first()', async () => {
      mockFirst.mockResolvedValueOnce({ data: '{}', expires_at: 999, touched_at: 0 });

      const result = await repo.findSession('sess-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('SELECT data, expires_at, touched_at FROM sessions WHERE id = ?');
      expect(mockBind).toHaveBeenCalledWith('sess-1');
      expect(result).toEqual({ data: '{}', expires_at: 999, touched_at: 0 });
    });
  });

  describe('touchSession', () => {
    it('UPDATEs expires_at + touched_at with optimistic-concurrency guard (4 binds)', async () => {
      await repo.touchSession('sess-1', 9999, 1234, 1000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'UPDATE sessions SET expires_at = ?, touched_at = ? WHERE id = ? AND touched_at = ?',
      );
      // Binds: newExpiresAt, now, sessionId, oldTouchedAt.
      expect(mockBind).toHaveBeenCalledWith(9999, 1234, 'sess-1', 1000);
    });
  });

  describe('deleteExpiredSessions', () => {
    it('DELETEs sessions by expires_at < now, single bind', async () => {
      await repo.deleteExpiredSessions(1700000000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM sessions WHERE expires_at < ?');
      expect(mockBind).toHaveBeenCalledWith(1700000000);
    });
  });

  describe('insertOAuthState', () => {
    it('INSERTs PKCE state with 4 binds (state, verifier, userId, createdAt)', async () => {
      await repo.insertOAuthState('state-1', 'verifier-1', 'u-1', 1700000000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe(
        'INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)',
      );
      expect(mockBind).toHaveBeenCalledWith('state-1', 'verifier-1', 'u-1', 1700000000);
    });
  });

  describe('deleteExpiredOAuthStates', () => {
    it('DELETEs oauth_states by created_at < cutoff, single bind', async () => {
      await repo.deleteExpiredOAuthStates(1700000000);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toBe('DELETE FROM oauth_states WHERE created_at < ?');
      expect(mockBind).toHaveBeenCalledWith(1700000000);
    });
  });
});
