import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../../src/index';
import { ensureSchema, clearAllTables } from './helpers';
import { encrypt } from '../../src/lib/crypto';
import { sha256 } from '../../src/lib/crypto-s3';
import { calculateSigV4, buildAuthHeader } from './s3-sigv4-helper';

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

const SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const HOST = 'localhost';
// Counter ensures each test gets a unique access key ID, avoiding UNIQUE
// constraint collisions even if cleanup is incomplete.
let accessKeyCounter = 0;
function nextAccessKeyId(): string {
  accessKeyCounter++;
  return `OMNI_INTG_${Date.now().toString(36).toUpperCase()}_${accessKeyCounter}`;
}

// The most recently inserted access key — used by signedRequest to match
// the credential that insertUserAndS3Cred just created.
let currentAccessKeyId = nextAccessKeyId();

// SigV4 requires the request time to be within 15 min of the server clock.
// Compute amzDate/dateStr at test-run time, not hardcoded.
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const AMZ_DATE = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
const DATE_STR = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;

async function insertUserAndS3Cred(username: string): Promise<{ userId: string }> {
  const userId = `user-${username}`;
  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)'
  ).bind(userId, username, '$2a$10$dummyhash', 1).run();

  // Each call gets a unique access key ID so multiple users in the same test
  // don't collide on the UNIQUE constraint.
  currentAccessKeyId = nextAccessKeyId();
  const secretEnc = await encrypt(SECRET_ACCESS_KEY, env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    'INSERT INTO s3_credentials (id, user_id, access_key_id, secret_key_enc, description, workspace_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(`cred-${username}`, userId, currentAccessKeyId, secretEnc, 'integration test', null).run();

  return { userId };
}

async function insertWorkspace(userId: string, name: string): Promise<string> {
  const wsId = `ws-${name}`;
  await env.DB.prepare(
    'INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)'
  ).bind(wsId, name, userId).run();
  await env.DB.prepare(
    'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)'
  ).bind(`wm-${name}`, wsId, userId, 'owner').run();
  return wsId;
}

async function insertDrive(userId: string, driveId: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, is_primary, root_folder_id, total_quota, used_quota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(driveId, userId, `g-${driveId}`, email, email, 1, 'root-folder-id', 15_000_000_000, 5_000_000_000).run();

  // Insert encrypted tokens so GoogleDriveService can "getTokens" without error
  const tokenEnc = await encrypt(JSON.stringify({
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: Date.now() + 3600_000,
  }), env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?)'
  ).bind(driveId, tokenEnc, Date.now()).run();
}

async function insertFile(userId: string, driveId: string, wsId: string, folderId: string | null, name: string, googleFileId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, google_file_id, google_parent_id, name, mime_type, size, is_trashed, is_starred) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(`file-${name}`, userId, driveId, wsId, folderId, googleFileId, null, name, 'text/plain', 100, 0, 0).run();
}

function signedRequest(method: string, path: string, opts: { queryParams?: Record<string, string>; body?: string; accessKeyId?: string } = {}) {
  const accessKeyId = opts.accessKeyId || currentAccessKeyId;
  const headers: Record<string, string> = {
    'host': HOST,
    'x-amz-date': AMZ_DATE,
    'x-amz-content-sha256': sha256(opts.body || ''),
  };

  const { signature, signedHeaders } = calculateSigV4({
    method,
    path,
    queryParams: opts.queryParams || {},
    headers,
    accessKeyId,
    secretAccessKey: SECRET_ACCESS_KEY,
    dateStr: DATE_STR,
    amzDate: AMZ_DATE,
  });

  const fullPath = opts.queryParams && Object.keys(opts.queryParams).length > 0
    ? path + '?' + Object.entries(opts.queryParams).map(([k, v]) => `${k}=${v}`).join('&')
    : path;

  return app.request(fullPath, {
    method,
    headers: { ...headers, Authorization: buildAuthHeader(accessKeyId, DATE_STR, signedHeaders, signature) },
    body: opts.body,
  }, env);
}

describe('S3 Protocol (integration)', () => {
  beforeAll(async () => {
    await ensureSchema(env.DB);
    await clearAllTables(env.DB); // Clean any leftover data from other test files
  });

  beforeEach(async () => {
    try {
      await clearAllTables(env.DB);
    } catch (e) {
      // If clearAllTables fails (e.g. a table doesn't exist yet), still proceed
      // — the unique access key per insert prevents UNIQUE constraint collisions.
      console.error('clearAllTables error (non-fatal):', e);
    }
    vi.restoreAllMocks();
  });

  // ─── 9.1 ListBuckets → returns workspaces ───
  it('GET /s3/ ListBuckets returns workspaces the user is a member of', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const aliceAccessKey = currentAccessKeyId;
    await insertWorkspace(userId, 'my-bucket');
    await insertWorkspace(userId, 'team-bucket');

    // Another user's workspace — should NOT appear in alice's ListBuckets
    const otherUser = await insertUserAndS3Cred('bob');
    await insertWorkspace(otherUser.userId, 'bob-private');

    // Sign with alice's key (captured before bob's insert changed currentAccessKeyId)
    const res = await signedRequest('GET', '/s3/', { accessKeyId: aliceAccessKey });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<ListAllMyBucketsResult>');
    expect(body).toContain('<Name>my-bucket</Name>');
    expect(body).toContain('<Name>team-bucket</Name>');
    expect(body).not.toContain('bob-private');
  });

  // ─── ListObjectsV2 → returns files in workspace ───
  it('GET /s3/:bucket ListObjectsV2 returns files in the workspace', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    await insertFile(userId, 'drive-1', wsId, null, 'report.pdf', 'gfile-1');
    await insertFile(userId, 'drive-1', wsId, null, 'notes.txt', 'gfile-2');

    const res = await signedRequest('GET', '/s3/my-bucket');

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('report.pdf');
    expect(body).toContain('notes.txt');
  });

  it('GET /s3/:bucket ListObjectsV2 returns NoSuchBucket for unknown workspace', async () => {
    await insertUserAndS3Cred('alice');

    const res = await signedRequest('GET', '/s3/nonexistent-bucket');

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Bucket not found');
  });

  // ─── 9.3 DeleteObject → marks file as trashed in D1 ───
  it('DELETE /s3/:bucket/:key marks file as trashed in D1', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    await insertFile(userId, 'drive-1', wsId, null, 'to-delete.txt', 'gfile-delete');

    // Mock Google Drive API delete (the route calls driveService.deleteFile)
    // 204 response must have null body per fetch spec
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await signedRequest('DELETE', '/s3/my-bucket/to-delete.txt');

    expect(res.status).toBe(204);

    // File row soft-deleted (is_trashed = 1) — S3 DELETE trashes, not hard-deletes
    const row = await env.DB.prepare('SELECT is_trashed FROM files WHERE id = ?')
      .bind('file-to-delete.txt').first() as { is_trashed: number } | null;
    expect(row).toBeTruthy();
    expect(row!.is_trashed).toBe(1);
  });

  // ─── 9.4 Multipart init → creates s3_multipart_uploads row ───
  it('POST /s3/:bucket/:key?uploads creates s3_multipart_uploads row and returns UploadId', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Mock Google Drive API — initiateResumableUpload + createFolder for temp folder
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // Google Drive file.create (for temp folder) — return a folder ID
      if (url.includes('https://www.googleapis.com/drive/v3/files') && !url.includes('uploadType=resumable')) {
        return new Response(JSON.stringify({ id: 'temp-folder-id-123', mimeType: 'application/vnd.google-apps.folder' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // Resumable upload session initiation — return Location header
      if (url.includes('uploadType=resumable')) {
        return new Response('', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc' } });
      }
      return new Response('{}', { status: 200 });
    });

    const res = await signedRequest('POST', '/s3/my-bucket/folder/large-file.bin', { queryParams: { uploads: '' } });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<InitiateMultipartUploadResult>');
    expect(body).toContain('<UploadId>');

    // Extract UploadId from XML
    const uploadIdMatch = body.match(/<UploadId>([^<]+)<\/UploadId>/);
    expect(uploadIdMatch).toBeTruthy();
    const uploadId = uploadIdMatch![1];

    // s3_multipart_uploads row created in D1
    const upload = await env.DB.prepare(
      'SELECT user_id, workspace_id, key, drive_account_id, temp_folder_id FROM s3_multipart_uploads WHERE upload_id = ?'
    ).bind(uploadId).first() as { user_id: string; workspace_id: string; key: string; drive_account_id: string; temp_folder_id: string } | null;
    expect(upload).toBeTruthy();
    expect(upload!.user_id).toBe(userId);
    expect(upload!.workspace_id).toBe(wsId);
    expect(upload!.key).toBe('folder/large-file.bin');
    expect(upload!.temp_folder_id).toBe('temp-folder-id-123');
  });

  // ─── 9.2 PutObject → creates file in D1 ───
  it('PUT /s3/:bucket/:key PutObject creates file row in D1', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Mock Google Drive API — initiateResumableUpload returns Location, then upload PUT returns file metadata
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // Resumable upload session initiation
      if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
        return new Response('', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=def' } });
      }
      // Upload PUT — return file metadata with id + md5
      if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ id: 'gfile-new-123', md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // Google Drive file.create (for folder creation)
      if (url.includes('https://www.googleapis.com/drive/v3/files')) {
        return new Response(JSON.stringify({ id: 'folder-id-456' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    });

    const body = 'Hello S3';
    const res = await signedRequest('PUT', '/s3/my-bucket/uploaded-file.txt', { body });

    expect(res.status).toBe(200);

    // File row created in D1
    const file = await env.DB.prepare(
      'SELECT name, google_file_id, workspace_id FROM files WHERE workspace_id = ? AND name = ?'
    ).bind(wsId, 'uploaded-file.txt').first() as { name: string; google_file_id: string; workspace_id: string } | null;
    expect(file).toBeTruthy();
    expect(file!.google_file_id).toBe('gfile-new-123');
    expect(file!.workspace_id).toBe(wsId);
  });
});
