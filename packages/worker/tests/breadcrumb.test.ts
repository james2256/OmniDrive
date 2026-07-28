import { describe, it, expect } from 'vitest';
import { buildDriveBreadcrumb } from '../src/routes/drives';

describe('buildDriveBreadcrumb', () => {
  it('returns [All Files] when googleFolderId is root', async () => {
    const mockDb = {
      prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results: [] }) }) }),
    };
    const result = await buildDriveBreadcrumb(mockDb as any, 'driveId', 'root');
    expect(result).toEqual([{ id: 'root', name: 'All Files' }]);
  });

  it('prepends All Files and orders nested folders', async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: () =>
            Promise.resolve({
              results: [
                { id: 'folder1-id', name: 'Folder 1' },
                { id: 'folder2-id', name: 'Folder 2' },
              ],
            }),
        }),
      }),
    };
    const result = await buildDriveBreadcrumb(mockDb as any, 'driveId', 'folder2-id');
    expect(result).toEqual([
      { id: 'root', name: 'All Files' },
      { id: 'folder1-id', name: 'Folder 1' },
      { id: 'folder2-id', name: 'Folder 2' },
    ]);
  });
});
