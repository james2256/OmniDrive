import { describe, it, expect } from 'vitest';
import { buildDriveBreadcrumb } from '../src/routes/drives';

describe('buildDriveBreadcrumb', () => {
  it('returns [All Files] when googleFolderId is root', async () => {
    const mockDb = {
      prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results: [] }) }) })
    };
    const result = await buildDriveBreadcrumb(mockDb as any, 'driveId', 'root');
    expect(result).toEqual([{ id: 'root', name: 'All Files' }]);
  });
});
