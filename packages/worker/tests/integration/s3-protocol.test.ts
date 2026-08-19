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
// app.request() in tests has no ExecutionContext — pass a stub for parity with
// routes that use c.executionCtx.waitUntil (matches oauth-callback.test.ts:26).
// The stub actually awaits the promise so waitUntil cleanup runs in tests.
const executionCtx = {
  waitUntil: (promise: Promise<unknown>) => {
    void promise.catch(() => {});
  },
};
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
    'INSERT INTO users (id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, username, '$2a$10$dummyhash', 1)
    .run();

  // Each call gets a unique access key ID so multiple users in the same test
  // don't collide on the UNIQUE constraint.
  currentAccessKeyId = nextAccessKeyId();
  const secretEnc = await encrypt(SECRET_ACCESS_KEY, env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    'INSERT INTO s3_credentials (id, user_id, access_key_id, secret_key_enc, description, workspace_id) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(`cred-${username}`, userId, currentAccessKeyId, secretEnc, 'integration test', null)
    .run();

  return { userId };
}

async function insertWorkspace(userId: string, name: string): Promise<string> {
  const wsId = `ws-${name}`;
  await env.DB.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)')
    .bind(wsId, name, userId)
    .run();
  await env.DB.prepare(
    'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
  )
    .bind(`wm-${name}`, wsId, userId, 'owner')
    .run();
  return wsId;
}

async function insertDrive(userId: string, driveId: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, is_primary, root_folder_id, total_quota, used_quota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      driveId,
      userId,
      `g-${driveId}`,
      email,
      email,
      1,
      'root-folder-id',
      15_000_000_000,
      5_000_000_000,
    )
    .run();

  // Insert encrypted tokens so GoogleDriveService can "getTokens" without error
  const tokenEnc = await encrypt(
    JSON.stringify({
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      expiresAt: Date.now() + 3600_000,
    }),
    env.TOKEN_ENCRYPTION_KEY,
  );
  await env.DB.prepare(
    'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?)',
  )
    .bind(driveId, tokenEnc, Date.now())
    .run();
}

async function insertFile(
  userId: string,
  driveId: string,
  wsId: string,
  folderId: string | null,
  name: string,
  googleFileId: string,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, google_file_id, google_parent_id, name, mime_type, size, is_trashed, is_starred) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      `file-${name}`,
      userId,
      driveId,
      wsId,
      folderId,
      googleFileId,
      null,
      name,
      'text/plain',
      100,
      0,
      0,
    )
    .run();
}

function signedRequest(
  method: string,
  path: string,
  opts: { queryParams?: Record<string, string>; body?: string; accessKeyId?: string } = {},
) {
  const accessKeyId = opts.accessKeyId || currentAccessKeyId;
  const headers: Record<string, string> = {
    host: HOST,
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

  const fullPath =
    opts.queryParams && Object.keys(opts.queryParams).length > 0
      ? path +
        '?' +
        Object.entries(opts.queryParams)
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
      : path;

  return app.request(
    fullPath,
    {
      method,
      headers: {
        ...headers,
        Authorization: buildAuthHeader(accessKeyId, DATE_STR, signedHeaders, signature),
      },
      body: opts.body,
    },
    env,
    executionCtx,
  );
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
    expect(body).toContain(
      '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    );
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

  // ─── ListObjectsV2 pagination (P1.3) ───
  it('GET /s3/:bucket ListObjectsV2 paginates with max-keys and continuation-token', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'page-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    // Insert 5 files — with max-keys=2, should take 3 pages (2 + 2 + 1)
    for (let i = 0; i < 5; i++) {
      await insertFile(userId, 'drive-1', wsId, null, `file${i}.txt`, `gfile-${i}`);
    }

    // Page 1: max-keys=2 → 2 files, IsTruncated=true, NextContinuationToken
    const res1 = await signedRequest('GET', '/s3/page-bucket', {
      queryParams: { 'max-keys': '2' },
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.text();
    expect(body1).toContain('<MaxKeys>2</MaxKeys>');
    expect(body1).toContain('<IsTruncated>true</IsTruncated>');
    expect(body1).toContain('<NextContinuationToken>');
    // Extract the continuation token
    const tokenMatch = body1.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    expect(tokenMatch).toBeTruthy();
    const token1 = tokenMatch![1];
    // Should contain exactly 2 files
    expect(body1.match(/<Contents>/g)?.length).toBe(2);

    // Page 2: use continuation-token → 2 more files, IsTruncated=true
    const res2 = await signedRequest('GET', '/s3/page-bucket', {
      queryParams: { 'max-keys': '2', 'continuation-token': token1 },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.text();
    expect(body2).toContain('<IsTruncated>true</IsTruncated>');
    const token2Match = body2.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const token2 = token2Match![1];
    expect(body2.match(/<Contents>/g)?.length).toBe(2);

    // Page 3: final page → 1 file, IsTruncated=false, no NextContinuationToken
    const res3 = await signedRequest('GET', '/s3/page-bucket', {
      queryParams: { 'max-keys': '2', 'continuation-token': token2 },
    });
    expect(res3.status).toBe(200);
    const body3 = await res3.text();
    expect(body3).toContain('<IsTruncated>false</IsTruncated>');
    expect(body3).not.toContain('<NextContinuationToken>');
    expect(body3.match(/<Contents>/g)?.length).toBe(1);
  });

  // ─── ListObjectsV2 LIKE escape (P1.5) ───
  it('GET /s3/:bucket ListObjectsV2 with % in prefix matches literally (not wildcard)', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'escape-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    await insertFile(userId, 'drive-1', wsId, null, '50%off.txt', 'gfile-pct');
    await insertFile(userId, 'drive-1', wsId, null, 'other.txt', 'gfile-other');

    // prefix=50% should match only "50%off.txt", not "other.txt"
    const res = await signedRequest('GET', '/s3/escape-bucket', { queryParams: { prefix: '50%' } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('50%off.txt');
    expect(body).not.toContain('other.txt');
  });

  // ─── 9.3 DeleteObject → marks file as trashed in D1 ───
  it('DELETE /s3/:bucket/:key marks file as trashed in D1', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    await insertFile(userId, 'drive-1', wsId, null, 'to-delete.txt', 'gfile-delete');

    // Mock Google Drive API trash (the route calls driveService.trashFile)
    // 204 response must have null body per fetch spec
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await signedRequest('DELETE', '/s3/my-bucket/to-delete.txt');

    expect(res.status).toBe(204);

    // File row soft-deleted (is_trashed = 1) — S3 DELETE trashes, not hard-deletes
    const row = (await env.DB.prepare('SELECT is_trashed FROM files WHERE id = ?')
      .bind('file-to-delete.txt')
      .first()) as { is_trashed: number } | null;
    expect(row).toBeTruthy();
    expect(row!.is_trashed).toBe(1);
  });

  // ─── 9.3b DeleteObject → decrements file_storage_stats ───
  it('DELETE /s3/:bucket/:key decrements file_storage_stats by the file size', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    await insertFile(userId, 'drive-1', wsId, null, 'stats-test.txt', 'gfile-stats');

    // Pre-seed a stats row so we can verify the delta (not just that a row exists).
    await env.DB.prepare(
      'INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES (?, ?, ?)',
    )
      .bind(userId, 'text/plain', 1000)
      .run();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await signedRequest('DELETE', '/s3/my-bucket/stats-test.txt');

    expect(res.status).toBe(204);
    const stats = (await env.DB.prepare(
      'SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?',
    )
      .bind(userId, 'text/plain')
      .first()) as { total_size: number } | null;
    expect(stats).toBeTruthy();
    expect(stats!.total_size).toBe(900); // 1000 - 100 (file size from insertFile)
  });

  // ─── 9.4 Multipart init → creates s3_multipart_uploads row ───
  it('POST /s3/:bucket/:key?uploads creates s3_multipart_uploads row and returns UploadId', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Mock Google Drive API — initiateResumableUpload + createFolder for temp folder
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // Google Drive file.create (for temp folder) — return a folder ID
      if (
        url.includes('https://www.googleapis.com/drive/v3/files') &&
        !url.includes('uploadType=resumable')
      ) {
        return new Response(
          JSON.stringify({
            id: 'temp-folder-id-123',
            mimeType: 'application/vnd.google-apps.folder',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      // Resumable upload session initiation — return Location header
      if (url.includes('uploadType=resumable')) {
        return new Response('', {
          status: 200,
          headers: {
            Location:
              'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc',
          },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const res = await signedRequest('POST', '/s3/my-bucket/folder/large-file.bin', {
      queryParams: { uploads: '' },
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    );
    expect(body).toContain('<UploadId>');

    // Extract UploadId from XML
    const uploadIdMatch = body.match(/<UploadId>([^<]+)<\/UploadId>/);
    expect(uploadIdMatch).toBeTruthy();
    const uploadId = uploadIdMatch![1];

    // s3_multipart_uploads row created in D1
    const upload = (await env.DB.prepare(
      'SELECT user_id, workspace_id, key, drive_account_id, temp_folder_id FROM s3_multipart_uploads WHERE upload_id = ?',
    )
      .bind(uploadId)
      .first()) as {
      user_id: string;
      workspace_id: string;
      key: string;
      drive_account_id: string;
      temp_folder_id: string;
    } | null;
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        // Resumable upload session initiation
        if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
          return new Response('', {
            status: 200,
            headers: {
              Location:
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=def',
            },
          });
        }
        // Upload PUT — return file metadata with id + md5
        if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
          // Consume the body stream so hashing TransformStreams complete
          if (init.body instanceof ReadableStream) {
            const reader = init.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          return new Response(
            JSON.stringify({
              id: 'gfile-new-123',
              md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        // Google Drive file.create (for folder creation)
        if (url.includes('https://www.googleapis.com/drive/v3/files')) {
          return new Response(JSON.stringify({ id: 'folder-id-456' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      },
    );

    const body = 'Hello S3';
    const res = await signedRequest('PUT', '/s3/my-bucket/uploaded-file.txt', { body });

    expect(res.status).toBe(200);

    // File row created in D1
    const file = (await env.DB.prepare(
      'SELECT name, google_file_id, workspace_id FROM files WHERE workspace_id = ? AND name = ?',
    )
      .bind(wsId, 'uploaded-file.txt')
      .first()) as { name: string; google_file_id: string; workspace_id: string } | null;
    expect(file).toBeTruthy();
    expect(file!.google_file_id).toBe('gfile-new-123');
    expect(file!.workspace_id).toBe(wsId);
  });

  // ─── 9.5 CompleteMultipartUpload cross-bucket guard ───
  it('POST /s3/:bucket/:key?uploadId rejects completion against a different bucket (400)', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsA = await insertWorkspace(userId, 'bucket-a');
    await insertWorkspace(userId, 'bucket-b');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Seed a multipart upload session that belongs to bucket-a (ws-a).
    // The credential is unscoped (workspace_id = null), so findUploadScoped
    // returns the upload even when the URL points at bucket-b — the cross-
    // bucket guard must catch this.
    await env.DB.prepare(
      'INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id, created_at, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'upload-cross-bucket',
        userId,
        wsA,
        'cross-bucket-file.bin',
        'drive-1',
        'temp-folder-1',
        Date.now(),
        'application/octet-stream',
      )
      .run();

    const res = await signedRequest('POST', '/s3/bucket-b/cross-bucket-file.bin', {
      queryParams: { uploadId: 'upload-cross-bucket' },
      body: '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"abc"</ETag></Part></CompleteMultipartUpload>',
    });

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('InvalidRequest');
    expect(body).toContain('does not belong to this bucket');
  });

  // ─── 9.6 PutObject ownership gate — no quota leak on 403 ───
  it('PUT /s3/:bucket/:key PutObject returns 403 without leaking quota when target owned by another user', async () => {
    // Alice owns the workspace + the file
    const { userId: aliceId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(aliceId, 'team-bucket');
    await insertDrive(aliceId, 'drive-alice', 'alice@gmail.com');

    // Raw INSERT: file with owned_by_me = 0 (insertFile helper omits this column;
    // schema.sql:70 defaults to 1, so we must specify it explicitly).
    await env.DB.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, ' +
        'google_file_id, name, mime_type, size, is_trashed, is_starred, owned_by_me) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'file-alice-report',
        aliceId,
        'drive-alice',
        wsId,
        null,
        'gfile-alice-1',
        'report.pdf',
        'text/plain',
        100,
        0,
        0,
        0, // ← owned_by_me = 0
      )
      .run();

    // Bob: workspace editor (insertWorkspace only adds the owner — raw INSERT needed)
    const { userId: bobId } = await insertUserAndS3Cred('bob');
    const bobAccessKey = currentAccessKeyId;
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
    )
      .bind('wm-bob-editor', wsId, bobId, 'editor')
      .run();
    await insertDrive(bobId, 'drive-bob', 'bob@gmail.com');

    // Mock Drive API (same pattern as existing PutObject test at line 447)
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
          return new Response('', {
            status: 200,
            headers: {
              Location:
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
            },
          });
        }
        if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
          // Should NEVER be reached — 403 returns before upload
          if (init.body instanceof ReadableStream) {
            const reader = init.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          return new Response(JSON.stringify({ id: 'should-not-happen' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      },
    );

    const res = await signedRequest('PUT', '/s3/team-bucket/report.pdf', {
      body: 'overwrite attempt',
      accessKeyId: bobAccessKey,
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('AccessDenied');

    // Quota NOT leaked — used_bytes unchanged (was 0, still 0)
    const ws = await env.DB.prepare('SELECT used_bytes FROM workspaces WHERE id = ?')
      .bind(wsId)
      .first<{ used_bytes: number }>();
    expect(ws!.used_bytes).toBe(0);
  });

  // ─── 9.7 CompleteMultipartUpload ownership gate — no quota leak + no orphan on 403 ───
  it('POST CompleteMultipartUpload returns 403 without uploading when target owned by another user', async () => {
    const { userId: aliceId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(aliceId, 'team-bucket');
    await insertDrive(aliceId, 'drive-alice', 'alice@gmail.com');

    // Seed existing file owned by Alice (owned_by_me = 0 from Bob's perspective)
    await env.DB.prepare(
      'INSERT INTO files (id, user_id, drive_account_id, workspace_id, workspace_folder_id, ' +
        'google_file_id, name, mime_type, size, is_trashed, is_starred, owned_by_me) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'file-alice-demo',
        aliceId,
        'drive-alice',
        wsId,
        null,
        'gfile-alice-demo',
        'demo.mp4',
        'video/mp4',
        52428800,
        0,
        0,
        0, // ← owned_by_me = 0
      )
      .run();

    // Bob: workspace editor + his own drive (MUST use unique id — drive_accounts.id is PK)
    const { userId: bobId } = await insertUserAndS3Cred('bob');
    const bobAccessKey = currentAccessKeyId;
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)',
    )
      .bind('wm-bob-editor', wsId, bobId, 'editor')
      .run();
    await insertDrive(bobId, 'drive-bob', 'bob@gmail.com');

    // Seed a multipart upload session + 1 part (references Bob's drive 'drive-bob')
    await env.DB.prepare(
      'INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id, created_at, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'upload-1',
        bobId,
        wsId,
        'demo.mp4',
        'drive-bob',
        'temp-folder-1',
        Date.now(),
        'video/mp4',
      )
      .run();

    await env.DB.prepare(
      'INSERT INTO s3_multipart_parts (upload_id, part_number, google_file_id, etag, size) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('upload-1', 1, 'gfile-part-1', '"abc123"', 52428800)
      .run();

    // Mock Drive API — track whether the FINAL upload PUT happens
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
          return new Response('', {
            status: 200,
            headers: {
              Location:
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=y',
            },
          });
        }
        if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
          if (init.body instanceof ReadableStream) {
            const reader = init.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          return new Response(JSON.stringify({ id: 'gfile-final', md5Checksum: 'abc' }), {
            status: 200,
          });
        }
        // Part download
        if (url.includes('alt=media')) {
          return new Response('part-data', { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

    const res = await signedRequest('POST', '/s3/team-bucket/demo.mp4', {
      queryParams: { uploadId: 'upload-1' },
      body: '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"abc123"</ETag></Part></CompleteMultipartUpload>',
      accessKeyId: bobAccessKey,
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('AccessDenied');

    // No final upload PUT happened — filter matches existing convention at s3-protocol.test.ts:453/463
    const finalUploadCalls = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        init?.method === 'PUT' &&
        (typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url).includes(
          'uploadType=resumable',
        ),
    );
    expect(finalUploadCalls.length).toBe(0);

    // Quota NOT leaked
    const ws = await env.DB.prepare('SELECT used_bytes FROM workspaces WHERE id = ?')
      .bind(wsId)
      .first<{ used_bytes: number }>();
    expect(ws!.used_bytes).toBe(0);

    // No new file row inserted (the orphan would be a files row with google_file_id='gfile-final')
    const orphan = await env.DB.prepare(
      "SELECT id FROM files WHERE google_file_id = 'gfile-final'",
    ).first();
    expect(orphan).toBeNull();
  });

  // ─── 9.8 Concurrent PUT to same new folder path — no 500 ───
  it('PUT /s3/:bucket/:key concurrent PUTs to same new folder path do not 500', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const aliceAccessKey = currentAccessKeyId;
    const wsId = await insertWorkspace(userId, 'race-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Pre-create the root "reports" folder so the race happens at the NESTED
    // "2026" level (parent_id NOT NULL). SQLite's UNIQUE constraint treats NULL
    // parent_id as distinct, so root-level folder races aren't caught by the
    // constraint — only nested folder races (where parent_id is non-NULL) are.
    await env.DB.prepare(
      'INSERT INTO workspace_folders (id, workspace_id, name, parent_id) VALUES (?, ?, ?, ?)',
    )
      .bind('folder-reports', wsId, 'reports', null)
      .run();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
          return new Response('', {
            status: 200,
            headers: {
              Location:
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=z',
            },
          });
        }
        if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
          if (init.body instanceof ReadableStream) {
            const reader = init.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          return new Response(
            JSON.stringify({ id: 'gfile-' + Math.random(), md5Checksum: 'abc' }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      },
    );

    // Two concurrent PUTs to different files in the SAME new nested folder path.
    // Both need "reports/2026" — "reports" exists, "2026" doesn't. The race is
    // on creating "2026" (parent_id = folder-reports, non-NULL).
    const [resA, resB] = await Promise.all([
      signedRequest('PUT', '/s3/race-bucket/reports/2026/q1.csv', {
        body: 'data-a',
        accessKeyId: aliceAccessKey,
      }),
      signedRequest('PUT', '/s3/race-bucket/reports/2026/q2.csv', {
        body: 'data-b',
        accessKeyId: aliceAccessKey,
      }),
    ]);

    // Neither should 500 (before fix: one would get UNIQUE constraint → 500)
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Exactly one "2026" folder under "reports" (not duplicates)
    const y2026 = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM workspace_folders WHERE workspace_id = ? AND name = ? AND parent_id = ?',
    )
      .bind(wsId, '2026', 'folder-reports')
      .first<{ count: number }>();
    expect(y2026!.count).toBe(1);
  });

  // ─── 9.9 DeleteObject D1 batch atomicity — both writes roll back on failure ───
  it('DELETE /s3/:bucket/:key rolls back markTrashedSystem if the storage-delta write fails (batch atomicity)', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');
    await insertFile(userId, 'drive-1', wsId, null, 'atomic-test.txt', 'gfile-atomic');

    // Pre-seed a stats row so we can verify it's NOT decremented on batch failure
    await env.DB.prepare(
      'INSERT INTO file_storage_stats (user_id, mime_type, total_size) VALUES (?, ?, ?)',
    )
      .bind(userId, 'text/plain', 1000)
      .run();

    // Mock Google Drive trash (the route calls driveService.trashFile before the batch)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    // Spy on db.batch and make it throw ONCE (simulating a D1 transient failure).
    // The batch is the single atomic transaction — if it throws, both the
    // markTrashedSystem and applyStorageDelta writes must roll back together.
    const batchSpy = vi.spyOn(env.DB, 'batch');
    batchSpy.mockRejectedValueOnce(new Error('D1 transient: database is locked'));

    const res = await signedRequest('DELETE', '/s3/my-bucket/atomic-test.txt');

    // Handler returns 500 (batch threw, escaped the handler before updateWorkspaceStorage)
    expect(res.status).toBe(500);

    // Both writes rolled back: is_trashed still 0 (NOT 1)
    const file = await env.DB.prepare('SELECT is_trashed FROM files WHERE id = ?')
      .bind('file-atomic-test.txt')
      .first<{ is_trashed: number }>();
    expect(file).toBeTruthy();
    expect(file!.is_trashed).toBe(0); // ← rolled back, NOT trashed

    // file_storage_stats NOT decremented: still 1000 (NOT 900)
    const stats = await env.DB.prepare(
      'SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?',
    )
      .bind(userId, 'text/plain')
      .first<{ total_size: number }>();
    expect(stats).toBeTruthy();
    expect(stats!.total_size).toBe(1000); // ← rolled back, NOT decremented

    // workspaces.used_bytes also NOT released (batch threw before updateWorkspaceStorage ran)
    const ws = await env.DB.prepare('SELECT used_bytes FROM workspaces WHERE id = ?')
      .bind(wsId)
      .first<{ used_bytes: number }>();
    expect(ws!.used_bytes).toBe(0); // workspace started at 0, still 0 (no leak either way)

    // Restore batch and verify retry succeeds (idempotent — file still live, not trashed)
    batchSpy.mockRestore();
    const res2 = await signedRequest('DELETE', '/s3/my-bucket/atomic-test.txt');
    expect(res2.status).toBe(204);

    // Now both writes committed: is_trashed = 1
    const file2 = await env.DB.prepare('SELECT is_trashed FROM files WHERE id = ?')
      .bind('file-atomic-test.txt')
      .first<{ is_trashed: number }>();
    expect(file2!.is_trashed).toBe(1);

    // And file_storage_stats decremented: 1000 - 100 = 900
    const stats2 = await env.DB.prepare(
      'SELECT total_size FROM file_storage_stats WHERE user_id = ? AND mime_type = ?',
    )
      .bind(userId, 'text/plain')
      .first<{ total_size: number }>();
    expect(stats2!.total_size).toBe(900);
  });

  // ─── 9.10 CompleteMultipartUpload: response returns before cleanup; cleanup eventually runs ───
  it('POST CompleteMultipartUpload returns 200 immediately and runs cleanup in waitUntil', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const aliceAccessKey = currentAccessKeyId;
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Seed multipart upload session + 1 part
    await env.DB.prepare(
      'INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id, created_at, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'upload-waituntil',
        userId,
        wsId,
        'large-file.bin',
        'drive-1',
        'temp-folder-wu',
        Date.now(),
        'application/octet-stream',
      )
      .run();

    await env.DB.prepare(
      'INSERT INTO s3_multipart_parts (upload_id, part_number, google_file_id, etag, size) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('upload-waituntil', 1, 'gfile-part-wu', '"partetag"', 100)
      .run();

    // Track deleteFile calls (cleanup phase) — they should run AFTER the response
    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        // initiateResumableUpload
        if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
          return new Response('', {
            status: 200,
            headers: {
              Location:
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=wu',
            },
          });
        }
        // Final upload PUT
        if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
          if (init.body instanceof ReadableStream) {
            const reader = init.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          return new Response(JSON.stringify({ id: 'gfile-final-wu', md5Checksum: 'abc' }), {
            status: 200,
          });
        }
        // Part download (during upload phase)
        if (url.includes('alt=media')) {
          return new Response('part-data', { status: 200 });
        }
        // deleteFile (during cleanup phase) — track these
        if (init?.method === 'DELETE' && url.includes('/files/')) {
          deleteCalls.push(url);
          return new Response(null, { status: 204 });
        }
        return new Response('{}', { status: 200 });
      },
    );

    const res = await signedRequest('POST', '/s3/my-bucket/large-file.bin', {
      queryParams: { uploadId: 'upload-waituntil' },
      body: '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"partetag"</ETag></Part></CompleteMultipartUpload>',
      accessKeyId: aliceAccessKey,
    });

    // Response returns 200 with ETag immediately (not blocked by cleanup)
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<ETag>"');
    expect(body).toContain('<CompleteMultipartUploadResult');

    // The file row is inserted (upload succeeded)
    const file = await env.DB.prepare(
      "SELECT google_file_id FROM files WHERE google_file_id = 'gfile-final-wu'",
    ).first();
    expect(file).toBeTruthy();

    // Cleanup eventually runs in waitUntil — wait for deleteFile calls.
    // The cleanup deletes: 1 part file + 1 temp folder = 2 delete calls.
    await vi.waitFor(
      () => {
        expect(deleteCalls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 3000 },
    );

    // s3_multipart_uploads row is deleted (deleteUpload ran in waitUntil)
    await vi.waitFor(
      async () => {
        const upload = await env.DB.prepare(
          "SELECT upload_id FROM s3_multipart_uploads WHERE upload_id = 'upload-waituntil'",
        ).first();
        expect(upload).toBeNull();
      },
      { timeout: 3000 },
    );
  });

  // ─── 9.11 CompleteMultipartUpload with 40 parts: response succeeds (cleanup deferred) ───
  it('POST CompleteMultipartUpload with 40 parts returns 200 (cleanup deferred to waitUntil)', async () => {
    const { userId } = await insertUserAndS3Cred('alice');
    const aliceAccessKey = currentAccessKeyId;
    const wsId = await insertWorkspace(userId, 'my-bucket');
    await insertDrive(userId, 'drive-1', 'alice@gmail.com');

    // Seed multipart upload session + 40 parts
    await env.DB.prepare(
      'INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id, created_at, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'upload-40parts',
        userId,
        wsId,
        'big.bin',
        'drive-1',
        'temp-folder-40',
        Date.now(),
        'application/octet-stream',
      )
      .run();

    for (let i = 1; i <= 40; i++) {
      await env.DB.prepare(
        'INSERT INTO s3_multipart_parts (upload_id, part_number, google_file_id, etag, size) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('upload-40parts', i, `gfile-part-${i}`, `"etag${i}"`, 10485760)
        .run();
    }

    // Build the CompleteMultipartUpload XML with 40 parts
    const partsXml = Array.from(
      { length: 40 },
      (_, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>"etag${i + 1}"</ETag></Part>`,
    ).join('');
    const requestBody = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('uploadType=resumable') && init?.method !== 'PUT') {
          return new Response('', {
            status: 200,
            headers: {
              Location:
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=40',
            },
          });
        }
        if (url.includes('uploadType=resumable') && init?.method === 'PUT') {
          if (init.body instanceof ReadableStream) {
            const reader = init.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          return new Response(JSON.stringify({ id: 'gfile-final-40', md5Checksum: 'abc' }), {
            status: 200,
          });
        }
        if (url.includes('alt=media')) {
          return new Response('part-data', { status: 200 });
        }
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return new Response('{}', { status: 200 });
      },
    );

    const res = await signedRequest('POST', '/s3/my-bucket/big.bin', {
      queryParams: { uploadId: 'upload-40parts' },
      body: requestBody,
      accessKeyId: aliceAccessKey,
    });

    // Before fix: this would 500 (or hang) because total subrequests ~95 > 50 budget.
    // After fix: response returns 200 immediately (cleanup deferred to waitUntil).
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<ETag>"');
  });
});
