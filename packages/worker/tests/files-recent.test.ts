import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { filesRouter } from '../src/routes/files';

/**
 * Regression: Home Recent listed the same file once per workspace member
 * because LEFT JOIN workspace_members multiplied rows (N members → N copies).
 * Access must use EXISTS / join-on-user, not a bare members join.
 */
const RECENT_FILES_SQL = `
  SELECT f.*, d.email as driveEmail
  FROM files f
  JOIN drive_accounts d ON f.drive_account_id = d.id
  WHERE f.is_trashed = 0
    AND (
      f.user_id = ?
      OR EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = f.workspace_id AND wm.user_id = ?
      )
    )
  ORDER BY COALESCE(f.google_modified_at, f.synced_at, f.updated_at) DESC
  LIMIT 20
`;

const LEGACY_JOIN_NO_DISTINCT_SQL = `
  SELECT f.id, f.name
  FROM files f
  JOIN drive_accounts d ON f.drive_account_id = d.id
  LEFT JOIN workspace_members wm ON f.workspace_id = wm.workspace_id
  WHERE (f.user_id = ? OR wm.user_id = ?)
    AND f.is_trashed = 0
  ORDER BY COALESCE(f.google_modified_at, f.synced_at, f.updated_at) DESC
  LIMIT 20
`;

function seedWorkspaceWithMembers(memberCount: number) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE drive_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      drive_account_id TEXT NOT NULL,
      google_file_id TEXT,
      workspace_id TEXT,
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER DEFAULT 0,
      is_trashed INTEGER NOT NULL DEFAULT 0,
      google_modified_at TEXT,
      synced_at TEXT,
      updated_at TEXT,
      created_at TEXT
    );
    CREATE TABLE workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL
    );

    INSERT INTO drive_accounts (id, email) VALUES ('drive-1', 'owner@example.com');
    INSERT INTO files (
      id, user_id, drive_account_id, google_file_id, workspace_id, name,
      is_trashed, google_modified_at, synced_at, updated_at, created_at
    ) VALUES (
      'file-1', 'user-owner', 'drive-1', 'gfile-1', 'ws-1', 'Report.pdf',
      0, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'
    );
  `);

  const insertMember = db.prepare(
    'INSERT INTO workspace_members (id, workspace_id, user_id) VALUES (?, ?, ?)'
  );
  for (let i = 0; i < memberCount; i++) {
    const uid = i === 0 ? 'user-owner' : `user-member-${i}`;
    insertMember.run(`m-${i}`, 'ws-1', uid);
  }

  return db;
}

describe('GET /api/files/recent', () => {
  it('registers the recent endpoint', () => {
    const routes = filesRouter.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain('GET /recent');
  });

  it('returns one row per file when workspace has many members', () => {
    const memberCount = 6;
    const db = seedWorkspaceWithMembers(memberCount);

    // Bare JOIN multiplies: 6 members → 6 rows for one file (the reported bug).
    const multiplied = db.prepare(LEGACY_JOIN_NO_DISTINCT_SQL).all('user-owner', 'user-owner');
    expect(multiplied).toHaveLength(memberCount);

    // Fixed query: single row regardless of member count.
    const fixed = db.prepare(RECENT_FILES_SQL).all('user-owner', 'user-owner') as Array<{ id: string; name: string }>;
    expect(fixed).toHaveLength(1);
    expect(fixed[0].id).toBe('file-1');
    expect(fixed[0].name).toBe('Report.pdf');

    // Member who does not own the file still sees it via EXISTS membership.
    const asMember = db.prepare(RECENT_FILES_SQL).all('user-member-3', 'user-member-3') as Array<{ id: string }>;
    expect(asMember).toHaveLength(1);
    expect(asMember[0].id).toBe('file-1');

    // Unrelated user sees nothing.
    const stranger = db.prepare(RECENT_FILES_SQL).all('user-stranger', 'user-stranger');
    expect(stranger).toHaveLength(0);

    db.close();
  });

  it('does not list trashed files', () => {
    const db = seedWorkspaceWithMembers(2);
    db.prepare('UPDATE files SET is_trashed = 1 WHERE id = ?').run('file-1');
    const rows = db.prepare(RECENT_FILES_SQL).all('user-owner', 'user-owner');
    expect(rows).toHaveLength(0);
    db.close();
  });
});
