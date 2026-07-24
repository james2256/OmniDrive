import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { ensureSchema, clearAllTables } from './helpers';
import { AdminRepository } from '../../src/repositories/admin.repository';
import { S3CredentialsRepository } from '../../src/repositories/s3-credentials.repository';
import { AutomationRepository } from '../../src/repositories/automation.repository';
import { DriveRepository } from '../../src/repositories/drive.repository';
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

async function insertUser(id: string, username: string, isSuperAdmin = 0, email: string | null = null): Promise<void> {
  const passwordHash = await hashPassword('TestPass123!');
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin, email) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, username, passwordHash, isSuperAdmin, email).run();
}

async function insertDrive(driveId: string, userId: string, email: string, isPrimary = 0): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, is_primary, root_folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(driveId, userId, `g-${driveId}`, email, email, isPrimary, null).run();
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
        'INSERT INTO invitation_codes (id, code, created_by, max_uses) VALUES (?, ?, ?, ?)'
      ).bind('inv1', 'CODE123', 'u1', 5).run();

      const repo = new AdminRepository(env.DB);
      const { results } = await repo.findAllInvitations();

      expect(results.length).toBe(1);
      expect((results[0] as any).code).toBe('CODE123');
      expect((results[0] as any).max_uses).toBe(5);
    });

    it('findRecentAuditLogs joins actor email + workspace name', async () => {
      await insertUser('u1', 'admin', 1, 'admin@example.com');
      await env.DB.prepare(
        'INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)'
      ).bind('ws1', 'Team Project', 'u1').run();
      await env.DB.prepare(
        'INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, resource_id, resource_name) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind('log1', 'ws1', 'u1', 'file.delete', 'file-1', 'report.pdf').run();

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
      await env.DB.prepare(
        'INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)'
      ).bind('ws1', 'Scoped Workspace', 'u1').run();

      const repo = new S3CredentialsRepository(env.DB);
      await repo.insert({
        id: 'k1', userId: 'u1', accessKeyId: 'OMNISCOPED',
        secretKeyEnc: 'enc', description: 'scoped key', workspaceId: 'ws1',
      });

      const { results } = await repo.findAllByUser('u1');
      expect(results.length).toBe(1);
      expect((results[0] as any).workspace_name).toBe('Scoped Workspace');
    });

    it('delete only affects the specified user (no cross-user deletion)', async () => {
      await insertUser('u1', 'alice', 1);
      await insertUser('u2', 'bob', 1);
      const repo = new S3CredentialsRepository(env.DB);

      await repo.insert({ id: 'k1', userId: 'u1', accessKeyId: 'OMNI1', secretKeyEnc: 'e1', description: null, workspaceId: null });
      await repo.insert({ id: 'k2', userId: 'u2', accessKeyId: 'OMNI2', secretKeyEnc: 'e2', description: null, workspaceId: null });

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
        id: 'r1', userId: 'u1', name: 'Auto-move PDFs',
        triggerType: 'file_create', triggerConfig: '{}',
        conditions: '{}', actions: '{}',
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
        "INSERT INTO sync_state (drive_account_id, status, last_synced_at) VALUES (?, 'syncing', ?)"
      ).bind('d1', '2026-01-01 10:00:00').run();

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
        'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?)'
      ).bind('d1', 'encrypted-token-blob', Date.now()).run();

      const repo = new DriveRepository(env.DB);
      const status = await repo.findTokenStatus('d1');
      expect(status?.ok).toBe(1);
    });

    // ─── 8.8 external: returns items you own not in My Drive (any depth) ───
    it('findExternalFolders + findExternalFiles return owned items in shared territory at any depth', async () => {
      await insertUser('u1', 'alice', 1);
      await insertDrive('d1', 'u1', 'alice@gmail.com', 1);

      // Computer backup root (owned_by_me=1, parent='__shared__')
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('df1', 'd1', 'gfolder1', '__shared__', 'Shared Folder', 1, 0).run();

      // My Drive folder (should be excluded)
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('df2', 'd1', 'gfolder2', 'root', 'My Folder', 1, 0).run();

      // Folder shared WITH me by someone else (owned_by_me=0) — external root
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('df3', 'd1', 'gfolder3', '__shared__', 'A Shared Folder', 0, 0).run();

      // Folder I created inside A's shared folder (1 level deep)
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('df4', 'd1', 'gfolder4', 'gfolder3', 'My Subfolder', 1, 0).run();

      // Folder I created inside my subfolder (2 levels deep — tests recursion)
      await env.DB.prepare(
        'INSERT INTO drive_folders (id, drive_account_id, google_folder_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('df5', 'd1', 'gfolder5', 'gfolder4', 'Deep Folder', 1, 0).run();

      // File at shared root (owned_by_me=1)
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('f1', 'u1', 'd1', 'gfile1', '__shared__', 'shared.pdf', 1, 0).run();

      // My Drive file (should be excluded)
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('f2', 'u1', 'd1', 'gfile2', 'root', 'mine.docx', 1, 0).run();

      // File I created inside A's shared folder (1 level deep)
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('f3', 'u1', 'd1', 'gfile3', 'gfolder3', 'my-file-in-shared.pdf', 1, 0).run();

      // File I created inside my subfolder (2 levels deep — tests recursion)
      await env.DB.prepare(
        'INSERT INTO files (id, user_id, drive_account_id, google_file_id, google_parent_id, name, owned_by_me, is_trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('f4', 'u1', 'd1', 'gfile4', 'gfolder4', 'deep-file.txt', 1, 0).run();

      const repo = new DriveRepository(env.DB);
      const { results: folders } = await repo.findExternalFolders('u1');
      const { results: files } = await repo.findExternalFiles('u1');

      // df1 (backup root), df4 (1 level), df5 (2 levels) — NOT df2 (My Drive), df3 (owned_by_me=0)
      expect(folders.length).toBe(3);
      expect((folders[0] as any).name).toBe('Deep Folder');
      expect((folders[1] as any).name).toBe('My Subfolder');
      expect((folders[2] as any).name).toBe('Shared Folder');

      // f1 (backup root), f3 (1 level), f4 (2 levels) — NOT f2 (My Drive)
      expect(files.length).toBe(3);
      expect((files[0] as any).name).toBe('deep-file.txt');
      expect((files[1] as any).name).toBe('my-file-in-shared.pdf');
      expect((files[2] as any).name).toBe('shared.pdf');
    });
  });
});
