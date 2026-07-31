import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { ensureSchema, clearAllTables } from './helpers';
import { AdminRepository } from '../../src/repositories/admin.repository';
import { S3CredentialsRepository } from '../../src/repositories/s3-credentials.repository';
import { AutomationRepository } from '../../src/repositories/automation.repository';
import { DriveRepository } from '../../src/repositories/drive.repository';
import { FolderRepository } from '../../src/repositories/folder.repository';
import { WorkspaceRepository } from '../../src/repositories/workspace.repository';
import { SharedRepository } from '../../src/repositories/shared.repository';
import { SyncStateRepository } from '../../src/repositories/sync-state.repository';
import { AuditRepository } from '../../src/repositories/audit.repository';
import { hashPassword } from '../../src/lib/password';

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database;
    KV: KVNamespace;
    JWT_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    FRONTEND_URL: string;
    WORKER_URL: string;
  }
}

async function insertUser(
  id: string,
  username: string,
  isSuperAdmin = 0,
  email: string | null = null,
): Promise<void> {
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin, email) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, username, passwordHash, isSuperAdmin, email)
    .run();
}

async function insertDrive(
  driveId: string,
  userId: string,
  email: string,
  isPrimary = 0,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, is_primary, root_folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(driveId, userId, `g-${driveId}`, email, email, isPrimary, null)
    .run();
}

describe('Repositories (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
  });

  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  // ─── 8.1 Admin: list users + invitations + audit logs ───
  describe('AdminRepository', () => {
    it('findAllUsers returns all users with limited fields', async () => {
      await insertUser('u1', 'alice', 1);
      await insertUser('u2', 'bob', 0);

      const repo = new AdminRepository(env.DB);
      const { results } = await repo.findAllUsers();

      expect(results.length).toBe(2);
      const alice = results.find((u: any) => u.username === 'alice');
      expect(alice).toBeTruthy();
      expect(alice.is_super_admin).toBe(1);
      // Limited fields only — no password_hash
      expect((alice as any).password_hash).toBeUndefined();
    });

    it('findAllInvitations returns invitation codes', async () => {
      await insertUser('u1', 'admin', 1);
      await env.DB.prepare(
        'INSERT INTO invitation_codes (id, code, created_by, max_uses) VALUES (?, ?, ?, ?)',
      )
        .bind('inv1', 'CODE123', 'u1', 5)
        .run();

      const repo = new AdminRepository(env.DB);
      const { results } = await repo.findAllInvitations();

      expect(results.length).toBe(1);
      expect((results[0] as any).code).toBe('CODE123');
      expect((results[0] as any).max_uses).toBe(5);
    });

    it('findRecentAuditLogs joins actor email + workspace name', async () => {
      await insertUser('u1', 'admin', 1, 'admin@example.com');
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'Team Project', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, resource_id, resource_name) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind('log1', 'ws1', 'u1', 'file.delete', 'file-1', 'report.pdf')
        .run();

      const repo = new AdminRepository(env.DB);
      const { results } = await repo.findRecentAuditLogs();

      expect(results.length).toBe(1);
      const log = results[0] as any;
      expect(log.actor_email).toBe('admin@example.com');
      expect(log.workspace_name).toBe('Team Project');
      expect(log.action_type).toBe('file.delete');
    });

    // ─── 8.2 duplicate username/email → returns existing row ───
    it('findByUsername returns row when username exists', async () => {
      await insertUser('u1', 'alice', 1);
      const repo = new AdminRepository(env.DB);

      const existing = await repo.findByUsername('alice');
      expect(existing).toBeTruthy();
      expect((existing as any).id).toBe('u1');

      const absent = await repo.findByUsername('nobody');
      expect(absent).toBeNull();
    });

    it('findByEmail returns row when email exists', async () => {
      await insertUser('u1', 'alice', 1, 'alice@example.com');
      const repo = new AdminRepository(env.DB);

      const existing = await repo.findByEmail('alice@example.com');
      expect(existing).toBeTruthy();

      const absent = await repo.findByEmail('nobody@example.com');
      expect(absent).toBeNull();
    });

    // ─── 8.3 non-admin → findSuperAdminStatus returns 0 ───
    it('findSuperAdminStatus returns is_super_admin flag (0 for regular user)', async () => {
      await insertUser('u1', 'admin', 1);
      await insertUser('u2', 'member', 0);
      const repo = new AdminRepository(env.DB);

      const admin = await repo.findSuperAdminStatus('u1');
      expect(admin?.is_super_admin).toBe(1);

      const member = await repo.findSuperAdminStatus('u2');
      expect(member?.is_super_admin).toBe(0);
    });
  });

  // ─── 8.4 S3 credentials: create → list → delete ───
  describe('S3CredentialsRepository', () => {
    it('insert → findAllByUser → delete lifecycle', async () => {
      await insertUser('u1', 'alice', 1);
      const repo = new S3CredentialsRepository(env.DB);

      // Insert
      await repo.insert({
        id: 'k1',
        userId: 'u1',
        accessKeyId: 'OMNIKEY123',
        secretKeyEnc: 'encrypted-secret',
        description: 'rclone key',
        workspaceId: null,
      });

      // List
      const { results: list1 } = await repo.findAllByUser('u1');
      expect(list1.length).toBe(1);
      const key = list1[0] as any;
      expect(key.access_key_id).toBe('OMNIKEY123');
      expect(key.description).toBe('rclone key');
      expect(key.workspace_id).toBeNull();

      // Delete
      await repo.delete('k1', 'u1');
      const { results: list2 } = await repo.findAllByUser('u1');
      expect(list2.length).toBe(0);
    });

    it('findAllByUser with workspace scope joins workspace name', async () => {
      await insertUser('u1', 'alice', 1);
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'Scoped Workspace', 'u1')
        .run();

      const repo = new S3CredentialsRepository(env.DB);
      await repo.insert({
        id: 'k1',
        userId: 'u1',
        accessKeyId: 'OMNISCOPED',
        secretKeyEnc: 'enc',
        description: 'scoped key',
        workspaceId: 'ws1',
      });

      const { results } = await repo.findAllByUser('u1');
      expect(results.length).toBe(1);
      expect((results[0] as any).workspace_name).toBe('Scoped Workspace');
    });

    it('delete only affects the specified user (no cross-user deletion)', async () => {
      await insertUser('u1', 'alice', 1);
      await insertUser('u2', 'bob', 1);
      const repo = new S3CredentialsRepository(env.DB);

      await repo.insert({
        id: 'k1',
        userId: 'u1',
        accessKeyId: 'OMNI1',
        secretKeyEnc: 'e1',
        description: null,
        workspaceId: null,
      });
      await repo.insert({
        id: 'k2',
        userId: 'u2',
        accessKeyId: 'OMNI2',
        secretKeyEnc: 'e2',
        description: null,
        workspaceId: null,
      });

      // bob tries to delete alice's key
      await repo.delete('k1', 'u2');

      // alice's key still exists
      const { results } = await repo.findAllByUser('u1');
      expect(results.length).toBe(1);
    });
  });

  // ─── 8.5 Automations: create → toggle → 404 on wrong user ───
  describe('AutomationRepository', () => {
    it('insert → toggleActive → toggleActive returns false for wrong user', async () => {
      await insertUser('u1', 'alice', 1);
      await insertUser('u2', 'bob', 1);
      const repo = new AutomationRepository(env.DB);

      // Insert
      await repo.insert({
        id: 'r1',
        userId: 'u1',
        name: 'Auto-move PDFs',
        triggerType: 'file_create',
        triggerConfig: '{}',
        conditions: '{}',
        actions: '{}',
      });

      // Toggle off (alice's own rule)
      const toggled = await repo.toggleActive('r1', 'u1', 0);
      expect(toggled).toBe(true);

      const { results: afterToggle } = await repo.findAllByUser('u1');
      expect((afterToggle[0] as any).is_active).toBe(0);

      // Toggle with wrong user (bob) → returns false, no change
      const wrongUser = await repo.toggleActive('r1', 'u2', 1);
      expect(wrongUser).toBe(false);

      const { results: afterWrong } = await repo.findAllByUser('u1');
      expect((afterWrong[0] as any).is_active).toBe(0); // unchanged
    });
  });

  // ─── 8.6 Drive listing: returns drives with sync state ───
  describe('DriveRepository', () => {
    it('findAllWithSyncState returns drives with LEFT JOIN sync_state', async () => {
      await insertUser('u1', 'alice', 1);
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await insertDrive('d2', 'u1', 'bob@gmail.com', 0);

      // Add sync_state for d1 only (d2 has no row → LEFT JOIN yields nulls)
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status, last_synced_at) VALUES (?, 'syncing', ?)",
      )
        .bind('d1', '2026-01-01 10:00:00')
        .run();

      const repo = new DriveRepository(env.DB);
      const { results } = await repo.findAllWithSyncState('u1');

      expect(results.length).toBe(2);
      const d1 = results.find((d: any) => d.id === 'd1') as any;
      const d2 = results.find((d: any) => d.id === 'd2') as any;
      expect(d1.sync_status).toBe('syncing');
      expect(d1.last_synced_at).toBe('2026-01-01 10:00:00');
      // d2 has no sync_state row → null fields
      expect(d2.sync_status).toBeNull();
      expect(d2.sync_paused).toBe(0); // CASE WHEN next_page_token IS NOT NULL → 0
    });

    // ─── 8.7 marks auth_expired when no tokens ───
    it('findTokenStatus returns null when no tokens exist', async () => {
      await insertUser('u1', 'alice', 1);
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);

      const repo = new DriveRepository(env.DB);
      const status = await repo.findTokenStatus('d1');
      expect(status).toBeNull(); // no drive_tokens row → auth_expired
    });

    it('findTokenStatus returns { ok: 1 } when tokens exist', async () => {
      await insertUser('u1', 'alice', 1);
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await env.DB.prepare(
        'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?)',
      )
        .bind('d1', 'encrypted-token-blob', Date.now())
        .run();

      const repo = new DriveRepository(env.DB);
      const status = await repo.findTokenStatus('d1');
      expect(status?.ok).toBe(1);
    });

    // ─── 8.8 external: returns only top-level external entry points ───
    it('findExternalFolders + findExternalFiles return only items whose immediate parent is __shared__', async () => {
      await insertUser('u1', 'alice', 1);
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);

      // Computer backup root (parent='__shared__', owned_by_me=1) — TOP LEVEL, should show
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('df1', 'd1', 'gfolder1', '__shared__', 'My Laptop', 1, 0)
        .run();

      // Folder shared WITH me by someone else (parent='__shared__', owned_by_me=0) — should NOT show (not mine)
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('df3', 'd1', 'gfolder3', '__shared__', 'A Shared Folder', 0, 0)
        .run();

      // Subfolder inside My Laptop (parent=gfolder1, NOT __shared__) — should NOT show at top level
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('df4', 'd1', 'gfolder4', 'gfolder1', 'DRIVE BACKUP', 1, 0)
        .run();

      // Deeper subfolder (parent=gfolder4) — should NOT show at top level
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('df5', 'd1', 'gfolder5', 'gfolder4', 'BY', 1, 0)
        .run();

      // My Drive folder (parent='root') — should NOT show
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('df2', 'd1', 'gfolder2', 'root', 'My Folder', 1, 0)
        .run();

      // File at shared root (parent='__shared__', owned_by_me=1) — should show
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('f1', 'u1', 'd1', 'gfile1', '__shared__', 'loose-shared.pdf', 1, 0)
        .run();

      // File shared WITH me at shared root (parent='__shared__', owned_by_me=0) — should NOT show (not mine)
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('f4', 'u1', 'd1', 'gfile4', '__shared__', 'someone-elses.pdf', 0, 0)
        .run();

      // File inside My Laptop (parent=gfolder1) — should NOT show at top level
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('f3', 'u1', 'd1', 'gfile3', 'gfolder1', 'backup-config.txt', 1, 0)
        .run();

      // My Drive file (parent='root') — should NOT show
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('f2', 'u1', 'd1', 'gfile2', 'root', 'mine.docx', 1, 0)
        .run();

      const repo = new DriveRepository(env.DB);
      const { results: folders } = await repo.findExternalFolders('u1');
      const { results: files } = await repo.findExternalFiles('u1', null, 50);

      // Only df1 (My Laptop) — owned_by_me=1, parent='__shared__'
      // NOT df2 (My Drive), df3 (owned_by_me=0), df4 (inside My Laptop), df5 (deeper inside)
      expect(folders.length).toBe(1);
      expect((folders[0] as any).name).toBe('My Laptop');

      // Only f1 (loose file you own at shared root)
      // NOT f2 (My Drive), f3 (inside My Laptop), f4 (owned_by_me=0)
      expect(files.length).toBe(1);
      expect((files[0] as any).name).toBe('loose-shared.pdf');
    });
  });

  // ─── SyncStateRepository: cross-isolate lock + cursor persistence ───

  describe('SyncStateRepository', () => {
    it('acquireLock inserts a syncing row on first acquire and returns the drive id', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);

      const repo = new SyncStateRepository(env.DB);
      const acquired = await repo.acquireLock('d1');

      expect(acquired).toEqual({ drive_account_id: 'd1' });
      const row = await env.DB.prepare('SELECT status FROM sync_state WHERE drive_account_id = ?')
        .bind('d1')
        .first<{ status: string }>();
      expect(row?.status).toBe('syncing');
    });

    it('acquireLock returns null when the drive is already syncing (lock denied)', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      // Seed an existing 'syncing' row — simulates another isolate mid-sync.
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status) VALUES (?, 'syncing')",
      )
        .bind('d1')
        .run();

      const repo = new SyncStateRepository(env.DB);
      const acquired = await repo.acquireLock('d1');

      expect(acquired).toBeNull();
    });

    it('acquireLock re-acquires when status is idle (clears a prior error_message)', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status, error_message) VALUES (?, 'idle', 'old error')",
      )
        .bind('d1')
        .run();

      const repo = new SyncStateRepository(env.DB);
      const acquired = await repo.acquireLock('d1');

      expect(acquired).toEqual({ drive_account_id: 'd1' });
      const row = await env.DB.prepare(
        'SELECT status, error_message FROM sync_state WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ status: string; error_message: string | null }>();
      expect(row?.status).toBe('syncing');
      expect(row?.error_message).toBeNull(); // cleared on re-acquire
    });

    it('findSyncState returns the persisted change_token + next_page_token', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await env.DB.prepare(
        'INSERT INTO sync_state (drive_account_id, status, change_token, next_page_token) VALUES (?, ?, ?, ?)',
      )
        .bind('d1', 'idle', 'tok-1', 'page-2')
        .run();

      const repo = new SyncStateRepository(env.DB);
      const state = await repo.findSyncState('d1');

      expect(state?.change_token).toBe('tok-1');
      expect(state?.next_page_token).toBe('page-2');
    });

    it('setIdle marks a paused sync idle without touching change_token', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status, change_token, next_page_token) VALUES (?, 'syncing', ?, ?)",
      )
        .bind('d1', 'tok-keep', 'resume-page')
        .run();

      const repo = new SyncStateRepository(env.DB);
      await repo.setIdle('d1');

      const row = await env.DB.prepare(
        'SELECT status, change_token, next_page_token FROM sync_state WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ status: string; change_token: string | null; next_page_token: string | null }>();
      expect(row?.status).toBe('idle');
      // setIdle (paused path) must NOT clear the change_token or next_page_token —
      // the next cron cycle resumes from them.
      expect(row?.change_token).toBe('tok-keep');
      expect(row?.next_page_token).toBe('resume-page');
    });

    it('upsertIdleCompleted sets idle + change_token and clears next_page_token', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      // Row exists (created by the lock) with a paused next_page_token.
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status, change_token, next_page_token) VALUES (?, 'syncing', NULL, 'resume-page')",
      )
        .bind('d1')
        .run();

      const repo = new SyncStateRepository(env.DB);
      await repo.upsertIdleCompleted('d1', 'fresh-token');

      const row = await env.DB.prepare(
        'SELECT status, change_token, next_page_token, last_synced_at FROM sync_state WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{
          status: string;
          change_token: string | null;
          next_page_token: string | null;
          last_synced_at: string | null;
        }>();
      expect(row?.status).toBe('idle');
      expect(row?.change_token).toBe('fresh-token');
      expect(row?.next_page_token).toBeNull(); // cleared on completion
      expect(row?.last_synced_at).not.toBeNull();
    });

    it('upsertError sets status=error + error_message', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status) VALUES (?, 'syncing')",
      )
        .bind('d1')
        .run();

      const repo = new SyncStateRepository(env.DB);
      await repo.upsertError('d1', 'rate limit exceeded');

      const row = await env.DB.prepare(
        'SELECT status, error_message FROM sync_state WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ status: string; error_message: string | null }>();
      expect(row?.status).toBe('error');
      expect(row?.error_message).toBe('rate limit exceeded');
    });

    it('updateNextPageToken saves the resume checkpoint', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);
      await env.DB.prepare(
        "INSERT INTO sync_state (drive_account_id, status) VALUES (?, 'syncing')",
      )
        .bind('d1')
        .run();

      const repo = new SyncStateRepository(env.DB);
      await repo.updateNextPageToken('d1', 'page-45');

      const row = await env.DB.prepare(
        'SELECT next_page_token FROM sync_state WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ next_page_token: string | null }>();
      expect(row?.next_page_token).toBe('page-45');
    });
  });

  // ─── Cascade delete tests (D1 FKs are OFF — manual cascade required) ───

  describe('FolderRepository.delete (cascade)', () => {
    it('cascades to subfolders at arbitrary depth (recursive CTE in DELETE context)', async () => {
      await insertUser('u1', 'alice');
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'WS', 'u1')
        .run();
      // Build a 4-level folder tree: L1 → L2 → L3 → L4 (tests arbitrary-depth recursion)
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f1', 'ws1', 'L1', null)
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f2', 'ws1', 'L2', 'f1')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f3', 'ws1', 'L3', 'f2')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f4', 'ws1', 'L4', 'f3')
        .run();

      const repo = new FolderRepository(env.DB);
      await repo.delete('f1');

      // All 4 folders must be gone (recursive CTE walked parent_id chain)
      const remaining = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM workspace_folders WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(remaining!.count).toBe(0);
    });

    it('detaches files from deleted folder (workspace_folder_id → NULL)', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com');
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'WS', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f1', 'ws1', 'Folder', null)
        .run();
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, workspace_folder_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind('file1', 'u1', 'd1', 'gfile1', 'ws1', 'f1', 'doc.pdf')
        .run();

      const repo = new FolderRepository(env.DB);
      await repo.delete('f1');

      // File survives but workspace_folder_id is NULL (ON DELETE SET NULL intent)
      const file = await env.DB.prepare('SELECT workspace_folder_id FROM files WHERE id = ?')
        .bind('file1')
        .first<{ workspace_folder_id: string | null }>();
      expect(file).toBeTruthy();
      expect(file!.workspace_folder_id).toBeNull();
    });

    it('deletes folder-scoped policies (workspace_policies.target_id)', async () => {
      await insertUser('u1', 'alice');
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'WS', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f1', 'ws1', 'Folder', null)
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(
          'p1',
          'ws1',
          'folder',
          'f1',
          'data_retention',
          JSON.stringify({ action: 'prevent_deletion' }),
        )
        .run();

      const repo = new FolderRepository(env.DB);
      await repo.delete('f1');

      // Folder-scoped policy must be gone (cascade)
      const policy = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM workspace_policies WHERE target_id = ?',
      )
        .bind('f1')
        .first<{ count: number }>();
      expect(policy!.count).toBe(0);
    });
  });

  describe('WorkspaceRepository.delete (cascade)', () => {
    it('cascades to all dependent tables', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com');
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'WS', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
      )
        .bind('m1', 'ws1', 'u1', 'owner')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
      )
        .bind('f1', 'ws1', 'Folder', null)
        .run();
      await env.DB.prepare(
        'INSERT INTO s3_lifecycle_rules (id, workspace_id, prefix, expiration_days) VALUES (?, ?, ?, ?)',
      )
        .bind('lr1', 'ws1', '', 30)
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_policies (id, workspace_id, target_type, policy_type, config) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('p1', 'ws1', 'workspace', 'storage_quota', '{}')
        .run();
      await env.DB.prepare(
        'INSERT INTO s3_credentials (id, user_id, access_key_id, secret_key_enc, workspace_id) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('sc1', 'u1', 'AKIA1', 'enc1', 'ws1')
        .run();
      await env.DB.prepare(
        'INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind('mu1', 'u1', 'ws1', 'key1', 'd1', 'temp1')
        .run();
      await env.DB.prepare(
        'INSERT INTO s3_multipart_parts (upload_id, part_number, google_file_id, etag, size) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('mu1', 1, 'gfile1', 'etag1', 100)
        .run();
      await env.DB.prepare(
        'INSERT INTO audit_logs (id, workspace_id, actor_id, action_type) VALUES (?, ?, ?, ?)',
      )
        .bind('al1', 'ws1', 'u1', 'create')
        .run();
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, workspace_id, name) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind('file1', 'u1', 'd1', 'gfile1', 'ws1', 'doc.pdf')
        .run();

      const repo = new WorkspaceRepository(env.DB);
      await repo.delete('ws1');

      // workspace row gone
      const ws = await env.DB.prepare('SELECT COUNT(*) as count FROM workspaces WHERE id = ?')
        .bind('ws1')
        .first<{ count: number }>();
      expect(ws!.count).toBe(0);
      // workspace_members gone
      const members = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(members!.count).toBe(0);
      // workspace_folders gone
      const folders = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM workspace_folders WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(folders!.count).toBe(0);
      // s3_lifecycle_rules gone
      const rules = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM s3_lifecycle_rules WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(rules!.count).toBe(0);
      // workspace_policies gone
      const policies = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM workspace_policies WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(policies!.count).toBe(0);
      // s3_credentials gone
      const creds = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM s3_credentials WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(creds!.count).toBe(0);
      // s3_multipart_uploads + parts gone
      const uploads = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM s3_multipart_uploads WHERE workspace_id = ?',
      )
        .bind('ws1')
        .first<{ count: number }>();
      expect(uploads!.count).toBe(0);
      const parts = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM s3_multipart_parts WHERE upload_id = ?',
      )
        .bind('mu1')
        .first<{ count: number }>();
      expect(parts!.count).toBe(0);
      // audit_logs: workspace_id NULLed (ON DELETE SET NULL intent)
      const audit = await env.DB.prepare('SELECT workspace_id FROM audit_logs WHERE id = ?')
        .bind('al1')
        .first<{ workspace_id: string | null }>();
      expect(audit!.workspace_id).toBeNull();
      // files: workspace_id NULLed (files survive, detached)
      const file = await env.DB.prepare('SELECT workspace_id FROM files WHERE id = ?')
        .bind('file1')
        .first<{ workspace_id: string | null }>();
      expect(file!.workspace_id).toBeNull();
    });
  });

  describe('DriveRepository.deleteDrive (cascade)', () => {
    it('cascades to drive_folders, files, sync_state, quota_cache, drive_tokens', async () => {
      await insertUser('u1', 'alice');
      await insertDrive('d1', 'u1', 'alice@gmail.com');
      // drive_tokens
      await env.DB.prepare(
        'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?)',
      )
        .bind('d1', 'enc', Date.now())
        .run();
      // sync_state
      await env.DB.prepare('INSERT INTO sync_state (drive_account_id, status) VALUES (?, ?)')
        .bind('d1', 'idle')
        .run();
      // quota_cache
      await env.DB.prepare(
        'INSERT INTO quota_cache (drive_account_id, payload, updated_at) VALUES (?, ?, ?)',
      )
        .bind('d1', '{}', Date.now())
        .run();
      // drive_folders
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, name) VALUES (?, ?, ?, ?)',
      )
        .bind('df1', 'd1', 'gfolder1', 'Folder')
        .run();
      // files
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, name) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('file1', 'u1', 'd1', 'gfile1', 'doc.pdf')
        .run();
      // s3_multipart_uploads (drive_account_id FK)
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws1', 'WS', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind('mu1', 'u1', 'ws1', 'key1', 'd1', 'temp1')
        .run();
      await env.DB.prepare(
        'INSERT INTO s3_multipart_parts (upload_id, part_number, google_file_id, etag, size) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('mu1', 1, 'gfile1', 'etag1', 100)
        .run();

      const repo = new DriveRepository(env.DB);
      await repo.deleteDrive('d1', 'u1');

      // drive_accounts gone
      const drive = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM drive_accounts WHERE id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(drive!.count).toBe(0);
      // drive_tokens gone
      const tokens = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM drive_tokens WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(tokens!.count).toBe(0);
      // sync_state gone
      const sync = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM sync_state WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(sync!.count).toBe(0);
      // quota_cache gone
      const quota = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM quota_cache WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(quota!.count).toBe(0);
      // drive_folders gone
      const folders = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM drive_folders WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(folders!.count).toBe(0);
      // files gone
      const files = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM files WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(files!.count).toBe(0);
      // s3_multipart_uploads + parts gone
      const uploads = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM s3_multipart_uploads WHERE drive_account_id = ?',
      )
        .bind('d1')
        .first<{ count: number }>();
      expect(uploads!.count).toBe(0);
      const parts = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM s3_multipart_parts WHERE upload_id = ?',
      )
        .bind('mu1')
        .first<{ count: number }>();
      expect(parts!.count).toBe(0);
    });
  });

  describe('SharedRepository.delete (cascade)', () => {
    it('cascades to shared_link_logs', async () => {
      await insertUser('u1', 'alice');
      await env.DB.prepare(
        'INSERT INTO shared_links (id, user_id, target_type, target_id) VALUES (?, ?, ?, ?)',
      )
        .bind('sl1', 'u1', 'file', 'file1')
        .run();
      await env.DB.prepare('INSERT INTO shared_link_logs (shared_link_id, action) VALUES (?, ?)')
        .bind('sl1', 'view')
        .run();
      await env.DB.prepare('INSERT INTO shared_link_logs (shared_link_id, action) VALUES (?, ?)')
        .bind('sl1', 'download')
        .run();

      const repo = new SharedRepository(env.DB);
      await repo.delete('sl1', 'u1');

      // shared_links row gone
      const link = await env.DB.prepare('SELECT COUNT(*) as count FROM shared_links WHERE id = ?')
        .bind('sl1')
        .first<{ count: number }>();
      expect(link!.count).toBe(0);
      // shared_link_logs rows gone (cascade)
      const logs = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM shared_link_logs WHERE shared_link_id = ?',
      )
        .bind('sl1')
        .first<{ count: number }>();
      expect(logs!.count).toBe(0);
    });
  });

  // ─── PR 2: AuditRepository (write + retention cleanup) ───

  describe('AuditRepository', () => {
    it('insertLogStmt returns a Stmt that inserts a row when run', async () => {
      await insertUser('u1', 'alice', 1);
      const repo = new AuditRepository(env.DB);

      await repo
        .insertLogStmt({
          workspaceId: null,
          actorId: 'u1',
          actionType: 'user.login',
        })
        .run();

      const row = await env.DB.prepare(
        'SELECT actor_id, action_type FROM audit_logs WHERE actor_id = ?',
      )
        .bind('u1')
        .first<{ actor_id: string; action_type: string }>();
      expect(row?.actor_id).toBe('u1');
      expect(row?.action_type).toBe('user.login');
    });

    it('insertLogStmt composes into db.batch for atomic member+audit writes', async () => {
      await insertUser('u1', 'alice', 1);
      await insertUser('u2', 'bob', 0);
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws-1', 'WS', 'u1')
        .run();
      const auditRepo = new AuditRepository(env.DB);
      const workspaceRepo = new WorkspaceRepository(env.DB);

      // Simulate WorkspaceService.addMember: batch member INSERT + audit INSERT.
      await env.DB.batch([
        workspaceRepo.addMemberStmt('m-1', 'ws-1', 'u2', 'editor'),
        auditRepo.insertLogStmt({
          workspaceId: 'ws-1',
          actorId: 'u1',
          actionType: 'member.invite',
          resourceId: 'u2',
          metadata: { role: 'editor' },
        }),
      ]);

      // Both rows committed atomically.
      const member = await env.DB.prepare(
        'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      )
        .bind('ws-1', 'u2')
        .first<{ role: string }>();
      expect(member?.role).toBe('editor');
      const log = await env.DB.prepare(
        'SELECT action_type, resource_id, metadata FROM audit_logs WHERE actor_id = ?',
      )
        .bind('u1')
        .first<{ action_type: string; resource_id: string; metadata: string }>();
      expect(log?.action_type).toBe('member.invite');
      expect(log?.resource_id).toBe('u2');
      expect(JSON.parse(log!.metadata)).toEqual({ role: 'editor' });
    });

    it('cleanupOldLogs deletes logs older than N days, keeps recent ones', async () => {
      await insertUser('u1', 'alice', 1);
      // Old log: 35 days ago → deleted by cleanupOldLogs(30).
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, created_at)
         VALUES (?, NULL, ?, ?, datetime('now','-35 days'))`,
      )
        .bind('log-old', 'u1', 'test.action')
        .run();
      // Fresh log: now → kept.
      await env.DB.prepare(
        'INSERT INTO audit_logs (id, workspace_id, actor_id, action_type) VALUES (?, NULL, ?, ?)',
      )
        .bind('log-fresh', 'u1', 'test.action')
        .run();

      const repo = new AuditRepository(env.DB);
      await repo.cleanupOldLogs(30);

      const old = await env.DB.prepare('SELECT id FROM audit_logs WHERE id = ?')
        .bind('log-old')
        .first();
      expect(old).toBeNull();
      const fresh = await env.DB.prepare('SELECT id FROM audit_logs WHERE id = ?')
        .bind('log-fresh')
        .first();
      expect(fresh).not.toBeNull();
    });
  });

  // ─── PR 2: WorkspaceRepository new reads + policy queries ───

  describe('WorkspaceRepository PR2 reads', () => {
    it('findWorkspacesWithRole returns w.* + role, ordered by created_at DESC', async () => {
      await insertUser('u1', 'alice', 1);
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws-1', 'First', 'u1')
        .run();
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws-2', 'Second', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
      )
        .bind('m-1', 'ws-1', 'u1', 'owner')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
      )
        .bind('m-2', 'ws-2', 'u1', 'editor')
        .run();

      const repo = new WorkspaceRepository(env.DB);
      const { results } = await repo.findWorkspacesWithRole('u1');

      expect(results).toHaveLength(2);
      // Both rows carry the role from workspace_members.
      const first = results.find((r: any) => r.id === 'ws-1') as any;
      const second = results.find((r: any) => r.id === 'ws-2') as any;
      expect(first.role).toBe('owner');
      expect(second.role).toBe('editor');
    });

    it('findUsedBytes returns the workspace used_bytes', async () => {
      await insertUser('u1', 'alice', 1);
      await env.DB.prepare(
        'INSERT INTO workspaces (id, name, owner_id, used_bytes) VALUES (?, ?, ?, ?)',
      )
        .bind('ws-1', 'WS', 'u1', 4096)
        .run();

      const repo = new WorkspaceRepository(env.DB);
      const result = await repo.findUsedBytes('ws-1');
      expect(result?.used_bytes).toBe(4096);
    });

    it('findStorageQuotaPolicy returns null when no quota policy set', async () => {
      await insertUser('u1', 'alice', 1);
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws-1', 'WS', 'u1')
        .run();

      const repo = new WorkspaceRepository(env.DB);
      const result = await repo.findStorageQuotaPolicy('ws-1');
      expect(result).toBeNull();
    });

    it('findRetentionPolicyForFolder returns the policy config protecting a folder', async () => {
      await insertUser('u1', 'alice', 1);
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws-1', 'WS', 'u1')
        .run();
      await env.DB.prepare(
        'INSERT INTO workspace_folders (id, workspace_id, name) VALUES (?, ?, ?)',
      )
        .bind('f-1', 'ws-1', 'Folder')
        .run();
      // Workspace-scoped retention policy → protects f-1.
      await env.DB.prepare(
        "INSERT INTO workspace_policies (id, workspace_id, target_type, target_id, policy_type, config) VALUES (?, ?, 'workspace', NULL, 'data_retention', ?)",
      )
        .bind('p-1', 'ws-1', JSON.stringify({ action: 'prevent_deletion' }))
        .run();

      const repo = new WorkspaceRepository(env.DB);
      const result = await repo.findRetentionPolicyForFolder('f-1');
      expect(result?.config).toContain('prevent_deletion');
    });

    it('findAllAutoDeleteRetentionPolicies returns only auto_delete policies', async () => {
      await insertUser('u1', 'alice', 1);
      await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
        .bind('ws-1', 'WS', 'u1')
        .run();
      // auto_delete policy → included.
      await env.DB.prepare(
        "INSERT INTO workspace_policies (id, workspace_id, target_type, policy_type, config) VALUES (?, ?, 'workspace', 'data_retention', ?)",
      )
        .bind('p-1', 'ws-1', JSON.stringify({ action: 'auto_delete', days: 7 }))
        .run();
      // prevent_deletion policy → excluded.
      await env.DB.prepare(
        "INSERT INTO workspace_policies (id, workspace_id, target_type, policy_type, config) VALUES (?, ?, 'workspace', 'data_retention', ?)",
      )
        .bind('p-2', 'ws-1', JSON.stringify({ action: 'prevent_deletion' }))
        .run();

      const repo = new WorkspaceRepository(env.DB);
      const { results } = await repo.findAllAutoDeleteRetentionPolicies();
      expect(results).toHaveLength(1);
      expect((results[0] as any).id).toBe('p-1');
    });
  });
});
