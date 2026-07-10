import { describe, it, expect, vi } from 'vitest';
import { GoogleDriveService } from '../src/services/google-drive';

describe('iterateAllFilesAndFolders token refresh', () => {
  it('calls getValidToken on each page so expired tokens refresh mid-sync', async () => {
    const kv = { get: vi.fn(), put: vi.fn() } as never;
    const service = new GoogleDriveService(kv, 'client_id', 'secret');

    const getValidToken = vi
      .fn()
      .mockResolvedValueOnce('token-page-1')
      .mockResolvedValueOnce('token-page-2-refreshed');

    service.getValidToken = getValidToken;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [{ id: '1', mimeType: 'text/plain' }],
          nextPageToken: 'page2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [{ id: '2', mimeType: 'text/plain' }],
          nextPageToken: undefined,
        }),
      });
    global.fetch = fetchMock;

    const iterator = service.iterateAllFilesAndFolders('drive_1');
    const page1 = await iterator.next();
    const page2 = await iterator.next();
    const done = await iterator.next();

    expect(page1.done).toBe(false);
    expect(page2.done).toBe(false);
    expect(done.done).toBe(true);
    expect(getValidToken).toHaveBeenCalledTimes(2);
    expect(getValidToken).toHaveBeenNthCalledWith(1, 'drive_1');
    expect(getValidToken).toHaveBeenNthCalledWith(2, 'drive_1');

    const authHeaders = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(authHeaders[0].Authorization).toBe('Bearer token-page-1');
    expect(authHeaders[1].Authorization).toBe('Bearer token-page-2-refreshed');
  });
});