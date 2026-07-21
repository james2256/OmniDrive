import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { SharedRepository } from '../../src/repositories/shared.repository';

// Integration test: runs against real D1 (via Miniflare), not mocked.
// This is the test that would have caught the Tier 4 Issue 1 regression
// where the maxDownloads quota enforcement was almost dropped.

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

const USER_ID = 'test-user-1';

async function ensureSchema() {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, google_id TEXT UNIQUE, email TEXT UNIQUE, name TEXT, avatar_url TEXT, is_super_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS shared_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_type TEXT NOT NULL CHECK (target_type IN ('file', 'folder')), target_id TEXT NOT NULL, password_hash TEXT, expires_at TEXT, allow_downloads INTEGER NOT NULL DEFAULT 1, allow_uploads INTEGER NOT NULL DEFAULT 0, max_downloads INTEGER, require_email INTEGER NOT NULL DEFAULT 0, webhook_url TEXT, view_count INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
}

async function createUser() {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)'
  ).bind(USER_ID, 'testuser', 'fakehash').run();
}

async function createLink(id: string, maxDownloads: number | null) {
  await env.DB.prepare(
    `INSERT INTO shared_links (id, user_id, target_type, target_id, max_downloads) VALUES (?, ?, 'file', 'file-1', ?)`
  ).bind(id, USER_ID, maxDownloads).run();
}

async function getDownloadCount(id: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT download_count FROM shared_links WHERE id = ?'
  ).bind(id).first<{ download_count: number }>();
  return row?.download_count ?? -1;
}

describe('SharedRepository.incrementDownloadCountWithLimit (integration)', () => {
  let repo: SharedRepository;

  beforeAll(async () => {
    await ensureSchema();
    repo = new SharedRepository(env.DB);
  });

  beforeEach(async () => {
    await createUser();
  });

  it('allows the first download (under the limit)', async () => {
    await createLink('link-1', 1);
    const newCount = await repo.incrementDownloadCountWithLimit('link-1');
    expect(newCount).toBe(1);
    expect(await getDownloadCount('link-1')).toBe(1);
  });

  it('blocks the second download (at the limit) by returning null', async () => {
    await createLink('link-2', 1);
    // First download: allowed
    await repo.incrementDownloadCountWithLimit('link-2');
    // Second download: should be blocked (limit reached)
    const result = await repo.incrementDownloadCountWithLimit('link-2');
    expect(result).toBeNull();
    // Count should still be 1 (blocked attempt doesn't increment)
    expect(await getDownloadCount('link-2')).toBe(1);
  });

  it('allows unlimited downloads when maxDownloads is NULL', async () => {
    await createLink('link-3', null);
    expect(await repo.incrementDownloadCountWithLimit('link-3')).toBe(1);
    expect(await repo.incrementDownloadCountWithLimit('link-3')).toBe(2);
    expect(await repo.incrementDownloadCountWithLimit('link-3')).toBe(3);
    expect(await getDownloadCount('link-3')).toBe(3);
  });

  it('returns null for a non-existent link', async () => {
    const result = await repo.incrementDownloadCountWithLimit('nonexistent-link');
    expect(result).toBeNull();
  });
});
