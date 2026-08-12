import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleDriveService } from '../src/services/google-drive';
import { UpstreamError } from '../src/lib/errors';
import { QUOTA_CACHE_VERSION } from '../src/lib/storage-quota';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

describe('GoogleDriveService methods', () => {
  let service: GoogleDriveService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock D1 — every prepare().bind() returns undefined for first(), ok for run().
    // getValidToken is overridden below, so loadTokens (which uses first()) is
    // never invoked. For getQuota, the cache SELECT returns undefined (cache
    // miss) and the cache UPSERT runs as a no-op.
    const mockDb: any = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue(undefined),
          run: vi.fn().mockResolvedValue(undefined),
          all: vi.fn().mockResolvedValue({ results: [] }),
        })),
      })),
    };
    service = new GoogleDriveService(
      mockDb,
      'client-id',
      'client-secret',
      'test-encryption-key-32-characters',
    );
    // Skip token refresh / D1 token load — every method just uses the fake token.
    service.getValidToken = vi.fn().mockResolvedValue('fake-access-token');

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  // ─── copyFile ───

  describe('copyFile', () => {
    it('POSTs to /files/{id}/copy with empty body when no name provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-id', name: 'copy-name' }),
      });

      const result = await service.copyFile('drive1', 'file1');

      expect(result.id).toBe('new-id');
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1/copy?fields=id,name,mimeType,size,owners(me,displayName,emailAddress),thumbnailLink,` +
          'webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum&supportsAllDrives=true',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer fake-access-token',
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
    });

    it('POSTs to /files/{id}/copy with name in body when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-id', name: 'renamed-copy' }),
      });

      await service.copyFile('drive1', 'file1', 'renamed-copy');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/files/file1/copy?'),
        expect.objectContaining({
          body: JSON.stringify({ name: 'renamed-copy' }),
        }),
      );
    });
  });

  // ─── shareFile ───

  describe('shareFile', () => {
    it('creates a permission with default role=writer + type=user', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'perm-1' }) });

      const permId = await service.shareFile('drive1', 'file1', 'alice@example.com');

      expect(permId).toBe('perm-1');
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1/permissions?sendNotificationEmail=false`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'alice@example.com' }),
        }),
      );
    });

    it('creates a permission with custom role + type when provided', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'perm-2' }) });

      await service.shareFile('drive1', 'file1', 'bob@example.com', 'reader', 'group');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/files/file1/permissions?sendNotificationEmail=false'),
        expect.objectContaining({
          body: JSON.stringify({ role: 'reader', type: 'group', emailAddress: 'bob@example.com' }),
        }),
      );
    });
  });

  // ─── revokeShare ───

  describe('revokeShare', () => {
    it('DELETEs /files/{id}/permissions/{permId}', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await service.revokeShare('drive1', 'file1', 'perm-1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1/permissions/perm-1`,
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });
  });

  // ─── trashFile / trashFolder ───

  describe('trashFile', () => {
    it('PATCHes /files/{id} with { trashed: true }', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await service.trashFile('drive1', 'file1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ trashed: true }),
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });
  });

  describe('trashFolder', () => {
    it('PATCHes /files/{id}?supportsAllDrives=true with { trashed: true }', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await service.trashFolder('drive1', 'folder1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/folder1?supportsAllDrives=true`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ trashed: true }),
        }),
      );
    });
  });

  // ─── untrashFile / untrashFolder ───

  describe('untrashFile', () => {
    it('PATCHes /files/{id} with { trashed: false }', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await service.untrashFile('drive1', 'file1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ trashed: false }),
        }),
      );
    });
  });

  describe('untrashFolder', () => {
    it('PATCHes /files/{id}?supportsAllDrives=true with { trashed: false }', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await service.untrashFolder('drive1', 'folder1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/folder1?supportsAllDrives=true`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ trashed: false }),
        }),
      );
    });
  });

  // ─── deleteFile ───

  describe('deleteFile', () => {
    it('DELETEs /files/{id}', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });

      await service.deleteFile('drive1', 'file1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1`,
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });

    it('treats 404 as success (idempotent delete)', async () => {
      // withBackoff uses the custom isSuccess: r.ok || r.status === 404
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

      await expect(service.deleteFile('drive1', 'file1')).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── createFolder ───

  describe('createFolder', () => {
    it('POSTs to /files with the Google Apps folder mimeType', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'folder-1' }) });

      const folderId = await service.createFolder('drive1', 'My Folder');

      expect(folderId).toBe('folder-1');
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'My Folder',
            mimeType: 'application/vnd.google-apps.folder',
          }),
        }),
      );
    });

    it('includes parents when parentId is provided', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'folder-2' }) });

      await service.createFolder('drive1', 'Subfolder', 'parent-1');

      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files`,
        expect.objectContaining({
          body: JSON.stringify({
            name: 'Subfolder',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['parent-1'],
          }),
        }),
      );
    });
  });

  // ─── initiateResumableUpload ───

  describe('initiateResumableUpload', () => {
    it('POSTs to upload/drive/v3/files and returns the Location header', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ Location: 'https://upload.googleapis.com/session-1' }),
      });

      const url = await service.initiateResumableUpload(
        'drive1',
        'report.pdf',
        'application/pdf',
        'parent-1',
      );

      expect(url).toBe('https://upload.googleapis.com/session-1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer fake-access-token',
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'application/pdf',
          }),
          body: JSON.stringify({ name: 'report.pdf', parents: ['parent-1'] }),
        }),
      );
    });

    it('throws UpstreamError when the Location header is missing', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers() });

      await expect(
        service.initiateResumableUpload('drive1', 'file.txt', 'text/plain', 'parent-1'),
      ).rejects.toThrow(UpstreamError);
    });
  });

  // ─── getFile (getFileMetadata) ───

  describe('getFile', () => {
    it('GETs /files/{id} with the full field projection', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'file1', name: 'doc', mimeType: 'text/plain' }),
      });

      const file = await service.getFile('drive1', 'file1');

      expect(file.id).toBe('file1');
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1?fields=id,name,mimeType,size,owners(me,displayName,emailAddress),thumbnailLink,` +
          'webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum&supportsAllDrives=true',
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });
  });

  // ─── getFileWithParents (metadata + IDOR data in one call) ───

  describe('getFileWithParents', () => {
    it('GETs /files/{id} with id,name,mimeType,parents fields', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'file1',
          name: 'doc',
          mimeType: 'text/plain',
          parents: ['rootFolderId'],
        }),
      });

      const file = await service.getFileWithParents('drive1', 'file1');

      expect(file?.id).toBe('file1');
      expect(file?.name).toBe('doc');
      expect(file?.mimeType).toBe('text/plain');
      expect(file?.parents).toEqual(['rootFolderId']);
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1?fields=id,name,mimeType,parents&supportsAllDrives=true`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });

    it('returns null on 404 (file not found) without throwing', async () => {
      // Regression guard: the isSuccess option treats 404 as success so
      // withBackoff returns the response instead of throwing UpstreamError.
      // Without this, the `if (response.status === 404) return null` check
      // would be dead code and the method would throw on 404.
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
      });

      const file = await service.getFileWithParents('drive1', 'nonexistent');

      expect(file).toBeNull();
    });
  });

  // ─── downloadFile ───

  describe('downloadFile', () => {
    it('GETs /files/{id}?alt=media and returns the stream + no export metadata', async () => {
      const bodyStream = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
          c.close();
        },
      });
      fetchMock.mockResolvedValueOnce({ ok: true, body: bodyStream });

      const result = await service.downloadFile('drive1', 'file1');

      expect(result.stream).toBe(bodyStream);
      expect(result.exportedMimeType).toBeUndefined();
      expect(result.exportedExtension).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1?alt=media`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });

    it('exports Google Docs as PDF via the /export endpoint', async () => {
      const bodyStream = new ReadableStream({
        start(c) {
          c.close();
        },
      });
      fetchMock.mockResolvedValueOnce({ ok: true, body: bodyStream });

      const result = await service.downloadFile(
        'drive1',
        'file1',
        'application/vnd.google-apps.document',
      );

      expect(result.exportedMimeType).toBe('application/pdf');
      expect(result.exportedExtension).toBe('.pdf');
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/files/file1/export?mimeType=application/pdf`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });

    it('exports Google Sheets as XLSX', async () => {
      const bodyStream = new ReadableStream({
        start(c) {
          c.close();
        },
      });
      fetchMock.mockResolvedValueOnce({ ok: true, body: bodyStream });

      const result = await service.downloadFile(
        'drive1',
        'file1',
        'application/vnd.google-apps.spreadsheet',
      );

      expect(result.exportedMimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.exportedExtension).toBe('.xlsx');
    });

    it('throws UpstreamError when response.body is null', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, body: null });

      await expect(service.downloadFile('drive1', 'file1')).rejects.toThrow(UpstreamError);
    });
  });

  // ─── getQuota ───

  describe('getQuota', () => {
    it('GETs /about?fields=storageQuota and parses quota (cache miss)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          storageQuota: { limit: '16106127360', usageInDrive: '1073741824' },
        }),
      });

      const quota = await service.getQuota('drive1');

      expect(quota).toEqual({ total: 16106127360, used: 1073741824, hasLimit: true });
      expect(fetchMock).toHaveBeenCalledWith(
        `${DRIVE_API}/about?fields=storageQuota`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-access-token' },
        }),
      );
    });

    it('falls back to the unlimited ceiling when Google omits storageQuota.limit', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ storageQuota: { usageInDrive: '1024' } }),
      });

      const quota = await service.getQuota('drive1');

      expect(quota.hasLimit).toBe(false);
      expect(quota.total).toBe(1_099_511_627_776); // 1 TiB
      expect(quota.used).toBe(1024);
    });

    it('returns cached quota without hitting Google when the cache is fresh', async () => {
      const cachedPayload = JSON.stringify({
        v: QUOTA_CACHE_VERSION,
        total: 5000,
        used: 500,
        hasLimit: true,
        updatedAt: new Date().toISOString(),
      });
      const cacheDb: any = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue({
              payload: cachedPayload,
              updated_at: Date.now(), // fresh
            }),
            run: vi.fn().mockResolvedValue(undefined),
          })),
        })),
      };
      const cachedService = new GoogleDriveService(
        cacheDb,
        'cid',
        'secret',
        'test-encryption-key-32-characters',
      );
      cachedService.getValidToken = vi.fn().mockResolvedValue('fake-token');
      globalThis.fetch = fetchMock;

      const quota = await cachedService.getQuota('drive1');

      expect(quota).toEqual({ total: 5000, used: 500, hasLimit: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores stale cache and refetches from Google', async () => {
      const stalePayload = JSON.stringify({
        v: QUOTA_CACHE_VERSION,
        total: 9999,
        used: 99,
        hasLimit: true,
        updatedAt: '2020-01-01',
      });
      const staleTime = Date.now() - 10 * 60 * 1000; // 10 min ago, > 5 min TTL
      const staleDb: any = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue({ payload: stalePayload, updated_at: staleTime }),
            run: vi.fn().mockResolvedValue(undefined),
          })),
        })),
      };
      const staleService = new GoogleDriveService(
        staleDb,
        'cid',
        'secret',
        'test-encryption-key-32-characters',
      );
      staleService.getValidToken = vi.fn().mockResolvedValue('fake-token');
      globalThis.fetch = fetchMock;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ storageQuota: { limit: '1000', usageInDrive: '50' } }),
      });

      const quota = await staleService.getQuota('drive1');

      expect(quota).toEqual({ total: 1000, used: 50, hasLimit: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
