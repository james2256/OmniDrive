import { describe, it, expect } from 'vitest';
import { sortFiles, sortFolders } from './sort-items';
import type { FileEntry } from '../types';

const makeFile = (name: string, size: number, modified: string): FileEntry => ({
  id: name,
  userId: 'u1',
  driveAccountId: 'd1',
  googleFileId: name,
  workspaceId: null,
  workspaceFolderId: null,
  googleParentId: 'root',
  name,
  mimeType: 'text/plain',
  size,
  thumbnailUrl: null,
  webViewLink: null,
  webContentLink: null,
  isTrashed: false,
  googleCreatedAt: modified,
  googleModifiedAt: modified,
  syncedAt: modified,
  lastSyncedAt: null,
  syncStatus: 'idle',
  createdAt: modified,
});

describe('sortFiles', () => {
  const files = [
    makeFile('charlie.txt', 300, '2024-03-01T00:00:00Z'),
    makeFile('alpha.txt', 100, '2024-01-01T00:00:00Z'),
    makeFile('bravo.txt', 200, '2024-02-01T00:00:00Z'),
  ];

  it('sorts by name ascending', () => {
    expect(sortFiles(files, 'name', 'asc').map((f) => f.name)).toEqual([
      'alpha.txt',
      'bravo.txt',
      'charlie.txt',
    ]);
  });

  it('sorts by size descending', () => {
    expect(sortFiles(files, 'size', 'desc').map((f) => f.size)).toEqual([300, 200, 100]);
  });

  it('sorts by modified descending', () => {
    expect(sortFiles(files, 'modified', 'desc').map((f) => f.name)).toEqual([
      'charlie.txt',
      'bravo.txt',
      'alpha.txt',
    ]);
  });
});

describe('sortFolders', () => {
  it('sorts folders by name', () => {
    const folders = [{ name: 'Zeta' }, { name: 'Alpha' }, { name: 'Beta' }];
    expect(sortFolders(folders, 'name', 'asc').map((f) => f.name)).toEqual(['Alpha', 'Beta', 'Zeta']);
  });
});