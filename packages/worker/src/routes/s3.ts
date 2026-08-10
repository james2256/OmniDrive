import type { Context } from 'hono';
import { Hono } from 'hono';
import { s3AuthMiddleware } from '../middleware/s3-auth';
import type { AppContext } from '../types/context';
import { createDriveService } from '../lib/drive-factory';
import { generateId } from '../lib/id';
import { getMD5HashingStream, getSha256HashingStream } from '../lib/crypto-s3';
import { UploadRouter } from '../services/upload-router';
import {
  mapDriveRow,
  type WorkspaceRow,
  type FileRow,
  type DriveAccountRow,
  type WorkspaceFolderRow,
  type S3MultipartUploadRow,
  type S3MultipartPartRow,
} from '../types/db';
import type { DriveAccount } from '../types/domain';
import type { GDriveFile } from '../types/google';
import { createHash } from 'node:crypto';
import { hasPermission } from '../lib/rbac';
import type { WorkspaceRole } from '../lib/schemas';
import { parseLifecycleXml, serializeLifecycleXml } from '../services/s3-lifecycle';
import { PolicyService } from '../services/policy.service';
import { escapeXml, parseCompleteMultipartBody, xmlError } from '../lib/s3-xml';
import { ValidationError } from '../lib/errors';
import { logError } from '../lib/logger';
import { DriveRepository } from '../repositories/drive.repository';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import { FileRepository } from '../repositories/file.repository';
import { FolderRepository } from '../repositories/folder.repository';
import { S3LifecycleRepository } from '../repositories/s3-lifecycle.repository';
import { S3MultipartRepository } from '../repositories/s3-multipart.repository';

export const s3Router = new Hono<AppContext>({ strict: false });

// ponytail: S3 RBAC — read ops require viewer, write ops require editor.
// Enforced here instead of middleware because workspace is resolved per-handler.
function requireS3Role(
  c: Context,
  role: WorkspaceRole | null | undefined,
  write: boolean,
): Response | null {
  const needed = write ? 'editor' : 'viewer';
  if (!role || !hasPermission(role, needed)) {
    return xmlError(c, 'AccessDenied', `Insufficient permissions: ${needed} role required`, 403);
  }
  return null;
}

function parseSqliteDate(dateStr: string | number): Date {
  if (typeof dateStr === 'number') {
    return new Date(dateStr);
  }
  if (!dateStr) {
    return new Date();
  }
  if (/^\d+$/.test(dateStr)) {
    return new Date(parseInt(dateStr, 10));
  }
  if (dateStr.includes('T') || dateStr.endsWith('Z')) {
    return new Date(dateStr);
  }
  // Convert "YYYY-MM-DD HH:MM:SS" to "YYYY-MM-DDTHH:MM:SSZ"
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

function getFileETag(file: { id: string; metadata?: string | null }): string {
  if (file.metadata) {
    try {
      const meta = JSON.parse(file.metadata);
      if (meta && typeof meta === 'object' && meta.md5) {
        return meta.md5;
      }
    } catch {
      // ignore
    }
  }
  return file.id;
}

/** Format a SQLite datetime string as an RFC 1123 date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT"). */
function formatRfc1123Date(dateStr: string | null | undefined): string {
  if (!dateStr) return new Date().toUTCString();
  return parseSqliteDate(dateStr).toUTCString();
}

/**
 * Select the best drive for an S3 upload using UploadRouter (most free space).
 * Shared by PutObject (known size) and InitiateMultipartUpload (size unknown → 0).
 * Throws ValidationError if no drives connected or insufficient quota.
 */
async function selectDriveForS3Upload(
  db: D1Database,
  userId: string,
  fileSize: number,
): Promise<DriveAccount> {
  const driveRepo = new DriveRepository(db);
  const { results: driveRows } = await driveRepo.findAllByUser(userId);
  if (driveRows.length === 0) throw new ValidationError('No connected drives');
  const drives = driveRows
    .map((r) => mapDriveRow(r))
    .map((d: DriveAccount) => ({
      ...d,
      freeSpace: Math.max(0, d.totalQuota - d.usedQuota),
      usagePercent: d.totalQuota > 0 ? (d.usedQuota / d.totalQuota) * 100 : 0,
    }));
  return new UploadRouter(drives).selectDriveForUpload(fileSize);
}

s3Router.use('*', s3AuthMiddleware);

// GET /s3/ (List Buckets - maps to workspaces)
s3Router.get('/', async (c) => {
  const userId = c.get('userId');
  const s3WorkspaceId = c.get('s3WorkspaceId') || null;
  const db = c.env.DB;

  const workspaceRepo = new WorkspaceRepository(db);
  const { results: workspaces } = await workspaceRepo.findBucketsByUser(userId, s3WorkspaceId);

  let bucketsXml = '';
  for (const ws of workspaces) {
    bucketsXml += `    <Bucket>
      <Name>${escapeXml(ws.name)}</Name>
      <CreationDate>${escapeXml(parseSqliteDate(ws.created_at).toISOString())}</CreationDate>
    </Bucket>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>${escapeXml(userId)}</ID>
    <DisplayName>${escapeXml(userId)}</DisplayName>
  </Owner>
  <Buckets>
${bucketsXml}  </Buckets>
</ListAllMyBucketsResult>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

// GET /s3/:bucket (List Objects V2) or HEAD /s3/:bucket (HeadBucket)
s3Router.on(['GET', 'HEAD'], '/:bucket', async (c) => {
  const bucketName = c.req.param('bucket') ?? '';
  // Resolve Workspace by Bucket Name
  const resolved = await resolveBucket(c, false);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;
  const db = c.env.DB;

  // GET /s3/:bucket?lifecycle -> GetBucketLifecycleConfiguration
  if (c.req.method === 'GET' && c.req.query('lifecycle') !== undefined) {
    const s3LifecycleRepo = new S3LifecycleRepository(db);
    const { results } = await s3LifecycleRepo.findRules(workspace.id);
    if (!results?.length) {
      return xmlError(
        c,
        'NoSuchLifecycleConfiguration',
        'The lifecycle configuration does not exist.',
        404,
      );
    }
    const rules = results.map((r) => ({
      prefix: r.prefix,
      days: r.expiration_days,
      enabled: r.enabled === 1,
    }));
    return c.text(serializeLifecycleXml(rules), 200, { 'Content-Type': 'application/xml' });
  }

  if (c.req.method === 'HEAD') {
    return c.body(null, 200);
  }

  const prefix = c.req.query('prefix') || '';
  const delimiter = c.req.query('delimiter') || '';
  // S3 ListObjectsV2 pagination params (max-keys capped at 1000 per S3 spec).
  // Use nullish coalescing (??) not || so that max-keys=0 is respected (not treated as falsy).
  const rawMaxKeys = parseInt(c.req.query('max-keys') ?? '1000', 10);
  const maxKeys = Number.isFinite(rawMaxKeys) ? Math.min(Math.max(rawMaxKeys, 0), 1000) : 1000;
  const continuationToken = c.req.query('continuation-token') || '';
  const startAfter = c.req.query('start-after') || '';

  // Decode continuation token (opaque base64 of {key, id}) or start-after.
  // Known limitation: if a folder is renamed between paginated requests, the
  // s3_key (computed from folder path) changes — the cursor may skip/duplicate.
  let cursor: { key: string; id: string } | null = null;
  if (continuationToken) {
    try {
      cursor = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(continuationToken), (ch) => ch.charCodeAt(0)),
        ),
      ) as { key: string; id: string };
    } catch {
      cursor = null;
    }
  } else if (startAfter) {
    cursor = { key: startAfter, id: '' };
  }

  // Recursive SQLite CTE to assemble flat S3 keys for all workspace files.
  // ORDER BY s3_key, id ensures deterministic cursor pagination.
  const escapedPrefix = prefix.replace(/[%_^]/g, (ch) => '^' + ch) + '%';

  const { results: files } = await new FolderRepository(db).listFilesAsS3Keys(
    workspace.id,
    escapedPrefix,
    cursor,
    maxKeys,
  );

  // Detect truncation: if we got more than maxKeys, there's another page.
  const truncated = files.length > maxKeys;
  const pageFiles = truncated ? files.slice(0, maxKeys) : files;
  let nextToken = '';
  if (truncated && pageFiles.length > 0) {
    const last = pageFiles[pageFiles.length - 1];
    nextToken = btoa(
      String.fromCharCode(
        ...new TextEncoder().encode(JSON.stringify({ key: last.s3_key, id: last.id })),
      ),
    );
  }

  let contentsXml = '';
  const commonPrefixesSet = new Set<string>();

  for (const file of pageFiles) {
    const key = file.s3_key || '';
    if (!key.startsWith(prefix)) continue;

    if (delimiter === '/') {
      const rest = key.substring(prefix.length);
      const parts = rest.split('/');
      if (parts.length > 1) {
        // Directory
        commonPrefixesSet.add(prefix + parts[0] + '/');
      } else {
        // Immediate File
        contentsXml += `  <Contents>
    <Key>${escapeXml(key)}</Key>
    <LastModified>${escapeXml(parseSqliteDate(file.updated_at || new Date().toISOString()).toISOString())}</LastModified>
    <ETag>"${escapeXml(getFileETag(file))}"</ETag>
    <Size>${file.size}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>\n`;
      }
    } else {
      // Recursive List (No Delimiter)
      contentsXml += `  <Contents>
    <Key>${escapeXml(key)}</Key>
    <LastModified>${escapeXml(parseSqliteDate(file.updated_at || new Date().toISOString()).toISOString())}</LastModified>
    <ETag>"${escapeXml(getFileETag(file))}"</ETag>
    <Size>${file.size}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>\n`;
    }
  }

  let prefixesXml = '';
  for (const pref of commonPrefixesSet) {
    prefixesXml += `  <CommonPrefixes>
    <Prefix>${escapeXml(pref)}</Prefix>
  </CommonPrefixes>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(bucketName)}</Name>
  <Prefix>${escapeXml(prefix)}</Prefix>
  <MaxKeys>${maxKeys}</MaxKeys>
  <IsTruncated>${truncated}</IsTruncated>${continuationToken ? `\n  <ContinuationToken>${escapeXml(continuationToken)}</ContinuationToken>` : ''}${nextToken ? `\n  <NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : ''}
${contentsXml}${prefixesXml}</ListBucketResult>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

// Resolve a bucket (workspace) for bucket-level subresource ops.
async function resolveBucket(
  c: Context,
  needWrite: boolean,
): Promise<{ workspace: WorkspaceRow } | Response> {
  const userId = c.get('userId');
  const s3WorkspaceId = c.get('s3WorkspaceId') || null;
  const bucketName = c.req.param('bucket') ?? '';
  const workspaceRepo = new WorkspaceRepository(c.env.DB);
  const workspace = await workspaceRepo.resolveBucket(bucketName, userId, s3WorkspaceId);
  if (!workspace) return xmlError(c, 'NoSuchBucket', 'Bucket not found', 404);
  const denied = requireS3Role(c, workspace.role, needWrite);
  if (denied) return denied;
  return { workspace };
}

// PUT /s3/:bucket?lifecycle -> PutBucketLifecycleConfiguration (replaces all rules)
s3Router.put('/:bucket', async (c) => {
  if (c.req.query('lifecycle') === undefined) {
    return xmlError(
      c,
      'NotImplemented',
      'Only the ?lifecycle subresource is supported on buckets.',
      501,
    );
  }
  const resolved = await resolveBucket(c, true);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;

  const rules = parseLifecycleXml(await c.req.text());
  const db = c.env.DB;
  const s3LifecycleRepo = new S3LifecycleRepository(db);
  // Atomic: delete all existing rules + insert new ones in a single D1 batch.
  // If the batch fails midway, D1 rolls back — no partial-replace window.
  const stmts = [s3LifecycleRepo.deleteRulesStmt(workspace.id)];
  for (const r of rules) {
    stmts.push(
      s3LifecycleRepo.replaceRuleStmt(
        generateId(),
        workspace.id,
        r.prefix,
        r.days,
        r.enabled ? 1 : 0,
      ),
    );
  }
  await db.batch(stmts);
  return c.body(null, 200);
});

// DELETE /s3/:bucket?lifecycle -> DeleteBucketLifecycleConfiguration
s3Router.delete('/:bucket', async (c) => {
  if (c.req.query('lifecycle') === undefined) {
    return xmlError(
      c,
      'NotImplemented',
      'Only the ?lifecycle subresource is supported on buckets.',
      501,
    );
  }
  const resolved = await resolveBucket(c, true);
  if (resolved instanceof Response) return resolved;
  const s3LifecycleRepo = new S3LifecycleRepository(c.env.DB);
  await s3LifecycleRepo.deleteRules(resolved.workspace.id);
  return c.body(null, 204);
});

// Helpers to resolve virtual folders dynamically
async function getWorkspaceFolder(
  db: D1Database,
  workspaceId: string,
  folderPath: string,
): Promise<string | null | undefined> {
  if (!folderPath) return null;
  const folderRepo = new FolderRepository(db);
  const segments = folderPath.split('/').filter(Boolean);
  let parentId: string | null = null;
  for (const name of segments) {
    const existing = (await folderRepo.findFolderByPath(
      workspaceId,
      name,
      parentId,
    )) as WorkspaceFolderRow;
    if (!existing) return undefined;
    parentId = existing.id;
  }
  return parentId;
}

async function getOrCreateWorkspaceFolder(
  db: D1Database,
  workspaceId: string,
  folderPath: string,
): Promise<string | null> {
  if (!folderPath) return null;
  const folderRepo = new FolderRepository(db);
  const segments = folderPath.split('/').filter(Boolean);
  let parentId: string | null = null;

  for (const name of segments) {
    const existing = (await folderRepo.findFolderByPath(
      workspaceId,
      name,
      parentId,
    )) as WorkspaceFolderRow;

    if (existing) {
      parentId = existing.id;
    } else {
      const newId = generateId();
      await folderRepo.insertFolder(newId, workspaceId, name, parentId);
      parentId = newId;
    }
  }

  return parentId;
}

// GET /s3/:bucket/:key (GetObject - Download)
// Also handles HEAD (HeadObject) — Hono converts HEAD→GET internally and strips the body.
// c.req.method returns 'HEAD' for HEAD requests, so we branch on it for metadata-only responses.
s3Router.get('/:bucket/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const db = c.env.DB;

  const resolved = await resolveBucket(c, false);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;

  // Split S3 key to locate file
  const pathParts = key.split('/');
  const fileName = pathParts.pop() ?? '';
  const folderPath = pathParts.join('/');

  const folderId = await getWorkspaceFolder(db, workspace.id, folderPath);
  if (folderId === undefined) {
    return xmlError(c, 'NoSuchKey', `The specified key does not exist.`, 404);
  }

  const fileRepo = new FileRepository(db);
  const file = (await fileRepo.findByWorkspaceKeyFull(
    workspace.id,
    fileName,
    folderId,
  )) as FileRow | null;

  if (!file) return xmlError(c, 'NoSuchKey', `The specified key does not exist.`, 404);

  // Common headers for both HEAD and GET
  const lastModified = formatRfc1123Date(
    (file.google_modified_at as string | null) ||
      (file.google_created_at as string | null) ||
      (file.created_at as string),
  );
  c.header('Content-Type', file.mime_type || 'application/octet-stream');
  c.header('Content-Length', String(file.size));
  c.header('ETag', `"${getFileETag(file)}"`);
  c.header('Last-Modified', lastModified);
  c.header('Accept-Ranges', 'none'); // Range not supported — separate issue

  // HEAD: return headers only (Hono strips body for HEAD at the app level)
  if (c.req.method === 'HEAD') {
    return c.body(null);
  }

  const driveService = createDriveService(c.env);

  const { stream, exportedMimeType } = await driveService.downloadFile(
    file.drive_account_id,
    file.google_file_id,
    file.mime_type || undefined,
  );
  // Google Docs (vnd.google-apps.*) are exported to a different format with a
  // different size — file.size (D1) is the Google-side size, not the export size.
  // Omit Content-Length for exports so the runtime uses chunked encoding;
  // setting it would truncate or hang the client.
  const isGoogleDocExport = file.mime_type?.startsWith('application/vnd.google-apps.');
  c.header('Content-Type', exportedMimeType || file.mime_type || 'application/octet-stream');
  if (isGoogleDocExport) {
    c.header('Content-Length', ''); // clear for chunked encoding
  }
  return c.body(stream);
});

// DELETE /s3/:bucket/:key (DeleteObject)
s3Router.delete('/:bucket/:key{.+}', async (c) => {
  const userId = c.get('userId');
  const key = c.req.param('key');
  const db = c.env.DB;

  const resolved = await resolveBucket(c, true);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;

  const uploadId = c.req.query('uploadId');
  if (uploadId) {
    const multipartRepo = new S3MultipartRepository(db);
    const upload = await multipartRepo.findUploadExact(uploadId, userId, workspace.id);
    if (!upload) {
      return xmlError(c, 'NoSuchUpload', 'The specified multipart upload does not exist.', 404);
    }

    const driveService = createDriveService(c.env);

    try {
      await driveService.deleteFile(upload.drive_account_id, upload.temp_folder_id);
    } catch (err) {
      logError(c, 'Failed to delete temp multipart upload folder from Google Drive', err);
    }

    const s3LifecycleRepo = new S3LifecycleRepository(db);
    await s3LifecycleRepo.deleteUpload(uploadId);
    return c.body(null, 204);
  }

  const pathParts = key.split('/');
  const fileName = pathParts.pop() ?? '';
  const folderPath = pathParts.join('/');

  const folderId = await getWorkspaceFolder(db, workspace.id, folderPath);
  if (folderId === undefined) {
    return xmlError(c, 'NoSuchKey', `The specified key does not exist.`, 404);
  }

  const fileRepo = new FileRepository(db);
  const file = (await fileRepo.findByWorkspaceKeyFull(
    workspace.id,
    fileName,
    folderId,
  )) as FileRow | null;

  if (!file) return xmlError(c, 'NoSuchKey', `The specified key does not exist.`, 404);

  // Gate: don't allow S3 DELETE of files owned by another user.
  if (file.owned_by_me !== 1) {
    return xmlError(c, 'AccessDenied', 'Cannot delete file owned by another user', 403);
  }

  const driveService = createDriveService(c.env);

  // Trash file in Google Drive (recoverable ~30 days) and mark as trashed in D1.
  // Matches s3-lifecycle.ts pattern — S3 DELETE trashes, not hard-deletes.
  await driveService.trashFile(file.drive_account_id, file.google_file_id);
  await fileRepo.markTrashedSystem(file.id);
  await fileRepo.applyStorageDeltas([
    { userId: file.user_id, mimeType: file.mime_type ?? '', delta: -file.size },
  ]);

  return c.body(null, 204);
});

// PUT /s3/:bucket/:key (PutObject or UploadPart)
s3Router.put('/:bucket/:key{.+}', async (c) => {
  const uploadId = c.req.query('uploadId');
  const partNumberStr = c.req.query('partNumber');

  if (uploadId && partNumberStr) {
    // UploadPart: validate part number BEFORE any work
    const partNumber = Number(partNumberStr);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return xmlError(c, 'InvalidArgument', 'Part number must be between 1 and 10000', 400);
    }

    // RBAC: resolve bucket and check write permission before uploading the part.
    // Previously this was skipped — handleUploadPart was called before resolveBucket,
    // allowing viewers to upload parts if they had an uploadId.
    const resolved = await resolveBucket(c, true);
    if (resolved instanceof Response) return resolved;
    const { workspace } = resolved;

    // Assert the upload session belongs to the resolved workspace
    const db = c.env.DB;
    const multipartRepo = new S3MultipartRepository(db);
    const upload = await multipartRepo.findUploadScoped(
      uploadId,
      c.get('userId'),
      c.get('s3WorkspaceId') || null,
    );
    if (!upload) {
      return xmlError(c, 'NoSuchUpload', 'The specified multipart upload does not exist.', 404);
    }
    if (upload.workspace_id !== workspace.id) {
      return xmlError(c, 'AccessDenied', 'Upload session does not belong to this bucket', 403);
    }

    return handleUploadPart(c, upload, partNumber);
  }

  const key = c.req.param('key');
  const db = c.env.DB;

  const resolved = await resolveBucket(c, true);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;
  const userId = c.get('userId');

  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  const mimeType = c.req.header('Content-Type') || 'application/octet-stream';

  // 1. Select target Drive using UploadRouter (shared helper)
  let targetDrive: DriveAccount;
  try {
    targetDrive = await selectDriveForS3Upload(db, userId, contentLength);
  } catch (err) {
    return xmlError(c, 'InvalidRequest', (err as Error).message, 400);
  }

  // 2. Hash data on-the-fly to get ETag (MD5) + verify body integrity (SHA-256)
  const bodyStream = c.req.raw.body;
  if (!bodyStream) return xmlError(c, 'MissingContentLength', 'Empty request body', 400);

  const { stream: md5Stream, getHash: getMd5Hash } = getMD5HashingStream();
  const { stream: sha256Stream, getHash: getSha256Hash } = getSha256HashingStream();
  const pipedStream = bodyStream.pipeThrough(md5Stream).pipeThrough(sha256Stream);

  // 3. Perform Direct Google Drive Upload
  const driveService = createDriveService(c.env);

  // Reserve workspace storage quota BEFORE upload (atomic — prevents TOCTOU race
  // and data loss on overwrite). If the upload fails after this point, the
  // reservation is released via updateWorkspaceStorage(workspaceId, -contentLength).
  const policyService = new PolicyService(db, driveService);
  if (contentLength > 0) {
    const ok = await policyService.tryReserveQuota(workspace.id, contentLength);
    if (!ok) {
      return xmlError(c, 'QuotaExceeded', 'Storage quota exceeded', 403);
    }
  }
  const quotaReserved = contentLength > 0;

  const pathParts = key.split('/');
  const fileName = pathParts.pop() ?? '';
  const folderPath = pathParts.join('/');
  const folderId = await getOrCreateWorkspaceFolder(db, workspace.id, folderPath);

  // Check if file already exists in D1 under the same folder/name/workspace
  const fileRepo = new FileRepository(db);
  const existingFile = await fileRepo.findByWorkspaceKeyFull(
    workspace.id,
    fileName,
    folderId || null,
  );

  // Gate: don't allow overwriting files owned by another user via S3.
  // Checked BEFORE the upload so no orphan Google Drive files are created.
  if (existingFile && existingFile.owned_by_me !== 1) {
    return xmlError(c, 'AccessDenied', 'Cannot overwrite file owned by another user', 403);
  }

  // Initiate resumable session + upload. Wrapped in try/catch to release
  // the pre-reserved quota on any failure (prevents quota leak).
  let gFile: { id?: string; md5Checksum?: string } = {};
  let md5Hex: string;
  try {
    const uploadUrl = await driveService.initiateResumableUpload(
      targetDrive.id,
      fileName || '',
      mimeType,
      targetDrive.rootFolderId || 'root',
    );

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(contentLength) },
      body: pipedStream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    if (!response.ok) throw new Error('Upload to Google Drive failed');

    const rawBody = await response.text();
    try {
      gFile = JSON.parse(rawBody);
    } catch {
      /* non-JSON Google response */
    }

    if (!gFile.id) throw new Error('Google Drive did not return a file ID');

    md5Hex = getMd5Hash();

    // Verify body integrity (SHA-256)
    const expectedSha256 = c.req.header('x-amz-content-sha256');
    if (
      expectedSha256 &&
      expectedSha256 !== 'UNSIGNED-PAYLOAD' &&
      !expectedSha256.startsWith('STREAMING-')
    ) {
      const actualSha256 = getSha256Hash();
      if (actualSha256 !== expectedSha256) {
        try {
          await driveService.deleteFile(targetDrive.id, gFile.id);
        } catch {
          /* best-effort */
        }
        throw new Error('SignatureDoesNotMatch');
      }
    }
  } catch (err) {
    // Release the pre-reserved quota (compensating decrement)
    if (quotaReserved) {
      try {
        await policyService.updateWorkspaceStorage(workspace.id, -contentLength);
      } catch {
        /* best-effort — quota may be slightly over-reserved */
      }
    }
    const msg = (err as Error).message;
    if (msg === 'SignatureDoesNotMatch') {
      return xmlError(
        c,
        'SignatureDoesNotMatch',
        'The provided hash does not match the calculated hash of the request body.',
        403,
      );
    }
    return xmlError(c, 'InternalError', msg, 502);
  }

  // Fetch metadata (thumbnail, links) for the newly uploaded file. Non-fatal —
  // if this fails, the file is already uploaded; we just won't have a thumbnail yet.
  let fileMeta: GDriveFile | null = null;
  try {
    fileMeta = await driveService.getFile(targetDrive.id, gFile.id);
  } catch (err) {
    logError(c, 'S3 upload: metadata fetch failed (non-fatal)', err);
  }

  const fileId = generateId();
  const insertStmt = fileRepo.insertS3ObjectStmt({
    id: fileId,
    userId,
    driveAccountId: targetDrive.id,
    workspaceId: workspace.id,
    folderId: folderId || null,
    googleFileId: gFile.id ?? '',
    name: fileName,
    mimeType,
    size: contentLength,
    metadata: JSON.stringify({ md5: md5Hex }),
    thumbnailUrl: fileMeta?.thumbnailLink ?? null,
    webViewLink: fileMeta?.webViewLink ?? null,
    webContentLink: fileMeta?.webContentLink ?? null,
  });

  // Batch the D1 DELETE + INSERT atomically FIRST. If D1 fails, the old Google
  // file is still alive (no data loss). The old Google file is deleted
  // best-effort AFTER the batch succeeds — an orphan is storage waste, not
  // data corruption.
  try {
    if (existingFile) {
      await db.batch([fileRepo.deleteByIdStmt(existingFile.id), insertStmt]);
    } else {
      // No existing file found — but a concurrent PUT may have inserted one.
      // On unique constraint error, re-read, delete the race winner, and insert.
      try {
        await insertStmt.run();
      } catch (err) {
        const raceFile = await fileRepo.findByWorkspaceKeyMinimal(
          workspace.id,
          fileName,
          folderId || null,
        );
        if (raceFile) {
          await db.batch([fileRepo.deleteByIdStmt(raceFile.id), insertStmt]);
          try {
            if (raceFile.owned_by_me === 1) {
              await driveService.deleteFile(raceFile.drive_account_id, raceFile.google_file_id);
            }
          } catch (e) {
            logError(c, 'Failed to delete race-loser Google file (orphaned — not data loss)', e);
          }
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    // D1 failed after a successful Google upload — delete the orphaned Google
    // file and release the pre-reserved quota (prevents quota leak).
    logError(c, 'D1 insert failed after Google upload — cleaning up', err);
    try {
      await driveService.deleteFile(targetDrive.id, gFile.id ?? '');
    } catch (e) {
      logError(c, 'Failed to delete orphaned Google file after D1 failure', e);
    }
    if (quotaReserved) {
      try {
        await policyService.updateWorkspaceStorage(workspace.id, -contentLength);
      } catch {
        /* best-effort */
      }
    }
    return xmlError(c, 'InternalError', 'Failed to record uploaded file', 500);
  }

  // Delete old Google file after D1 succeeds — best-effort (orphan, not data loss).
  if (existingFile) {
    try {
      await driveService.deleteFile(existingFile.drive_account_id, existingFile.google_file_id);
    } catch (err) {
      logError(c, 'Failed to delete old file from Google Drive (orphaned — not data loss)', err);
    }
    // Release old file's quota + storage stats (prevents quota drift on overwrite).
    try {
      await policyService.updateWorkspaceStorage(workspace.id, -(existingFile.size as number));
      await fileRepo.applyStorageDeltas([
        {
          userId: existingFile.user_id as string,
          mimeType: (existingFile.mime_type as string) ?? '',
          delta: -(existingFile.size as number),
        },
      ]);
    } catch (err) {
      logError(c, 'S3 PutObject: old file quota release failed (non-fatal)', err);
    }
  }

  // Update per-MIME-type storage stats (mirrors Web UI finalizeUpload).
  // Best-effort — a failure here only affects the "Storage by type" chart,
  // not the file record or quota. recomputeStorageStats() is the backstop.
  try {
    await fileRepo.applyStorageDeltas([{ userId, mimeType, delta: contentLength }]);
  } catch (err) {
    logError(c, 'S3 PutObject: storage stats update failed (non-fatal)', err);
  }

  // Quota was reserved before upload; on success the reservation stands.

  c.header('ETag', `"${md5Hex}"`);
  return c.body(null, 200);
});

// Helper to upload a part (upload session + workspace already validated by caller)
async function handleUploadPart(
  c: Context,
  upload: S3MultipartUploadRow,
  partNumber: number,
): Promise<Response> {
  const db = c.env.DB;
  const multipartRepo = new S3MultipartRepository(db);

  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  const bodyStream = c.req.raw.body;
  if (!bodyStream) return xmlError(c, 'MissingContentLength', 'Missing part body', 400);

  // Hash part on the fly (MD5 for ETag + SHA-256 for body integrity)
  const { stream: md5Stream, getHash: getMd5Hash } = getMD5HashingStream();
  const { stream: sha256Stream, getHash: getSha256Hash } = getSha256HashingStream();
  const pipedStream = bodyStream.pipeThrough(md5Stream).pipeThrough(sha256Stream);

  const driveService = createDriveService(c.env);

  // Upload part as a separate temporary file inside temp_folder_id in Google Drive
  const partFileName = `part_${partNumber}`;
  const uploadUrl = await driveService.initiateResumableUpload(
    upload.drive_account_id,
    partFileName,
    'application/octet-stream',
    upload.temp_folder_id,
  );

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(contentLength) },
    body: pipedStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  if (!response.ok) {
    return xmlError(c, 'InternalError', 'Failed uploading part to Google Drive', 502);
  }

  const rawBody = await response.text();
  let gFile: { id?: string; md5Checksum?: string } = {};
  try {
    gFile = JSON.parse(rawBody);
  } catch {
    /* non-JSON Google response */
  }

  const md5Hex = getMd5Hash();

  // Reject if Google did not return a file ID — prevents corrupt D1 rows
  // (matches the validation in PUT handler and CompleteMultipart handler).
  if (!gFile.id) {
    return xmlError(c, 'InternalError', 'Google Drive did not return a file ID', 502);
  }

  // Verify body integrity (same as PutObject)
  const expectedSha256 = c.req.header('x-amz-content-sha256');
  if (
    expectedSha256 &&
    expectedSha256 !== 'UNSIGNED-PAYLOAD' &&
    !expectedSha256.startsWith('STREAMING-')
  ) {
    const actualSha256 = getSha256Hash();
    if (actualSha256 !== expectedSha256) {
      try {
        await driveService.deleteFile(upload.drive_account_id, gFile.id);
      } catch {
        /* best-effort */
      }
      return xmlError(
        c,
        'SignatureDoesNotMatch',
        'The provided hash does not match the calculated hash of the request body.',
        403,
      );
    }
  }

  // Store part state in DB (replace if already exists)
  await multipartRepo.upsertPart({
    uploadId: upload.upload_id,
    partNumber,
    googleFileId: gFile.id,
    etag: `"${md5Hex}"`,
    size: contentLength,
  });

  c.header('ETag', `"${md5Hex}"`);
  return c.body(null, 200);
}

// POST /s3/:bucket/:key (Initiate / Complete Multipart Upload)
s3Router.post('/:bucket/:key{.+}', async (c) => {
  const userId = c.get('userId');
  const s3WorkspaceId = c.get('s3WorkspaceId') || null;
  const bucketName = c.req.param('bucket') ?? '';
  const key = c.req.param('key');
  const uploadsParam = c.req.query('uploads');
  const uploadId = c.req.query('uploadId');
  const db = c.env.DB;

  const resolved = await resolveBucket(c, true);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;

  const driveService = createDriveService(c.env);

  // 1. Initiate Multipart Upload
  if (uploadsParam !== undefined) {
    const uploadId = generateId();

    // Choose target drive using UploadRouter (same as PutObject — picks drive with most free space)
    let targetDrive: DriveAccount;
    try {
      targetDrive = await selectDriveForS3Upload(db, userId, 0); // size unknown at Initiate
    } catch (err) {
      return xmlError(c, 'InvalidRequest', (err as Error).message, 400);
    }

    // Create temp folder inside Google Drive
    const tempFolderName = `.omnidrive_multipart_${uploadId}`;
    const tempFolderId = await driveService.createFolder(
      targetDrive.id,
      tempFolderName,
      targetDrive.rootFolderId || undefined,
    );

    const multipartRepo = new S3MultipartRepository(db);
    await multipartRepo.insertUpload({
      uploadId,
      userId,
      workspaceId: workspace.id,
      key,
      driveAccountId: targetDrive.id,
      tempFolderId,
      contentType: c.req.header('Content-Type') ?? null,
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucketName)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <UploadId>${uploadId}</UploadId>
</InitiateMultipartUploadResult>`;

    c.header('Content-Type', 'application/xml');
    return c.text(xml);
  }

  // 2. Complete Multipart Upload
  if (uploadId) {
    const multipartRepo = new S3MultipartRepository(db);
    const upload = await multipartRepo.findUploadScoped(uploadId, userId, s3WorkspaceId);
    if (!upload) return xmlError(c, 'NoSuchUpload', 'Upload session not found', 404);

    // Cross-bucket guard: an unscoped credential can resolve a different
    // workspace than the one the upload started in. Reject before writing —
    // otherwise the file lands in the wrong workspace's folder tree.
    if (upload.workspace_id !== workspace.id) {
      return xmlError(c, 'InvalidRequest', 'Upload session does not belong to this bucket', 400);
    }

    // Get all parts ordered by part_number from D1
    const { results: d1Parts } = await multipartRepo.findPartsByUpload(uploadId);
    if (d1Parts.length === 0) {
      return xmlError(c, 'InvalidRequest', 'No parts found to complete upload', 400);
    }

    // Parse the <CompleteMultipartUpload> XML body. S3 clients send a list of
    // (PartNumber, ETag) pairs specifying which parts to concatenate and in what
    // order. If the body is empty (quirky clients), fall back to all D1 parts.
    const rawBody = await c.req.text();
    const requestedParts = parseCompleteMultipartBody(rawBody);

    let parts: S3MultipartPartRow[];
    if (requestedParts.length > 0) {
      const d1Map = new Map(d1Parts.map((p) => [p.part_number, p]));
      parts = [];
      let lastPartNumber = 0;
      for (const req of requestedParts) {
        // S3 requires parts in ascending PartNumber order (InvalidPartOrder).
        // Out-of-order parts would concatenate in the wrong sequence → corrupt file.
        if (req.partNumber <= lastPartNumber) {
          return xmlError(
            c,
            'InvalidPartOrder',
            `Part numbers must be in ascending order. ${req.partNumber} follows ${lastPartNumber}.`,
            400,
          );
        }
        lastPartNumber = req.partNumber;
        const d1Part = d1Map.get(req.partNumber);
        if (!d1Part) {
          return xmlError(c, 'InvalidPart', `Part number ${req.partNumber} not found`, 400);
        }
        // Verify ETag if the client provided one (strips surrounding quotes)
        if (req.etag) {
          const clientEtag = req.etag.replace(/^"|"$/g, '');
          const d1Etag = d1Part.etag.replace(/^"|"$/g, '');
          if (clientEtag !== d1Etag) {
            return xmlError(c, 'InvalidPart', `ETag mismatch for part ${req.partNumber}`, 400);
          }
        }
        parts.push(d1Part);
      }
    } else {
      parts = d1Parts;
    }

    // Cap parts count to stay within Cloudflare Workers' 50-subrequest budget.
    // Each part requires 1 downloadFile call; 40 parts + 1 upload + D1 + token = ~47.
    const MAX_PARTS_FOR_COMPLETE = 40;
    if (parts.length > MAX_PARTS_FOR_COMPLETE) {
      return xmlError(
        c,
        'InvalidRequest',
        `Multipart upload has ${parts.length} parts. Maximum ${MAX_PARTS_FOR_COMPLETE} parts supported per complete (Worker subrequest budget).`,
        400,
      );
    }

    const pathParts = key.split('/');
    const fileName = pathParts.pop() ?? '';
    const folderPath = pathParts.join('/');
    const folderId = await getOrCreateWorkspaceFolder(db, workspace.id, folderPath);

    // Compute total size
    const totalSize = parts.reduce((acc, p) => acc + p.size, 0);

    // Reserve workspace storage quota BEFORE upload (atomic — prevents TOCTOU race
    // and data loss on overwrite).
    const policyService = new PolicyService(db, driveService);
    if (totalSize > 0) {
      const ok = await policyService.tryReserveQuota(workspace.id, totalSize);
      if (!ok) {
        return xmlError(c, 'QuotaExceeded', 'Storage quota exceeded', 403);
      }
    }
    const quotaReserved = totalSize > 0;

    // Fetch drive account to get its root folder ID
    const driveRepo = new DriveRepository(db);
    const driveAccount = (await driveRepo.findById(
      upload.drive_account_id,
    )) as DriveAccountRow | null;
    const destFolderId = driveAccount?.root_folder_id || 'root';

    // Initiate final file upload + concatenate. Wrapped in try/catch to release
    // the pre-reserved quota on any failure.
    let gFile: { id?: string; md5Checksum?: string } = {};
    try {
      const finalUploadUrl = await driveService.initiateResumableUpload(
        upload.drive_account_id,
        fileName || '',
        upload.content_type ?? 'application/octet-stream',
        destFolderId,
      );

      // Stream concatenate all parts
      let currentPartIndex = 0;
      let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const finalStream = new ReadableStream({
        async pull(controller) {
          while (true) {
            if (!currentReader) {
              if (currentPartIndex >= parts.length) {
                controller.close();
                return;
              }
              const part = parts[currentPartIndex];
              const { stream: partStream } = await driveService.downloadFile(
                upload.drive_account_id,
                part.google_file_id,
              );
              currentReader = partStream.getReader();
            }
            const { done, value } = await currentReader.read();
            if (done) {
              // Release the finished part's reader and advance to the next part.
              currentReader = null;
              currentPartIndex++;
              continue;
            }
            if (value) {
              controller.enqueue(value);
              return; // Yield control back to the stream consumer.
            }
          }
        },
        cancel() {
          if (currentReader) currentReader.cancel();
        },
      });

      const response = await fetch(finalUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(totalSize) },
        body: finalStream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      if (!response.ok) throw new Error('Final concatenation failed');

      const rawBody = await response.text();
      try {
        gFile = JSON.parse(rawBody);
      } catch {
        /* non-JSON Google response */
      }

      if (!gFile.id) throw new Error('Google Drive did not return a file ID');
    } catch (err) {
      // Release the pre-reserved quota (compensating decrement)
      if (quotaReserved) {
        try {
          await policyService.updateWorkspaceStorage(workspace.id, -totalSize);
        } catch {
          /* best-effort */
        }
      }
      return xmlError(c, 'InternalError', (err as Error).message, 502);
    }

    // Check if file already exists in D1 under the same folder/name/workspace
    const fileRepo = new FileRepository(db);
    const existingFile = await fileRepo.findByWorkspaceKeyFull(
      workspace.id,
      fileName,
      folderId || null,
    );

    // Gate: don't allow overwriting files owned by another user via S3.
    if (existingFile && existingFile.owned_by_me !== 1) {
      return xmlError(c, 'AccessDenied', 'Cannot overwrite file owned by another user', 403);
    }

    // Calculate S3-compliant ETag
    const concatenatedMd5s = Buffer.concat(
      parts.map((p) => Buffer.from(p.etag.replace(/"/g, ''), 'hex')),
    );
    const finalMd5 = createHash('md5').update(concatenatedMd5s).digest('hex');
    const s3Etag = `${finalMd5}-${parts.length}`;

    // Fetch metadata (thumbnail, links) for the newly uploaded file. Non-fatal —
    // if this fails, the file is already uploaded; we just won't have a thumbnail yet.
    let fileMeta: GDriveFile | null = null;
    try {
      fileMeta = await driveService.getFile(upload.drive_account_id, gFile.id ?? '');
    } catch (err) {
      logError(c, 'S3 multipart upload: metadata fetch failed (non-fatal)', err);
    }

    // Insert completed file record into database
    const fileId = generateId();
    const insertStmt = fileRepo.insertS3ObjectStmt({
      id: fileId,
      userId,
      driveAccountId: upload.drive_account_id,
      workspaceId: workspace.id,
      folderId: folderId || null,
      googleFileId: gFile.id ?? '',
      name: fileName,
      mimeType: upload.content_type ?? 'application/octet-stream',
      size: totalSize,
      metadata: JSON.stringify({ md5: s3Etag }),
      thumbnailUrl: fileMeta?.thumbnailLink ?? null,
      webViewLink: fileMeta?.webViewLink ?? null,
      webContentLink: fileMeta?.webContentLink ?? null,
    });

    // Batch the D1 DELETE + INSERT atomically FIRST. If D1 fails, the old
    // Google file is still alive (no data loss). The old Google file is
    // deleted best-effort AFTER the batch succeeds.
    try {
      if (existingFile) {
        await db.batch([fileRepo.deleteByIdStmt(existingFile.id), insertStmt]);
      } else {
        // No existing file — handle concurrent PUT race (same as PutObject handler)
        try {
          await insertStmt.run();
        } catch (err) {
          const raceFile = await fileRepo.findByWorkspaceKeyMinimal(
            workspace.id,
            fileName,
            folderId || null,
          );
          if (raceFile) {
            await db.batch([fileRepo.deleteByIdStmt(raceFile.id), insertStmt]);
            try {
              if (raceFile.owned_by_me === 1) {
                await driveService.deleteFile(raceFile.drive_account_id, raceFile.google_file_id);
              }
            } catch (e) {
              logError(c, 'Failed to delete race-loser Google file (orphaned — not data loss)', e);
            }
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      // D1 failed after a successful Google upload — delete the orphaned Google
      // file and release the pre-reserved quota (prevents quota leak).
      logError(c, 'D1 insert failed after Google upload — cleaning up', err);
      try {
        await driveService.deleteFile(upload.drive_account_id, gFile.id ?? '');
      } catch (e) {
        logError(c, 'Failed to delete orphaned Google file after D1 failure', e);
      }
      if (quotaReserved) {
        try {
          await policyService.updateWorkspaceStorage(workspace.id, -totalSize);
        } catch {
          /* best-effort */
        }
      }
      return xmlError(c, 'InternalError', 'Failed to record uploaded file', 500);
    }

    // Delete old Google file after D1 succeeds — best-effort (orphan, not data loss).
    if (existingFile) {
      try {
        await driveService.deleteFile(existingFile.drive_account_id, existingFile.google_file_id);
      } catch (err) {
        logError(c, 'Failed to delete old file from Google Drive (orphaned — not data loss)', err);
      }
      // Release old file's quota + storage stats (prevents quota drift on overwrite).
      try {
        await policyService.updateWorkspaceStorage(workspace.id, -(existingFile.size as number));
        await fileRepo.applyStorageDeltas([
          {
            userId: existingFile.user_id as string,
            mimeType: (existingFile.mime_type as string) ?? '',
            delta: -(existingFile.size as number),
          },
        ]);
      } catch (err) {
        logError(c, 'S3 CompleteMultipart: old file quota release failed (non-fatal)', err);
      }
    }

    // Quota was reserved before upload. On success, the reservation stands.

    // Update per-MIME-type storage stats (mirrors Web UI finalizeUpload).
    try {
      await fileRepo.applyStorageDeltas([
        {
          userId,
          mimeType: upload.content_type ?? 'application/octet-stream',
          delta: totalSize,
        },
      ]);
    } catch (err) {
      logError(c, 'S3 CompleteMultipart: storage stats update failed (non-fatal)', err);
    }

    // Cleanup: Delete temp parts folder from Google Drive & clean SQLite state
    try {
      await driveService.deleteFile(upload.drive_account_id, upload.temp_folder_id);
    } catch (err) {
      logError(c, 'Failed to delete temp multipart folder from Google Drive', err);
    }
    const s3LifecycleRepo = new S3LifecycleRepository(db);
    await s3LifecycleRepo.deleteUpload(uploadId);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Location>${escapeXml(`${c.env.WORKER_URL}/s3/${encodeURIComponent(bucketName)}/${encodeURIComponent(key)}`)}</Location>
  <Bucket>${escapeXml(bucketName)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <ETag>"${s3Etag}"</ETag>
</CompleteMultipartUploadResult>`;

    c.header('Content-Type', 'application/xml');
    return c.text(xml);
  }

  return xmlError(c, 'InvalidRequest', 'Invalid query parameter sequence', 400);
});
