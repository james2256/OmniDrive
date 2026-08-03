import type { Context } from 'hono';
import { Hono } from 'hono';
import { s3AuthMiddleware } from '../middleware/s3-auth';
import type { AppContext } from '../types/context';
import { createDriveService } from '../lib/drive-factory';
import { generateId } from '../lib/id';
import { getMD5HashingStream } from '../lib/crypto-s3';
import { UploadRouter } from '../services/upload-router';
import {
  mapDriveRow,
  type WorkspaceRow,
  type FileRow,
  type DriveAccountRow,
  type WorkspaceFolderRow,
} from '../types/db';
import type { DriveAccount } from '../types/domain';
import type { GDriveFile } from '../types/google';
import { createHash } from 'node:crypto';
import { hasPermission } from '../lib/rbac';
import type { WorkspaceRole } from '../lib/schemas';
import { parseLifecycleXml, serializeLifecycleXml } from '../services/s3-lifecycle';
import { PolicyService } from '../services/policy.service';
import { escapeXml, xmlError } from '../lib/s3-xml';
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
<ListAllMyBucketsResult>
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
  const maxKeys = Math.min(parseInt(c.req.query('max-keys') || '1000', 10) || 1000, 1000);
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
<ListBucketResult>
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
  await s3LifecycleRepo.deleteRules(workspace.id);
  for (const r of rules) {
    await s3LifecycleRepo.replaceRule(
      generateId(),
      workspace.id,
      r.prefix,
      r.days,
      r.enabled ? 1 : 0,
    );
  }
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

// HEAD /s3/:bucket/:key (HeadObject - Get Metadata)
s3Router.on('HEAD', '/:bucket/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const db = c.env.DB;

  const resolved = await resolveBucket(c, false);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;

  const pathParts = key.split('/');
  const fileName = pathParts.pop() ?? '';
  const folderPath = pathParts.join('/');

  const folderId = await getWorkspaceFolder(db, workspace.id, folderPath);
  if (folderId === undefined) return c.text('Not Found', 404);

  const fileRepo = new FileRepository(db);
  const file = (await fileRepo.findByWorkspaceKeyFull(
    workspace.id,
    fileName,
    folderId,
  )) as FileRow | null;

  if (!file) return c.text('Not Found', 404);

  c.header('Content-Type', file.mime_type || 'application/octet-stream');
  c.header('Content-Length', String(file.size));
  c.header('ETag', `"${getFileETag(file)}"`);
  return c.body(null);
});

// GET /s3/:bucket/:key (GetObject - Download)
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

  if (c.req.method === 'HEAD') {
    c.header('Content-Type', file.mime_type || 'application/octet-stream');
    c.header('Content-Length', String(file.size));
    c.header('ETag', `"${getFileETag(file)}"`);
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
  if (!isGoogleDocExport) {
    c.header('Content-Length', String(file.size));
  }
  c.header('ETag', `"${getFileETag(file)}"`);
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
      const errorCode = 'NoSuchUpload';
      const errorMessage = 'The specified multipart upload does not exist.';
      return c.text(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${escapeXml(errorCode)}</Code><Message>${escapeXml(errorMessage)}</Message></Error>`,
        404,
        { 'Content-Type': 'application/xml' },
      );
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

  const driveService = createDriveService(c.env);

  // Trash file in Google Drive (recoverable ~30 days) and mark as trashed in D1.
  // Matches s3-lifecycle.ts pattern — S3 DELETE trashes, not hard-deletes.
  await driveService.trashFile(file.drive_account_id, file.google_file_id);
  await fileRepo.markTrashedSystem(file.id);

  return c.body(null, 204);
});

// PUT /s3/:bucket/:key (PutObject or UploadPart)
s3Router.put('/:bucket/:key{.+}', async (c) => {
  const uploadId = c.req.query('uploadId');
  const partNumberStr = c.req.query('partNumber');

  if (uploadId && partNumberStr) {
    // Handled in Task 7 (Upload Part)
    return handleUploadPart(c, uploadId, parseInt(partNumberStr, 10));
  }

  const key = c.req.param('key');
  const db = c.env.DB;

  const resolved = await resolveBucket(c, true);
  if (resolved instanceof Response) return resolved;
  const { workspace } = resolved;
  const userId = c.get('userId');

  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  const mimeType = c.req.header('Content-Type') || 'application/octet-stream';

  // 1. Select target Drive using UploadRouter
  const driveRepo = new DriveRepository(db);
  const { results: driveRows } = await driveRepo.findAllByUser(userId);
  if (driveRows.length === 0) return c.text('No connected drives', 400);

  const drives = driveRows
    .map((r) => mapDriveRow(r))
    .map((d: DriveAccount) => ({
      ...d,
      freeSpace: Math.max(0, d.totalQuota - d.usedQuota),
      usagePercent: d.totalQuota > 0 ? (d.usedQuota / d.totalQuota) * 100 : 0,
    }));

  const router = new UploadRouter(drives);
  const targetDrive = router.selectDriveForUpload(contentLength);

  // 2. Hash data on-the-fly to get ETag
  const bodyStream = c.req.raw.body;
  if (!bodyStream) return c.text('Empty request body', 400);

  const { stream: hashingStream, getHash } = getMD5HashingStream();
  const pipedStream = bodyStream.pipeThrough(hashingStream);

  // 3. Perform Direct Google Drive Upload
  const driveService = createDriveService(c.env);

  // Enforce workspace storage quota (mirrors HTTP /api/files/upload/init).
  // Placed after driveService creation so the same instance is reused for
  // both the check and the increment after the INSERT.
  if (contentLength > 0) {
    const policyService = new PolicyService(db, driveService);
    const hasQuota = await policyService.checkQuota(workspace.id, contentLength);
    if (!hasQuota) {
      return xmlError(c, 'QuotaExceeded', 'Storage quota exceeded', 403);
    }
  }

  const pathParts = key.split('/');
  const fileName = pathParts.pop() ?? '';
  const folderPath = pathParts.join('/');
  const folderId = await getOrCreateWorkspaceFolder(db, workspace.id, folderPath);

  // Check if file already exists in D1 under the same folder/name/workspace
  const fileRepo = new FileRepository(db);
  const existingFile = (await fileRepo.findByWorkspaceKeyMinimal(
    workspace.id,
    fileName,
    folderId || null,
  )) as FileRow | null;

  // Initiate resumable session
  const uploadUrl = await driveService.initiateResumableUpload(
    targetDrive.id,
    fileName || '',
    mimeType,
    targetDrive.rootFolderId || 'root',
  );

  // Pipe the hashed stream
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(contentLength) },
    body: pipedStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  if (!response.ok) return c.text('Upload to Google Drive failed', 502);

  // Get Google File ID from response headers / body
  const rawBody = await response.text();
  let gFile: { id?: string; md5Checksum?: string } = {};
  try {
    gFile = JSON.parse(rawBody);
  } catch {
    /* non-JSON Google response */
  }

  // Reject if Google did not return a file ID — prevents corrupt D1 rows
  if (!gFile.id) {
    return c.text('Google Drive did not return a file ID', 502);
  }

  // Get the calculated MD5 hash after the stream has been fully consumed
  const md5Hex = getHash();

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
  if (existingFile) {
    await db.batch([fileRepo.deleteByIdStmt(existingFile.id), insertStmt]);
  } else {
    await insertStmt.run();
  }

  // Delete old Google file after D1 succeeds — best-effort (orphan, not data loss).
  if (existingFile) {
    try {
      await driveService.deleteFile(existingFile.drive_account_id, existingFile.google_file_id);
    } catch (err) {
      logError(c, 'Failed to delete old file from Google Drive (orphaned — not data loss)', err);
    }
  }

  // Update workspace storage usage (atomic quota check — catches TOCTOU race)
  if (contentLength > 0) {
    const policyService = new PolicyService(db, driveService);
    const ok = await policyService.tryReserveQuota(workspace.id, contentLength);
    if (!ok) {
      // Race lost — quota exceeded between check and increment. Delete the
      // uploaded file to avoid orphaning it, then return 403.
      try {
        await driveService.deleteFile(targetDrive.id, gFile.id ?? '');
      } catch {
        // Best-effort — orphan is storage waste, not data corruption
      }
      return xmlError(c, 'QuotaExceeded', 'Storage quota exceeded', 403);
    }
  }

  c.header('ETag', `"${md5Hex}"`);
  return c.text('', 200);
});

// Helper to upload a part
async function handleUploadPart(
  c: Context,
  uploadId: string,
  partNumber: number,
): Promise<Response> {
  const userId = c.get('userId');
  const s3WorkspaceId = c.get('s3WorkspaceId') || null;
  const db = c.env.DB;

  const multipartRepo = new S3MultipartRepository(db);
  const upload = await multipartRepo.findUploadScoped(uploadId, userId, s3WorkspaceId);
  if (!upload) return c.text('Invalid uploadId', 404);

  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  const bodyStream = c.req.raw.body;
  if (!bodyStream) return c.text('Missing part body', 400);

  // Hash part on the fly
  const { stream: hashingStream, getHash } = getMD5HashingStream();
  const pipedStream = bodyStream.pipeThrough(hashingStream);

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

  if (!response.ok) return c.text('Failed uploading part to Google Drive', 502);

  const rawBody = await response.text();
  let gFile: { id?: string; md5Checksum?: string } = {};
  try {
    gFile = JSON.parse(rawBody);
  } catch {
    /* non-JSON Google response */
  }

  const md5Hex = getHash();

  // Reject if Google did not return a file ID — prevents corrupt D1 rows
  // (matches the validation in PUT handler and CompleteMultipart handler).
  if (!gFile.id) {
    return c.text('Google Drive did not return a file ID', 502);
  }

  // Store part state in DB (replace if already exists)
  await multipartRepo.upsertPart({
    uploadId,
    partNumber,
    googleFileId: gFile.id,
    etag: `"${md5Hex}"`,
    size: contentLength,
  });

  c.header('ETag', `"${md5Hex}"`);
  return c.text('', 200);
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

    // Choose target drive
    const driveRepo = new DriveRepository(db);
    const { results: driveRows } = await driveRepo.findAllByUser(userId);
    if (driveRows.length === 0) return c.text('No connected drives', 400);
    const targetDrive = mapDriveRow(driveRows[0]);

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
<InitiateMultipartUploadResult>
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
    if (!upload) return c.text('Upload session not found', 404);

    // Get all parts ordered by part_number
    const { results: parts } = await multipartRepo.findPartsByUpload(uploadId);
    if (parts.length === 0) return c.text('No parts found to complete upload', 400);

    const pathParts = key.split('/');
    const fileName = pathParts.pop() ?? '';
    const folderPath = pathParts.join('/');
    const folderId = await getOrCreateWorkspaceFolder(db, workspace.id, folderPath);

    // Compute total size
    const totalSize = parts.reduce((acc, p) => acc + p.size, 0);

    // Enforce workspace storage quota (mirrors HTTP /api/files/upload/init)
    if (totalSize > 0) {
      const policyService = new PolicyService(db, driveService);
      const hasQuota = await policyService.checkQuota(workspace.id, totalSize);
      if (!hasQuota) {
        return xmlError(c, 'QuotaExceeded', 'Storage quota exceeded', 403);
      }
    }

    // Fetch drive account to get its root folder ID
    const driveRepo = new DriveRepository(db);
    const driveAccount = (await driveRepo.findById(
      upload.drive_account_id,
    )) as DriveAccountRow | null;
    const destFolderId = driveAccount?.root_folder_id || 'root';

    // Initiate final file upload in Google Drive
    // Preserve MIME type from the Initiate request (stored in s3_multipart_uploads.content_type).
    // Google stores this as the file's mimeType via X-Upload-Content-Type header, which
    // affects thumbnail generation and FileIcon display.
    const finalUploadUrl = await driveService.initiateResumableUpload(
      upload.drive_account_id,
      fileName || '',
      upload.content_type ?? 'application/octet-stream',
      destFolderId,
    );

    // Stream concatenate all parts
    // We create a readable stream that pulls parts one-by-one
    let currentPartIndex = 0;
    let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const finalStream = new ReadableStream({
      async pull(controller) {
        // Loop until we enqueue a chunk or exhaust all parts.
        // Replaces the fragile `this.pull(controller)` recursion — `this` is
        // not reliably bound inside ReadableStream pull callbacks (strict mode
        // makes it undefined), so the old code threw TypeError on multi-part
        // uploads as soon as the first part finished streaming.
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

    if (!response.ok) return c.text('Final concatenation failed', 502);

    const rawBody = await response.text();
    let gFile: { id?: string; md5Checksum?: string } = {};
    try {
      gFile = JSON.parse(rawBody);
    } catch {
      /* non-JSON Google response */
    }

    // Reject if Google did not return a file ID — prevents corrupt D1 rows
    if (!gFile.id) {
      return c.text('Google Drive did not return a file ID', 502);
    }

    // Check if file already exists in D1 under the same folder/name/workspace
    const fileRepo = new FileRepository(db);
    const existingFile = (await fileRepo.findByWorkspaceKeyMinimal(
      workspace.id,
      fileName,
      folderId || null,
    )) as FileRow | null;

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
    if (existingFile) {
      await db.batch([fileRepo.deleteByIdStmt(existingFile.id), insertStmt]);
    } else {
      await insertStmt.run();
    }

    // Delete old Google file after D1 succeeds — best-effort (orphan, not data loss).
    if (existingFile) {
      try {
        await driveService.deleteFile(existingFile.drive_account_id, existingFile.google_file_id);
      } catch (err) {
        logError(c, 'Failed to delete old file from Google Drive (orphaned — not data loss)', err);
      }
    }

    // Update workspace storage usage (atomic quota check — catches TOCTOU race)
    if (totalSize > 0) {
      const policyService = new PolicyService(db, driveService);
      const ok = await policyService.tryReserveQuota(workspace.id, totalSize);
      if (!ok) {
        // Race lost — quota exceeded between check and increment. Delete the
        // uploaded file to avoid orphaning it, then return 403.
        try {
          await driveService.deleteFile(upload.drive_account_id, gFile.id ?? '');
        } catch {
          // Best-effort — orphan is storage waste, not data corruption
        }
        return xmlError(c, 'QuotaExceeded', 'Storage quota exceeded', 403);
      }
    }

    // Cleanup: Delete temp parts folder from Google Drive & clean SQLite state
    await driveService.deleteFile(upload.drive_account_id, upload.temp_folder_id);
    const s3LifecycleRepo = new S3LifecycleRepository(db);
    await s3LifecycleRepo.deleteUpload(uploadId);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult>
  <Location>${escapeXml(`http://${c.req.header('Host')}/s3/${bucketName}/${key}`)}</Location>
  <Bucket>${escapeXml(bucketName)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <ETag>"${s3Etag}"</ETag>
</CompleteMultipartUploadResult>`;

    c.header('Content-Type', 'application/xml');
    return c.text(xml);
  }

  return c.text('Invalid query parameter sequence', 400);
});
