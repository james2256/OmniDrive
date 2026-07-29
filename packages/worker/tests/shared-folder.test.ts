import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFileInSharedFolder } from '../src/lib/shared-folder';
import type { GoogleDriveService } from '../src/services/google-drive';

/** Minimal mock of GoogleDriveService — only getFileParents is touched here. */
function mockDrive(getFileParents: (driveId: string, id: string) => Promise<string[]>): {
  drive: GoogleDriveService;
  calls: { driveId: string; id: string }[];
} {
  const calls: { driveId: string; id: string }[] = [];
  const impl = vi.fn(async (driveId: string, id: string) => {
    calls.push({ driveId, id });
    return getFileParents(driveId, id);
  });
  const drive = { getFileParents: impl } as unknown as GoogleDriveService;
  return { drive, calls };
}

describe('isFileInSharedFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when fileId === rootFolderId (no API call needed)', async () => {
    const { drive, calls } = mockDrive(async () => []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'root', 'root');
    expect(result).toBe(true);
    expect(calls.length).toBe(0); // short-circuit before any parent fetch
  });

  it('returns true when immediate parent is the root folder', async () => {
    const { drive, calls } = mockDrive(async (_d, id) => (id === 'file-1' ? ['root'] : []));
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-1', 'root');
    expect(result).toBe(true);
    expect(calls).toEqual([{ driveId: 'drive-1', id: 'file-1' }]);
  });

  it('walks up multiple parents to find the root', async () => {
    const parents: Record<string, string[]> = {
      'file-3': ['file-2'],
      'file-2': ['file-1'],
      'file-1': ['root'],
      root: [],
    };
    const { drive, calls } = mockDrive(async (_d, id) => parents[id] ?? []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-3', 'root');
    expect(result).toBe(true);
    expect(calls).toEqual([
      { driveId: 'drive-1', id: 'file-3' },
      { driveId: 'drive-1', id: 'file-2' },
      { driveId: 'drive-1', id: 'file-1' },
    ]);
  });

  it('returns false when file has no parents (root-level file outside shared folder)', async () => {
    const { drive, calls } = mockDrive(async () => []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-1', 'root');
    expect(result).toBe(false);
    expect(calls).toEqual([{ driveId: 'drive-1', id: 'file-1' }]);
  });

  it('returns false when the chain leads to a non-root parent that has no parents', async () => {
    const parents: Record<string, string[]> = {
      'file-2': ['file-1'],
      'file-1': [], // dead end, not the shared root
    };
    const { drive, calls } = mockDrive(async (_d, id) => parents[id] ?? []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-2', 'root');
    expect(result).toBe(false);
    expect(calls).toEqual([
      { driveId: 'drive-1', id: 'file-2' },
      { driveId: 'drive-1', id: 'file-1' },
    ]);
  });

  it('returns false when the chain diverges to a different root', async () => {
    const parents: Record<string, string[]> = {
      'file-2': ['other-root'],
      'other-root': [],
    };
    const { drive, calls } = mockDrive(async (_d, id) => parents[id] ?? []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-2', 'root');
    expect(result).toBe(false);
    // Stops at 'other-root' because it has no parents → false
    expect(calls).toEqual([
      { driveId: 'drive-1', id: 'file-2' },
      { driveId: 'drive-1', id: 'other-root' },
    ]);
  });

  it('is cycle-safe when a file is its own parent (visited set breaks the loop)', async () => {
    const parents: Record<string, string[]> = {
      'file-1': ['file-1'], // self-loop
    };
    const { drive, calls } = mockDrive(async (_d, id) => parents[id] ?? []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-1', 'root');
    expect(result).toBe(false);
    // Should only call once — second iteration sees 'file-1' in visited and exits the loop.
    expect(calls).toEqual([{ driveId: 'drive-1', id: 'file-1' }]);
  });

  it('is cycle-safe when two files point to each other', async () => {
    const parents: Record<string, string[]> = {
      'file-1': ['file-2'],
      'file-2': ['file-1'],
    };
    const { drive, calls } = mockDrive(async (_d, id) => parents[id] ?? []);
    const result = await isFileInSharedFolder(drive, 'drive-1', 'file-1', 'root');
    expect(result).toBe(false);
    // Visits file-1, then file-2, then tries file-1 again but it's in visited → exit
    expect(calls).toEqual([
      { driveId: 'drive-1', id: 'file-1' },
      { driveId: 'drive-1', id: 'file-2' },
    ]);
  });

  it('forwards the same driveId to every getFileParents call', async () => {
    const seenDriveIds: string[] = [];
    const { drive } = mockDrive(async (d, _id) => {
      seenDriveIds.push(d);
      return [];
    });
    await isFileInSharedFolder(drive, 'drive-xyz', 'file-1', 'root');
    expect(seenDriveIds.every((d) => d === 'drive-xyz')).toBe(true);
  });
});
