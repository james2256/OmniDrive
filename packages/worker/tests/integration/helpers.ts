import type { D1Database } from '@cloudflare/workers-types';

// Shared schema setup for integration tests.
// Only the tables the integration tests touch — add more as coverage grows.
// Full schema lives in src/db/schema.sql and migrations/.

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, google_id TEXT UNIQUE, email TEXT UNIQUE, name TEXT, avatar_url TEXT, is_super_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL, touched_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invitation_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_by TEXT, max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), sync_ttl_minutes INTEGER NOT NULL DEFAULT 5)`,
  `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'manager', 'auditor', 'owner')), joined_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(workspace_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS workspace_folders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, parent_id TEXT, icon TEXT, color TEXT, metadata TEXT, is_starred INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, sync_status TEXT NOT NULL DEFAULT 'idle', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS drive_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, google_account_id TEXT, email TEXT NOT NULL, name TEXT, type TEXT NOT NULL DEFAULT 'oauth', is_primary INTEGER NOT NULL DEFAULT 0, root_folder_id TEXT, total_quota INTEGER NOT NULL DEFAULT 0, used_quota INTEGER NOT NULL DEFAULT 0, quota_override INTEGER, quota_updated_at TEXT, sync_status TEXT NOT NULL DEFAULT 'idle', sync_error_message TEXT, sync_paused INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, health TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, workspace_folder_id TEXT REFERENCES workspace_folders(id) ON DELETE CASCADE, google_file_id TEXT NOT NULL, google_parent_id TEXT, name TEXT NOT NULL, mime_type TEXT, size INTEGER NOT NULL DEFAULT 0, thumbnail_url TEXT, web_view_link TEXT, web_content_link TEXT, is_trashed INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, metadata TEXT, google_created_at TEXT, google_modified_at TEXT, synced_at TEXT, last_synced_at TEXT, sync_status TEXT NOT NULL DEFAULT 'idle', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), owned_by_me INTEGER NOT NULL DEFAULT 1, UNIQUE(drive_account_id, google_file_id))`,
  `CREATE TABLE IF NOT EXISTS shared_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_type TEXT NOT NULL CHECK (target_type IN ('file', 'folder')), target_id TEXT NOT NULL, password_hash TEXT, expires_at TEXT, allow_downloads INTEGER NOT NULL DEFAULT 1, allow_uploads INTEGER NOT NULL DEFAULT 0, max_downloads INTEGER, require_email INTEGER NOT NULL DEFAULT 0, webhook_url TEXT, view_count INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS shared_link_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, shared_link_id TEXT NOT NULL REFERENCES shared_links(id) ON DELETE CASCADE, action TEXT NOT NULL, visitor_email TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, workspace_id TEXT, actor_id TEXT NOT NULL, action_type TEXT NOT NULL, resource_id TEXT, resource_name TEXT, metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS workspace_policies (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, target_type TEXT NOT NULL, target_id TEXT, policy_type TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS drive_folders (id TEXT PRIMARY KEY, drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE, google_folder_id TEXT NOT NULL, google_parent_id TEXT, name TEXT NOT NULL, is_synced INTEGER NOT NULL DEFAULT 0, is_trashed INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, owned_by_me INTEGER NOT NULL DEFAULT 1, synced_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(drive_account_id, google_folder_id))`,
  `CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS drive_tokens (drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE, encrypted_tokens TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS s3_credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, access_key_id TEXT UNIQUE NOT NULL, secret_key_enc TEXT NOT NULL, description TEXT, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS automation_rules (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, trigger_type TEXT NOT NULL, trigger_config TEXT, conditions TEXT, actions TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS s3_multipart_uploads (upload_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, key TEXT NOT NULL, drive_account_id TEXT NOT NULL REFERENCES drive_accounts(id) ON DELETE CASCADE, temp_folder_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS s3_multipart_parts (upload_id TEXT NOT NULL REFERENCES s3_multipart_uploads(upload_id) ON DELETE CASCADE, part_number INTEGER NOT NULL, google_file_id TEXT NOT NULL, etag TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (upload_id, part_number))`,
  `CREATE TABLE IF NOT EXISTS sync_state (drive_account_id TEXT PRIMARY KEY REFERENCES drive_accounts(id) ON DELETE CASCADE, change_token TEXT, next_page_token TEXT, last_synced_at TEXT, status TEXT DEFAULT 'idle', error_message TEXT)`,
];

/** Create all tables needed by the integration tests. Idempotent. */
export async function ensureSchema(db: D1Database): Promise<void> {
  for (const sql of TABLES) {
    await db.prepare(sql).run();
  }
}

/** Clear all rows from all tables (for test isolation between files). */
export async function clearAllTables(db: D1Database): Promise<void> {
  const tables = ['sync_state', 's3_multipart_parts', 's3_multipart_uploads', 'automation_rules', 's3_credentials', 'drive_tokens', 'oauth_states', 'shared_link_logs', 'shared_links', 'audit_logs', 'workspace_policies', 'drive_folders', 'files', 'workspace_members', 'workspace_folders', 'workspaces', 'drive_accounts', 'sessions', 'users', 'invitation_codes'];
  for (const table of tables) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}
