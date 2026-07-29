import { describe, it, expect, vi } from 'vitest';
import { buildDownloadTree } from '../../src/services/download-tree';
import type { GDriveFile, GDriveFolder } from '../../src/services/google-drive';

// buildDownloadTree is pure recursion over `driveService.listFolderContents`
// — no D1, no env. A plain mock driveService (no vi.mock of modules) is enough
// to drive every branch: nested walks, both caps, the per-file filter, and the
// per-folder callback.

/** Build a GDriveFile with only the fields buildDownloadTree reads. */
function file(id: string, name: string, opts: { size?: string; mine?: boolean } = {}): GDriveFile {
  return {
    id,
    name,
    mimeType: 'text/plain',
    size: opts.size ?? '100',
    createdTime: '2026-01-01T00:00:00Z',
    modifiedTime: '2026-01-01T00:00:00Z',
    owners: [{ me: opts.mine ?? true }],
  };
}

function folder(id: string, name: string): GDriveFolder {
  return { id, name, owners: [{ me: true }] };
}

/** A mock driveService whose listFolderContents looks up a folder map. */
function makeDriveService(
  folders: Record<string, { files: GDriveFile[]; folders: GDriveFolder[] }>,
) {
  return {
    listFolderContents: vi.fn(
      async (
        _driveId: string,
        folderId: string,
      ): Promise<{ files: GDriveFile[]; folders: GDriveFolder[] }> => {
        return folders[folderId] ?? { files: [], folders: [] };
      },
    ),
  };
}

describe('buildDownloadTree (integration)', () => {
  // Tree used across tests:
  //   root
  //   ├── a.txt, b.txt
  //   ├── sub1
  //   │   ├── c.txt
  //   │   └── sub1sub
  //   │       └── d.txt
  //   └── sub2  (empty)
  const TREE: Record<string, { files: GDriveFile[]; folders: GDriveFolder[] }> = {
    root: {
      files: [file('a', 'a.txt'), file('b', 'b.txt')],
      folders: [folder('sub1', 'sub1'), folder('sub2', 'sub2')],
    },
    sub1: { files: [file('c', 'c.txt')], folders: [folder('sub1sub', 'sub1sub')] },
    sub1sub: { files: [file('d', 'd.txt')], folders: [] },
    sub2: { files: [], folders: [] },
  };

  it('walks a flat folder (no subfolders) and returns its files', async () => {
    const drive = makeDriveService({
      flat: { files: [file('x', 'x.txt'), file('y', 'y.txt')], folders: [] },
    });
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'flat',
    });
    expect(result.truncated).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((f) => f.name)).toEqual(['x.txt', 'y.txt']);
    // Paths have no folder prefix at the root.
    expect(result.files[0].path).toBe('x.txt');
  });

  it('walks nested folders (depth ≥ 2) and prefixes paths with folder names', async () => {
    const drive = makeDriveService(TREE);
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
    });
    expect(result.truncated).toBe(false);
    const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.name]));
    expect(byPath['a.txt']).toBe('a.txt');
    expect(byPath['b.txt']).toBe('b.txt');
    expect(byPath['sub1/c.txt']).toBe('c.txt');
    expect(byPath['sub1/sub1sub/d.txt']).toBe('d.txt');
    // sub2 is empty — contributes nothing.
    expect(result.files).toHaveLength(4);
  });

  it('truncates at maxFiles and sets truncated=true', async () => {
    const drive = makeDriveService(TREE);
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
      maxFiles: 2,
    });
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(2);
    // The walk collects root files first (a, b) before recursing.
    expect(result.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
  });

  it('truncates at maxApiCalls (one listFolderContents = one call)', async () => {
    const drive = makeDriveService(TREE);
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
      maxApiCalls: 1, // only the root folder is listed
    });
    expect(result.truncated).toBe(true);
    // Only root files (a, b) are returned; sub1/sub2 never visited.
    expect(result.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
    expect(drive.listFolderContents).toHaveBeenCalledTimes(1);
  });

  it('filterFile excludes files (and they do not count toward maxFiles)', async () => {
    const drive = makeDriveService({
      root: {
        // Two files owned by someone else (excluded), one owned by me (kept)
        files: [
          file('shared1', 'shared1.txt', { mine: false }),
          file('shared2', 'shared2.txt', { mine: false }),
          file('mine1', 'mine1.txt', { mine: true }),
        ],
        folders: [],
      },
    });
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
      maxFiles: 2,
      filterFile: (f) => f.owners?.some((o) => o.me) ?? false,
    });
    // Only the owned file counts; non-owned are skipped before maxFiles check.
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('mine1.txt');
    expect(result.truncated).toBe(false);
  });

  it('onFolderListed is invoked once per visited folder with its contents', async () => {
    const drive = makeDriveService(TREE);
    const listed = vi.fn();
    await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
      onFolderListed: listed,
    });
    // root, sub1, sub1sub, sub2 — four folders, each listed once (pre-order).
    expect(listed).toHaveBeenCalledTimes(4);
    const listedIds = listed.mock.calls.map((c) => c[0]);
    expect(listedIds).toContain('root');
    expect(listedIds).toContain('sub1');
    expect(listedIds).toContain('sub1sub');
    expect(listedIds).toContain('sub2');
    // The callback receives the files + folders arrays for that folder.
    const rootCall = listed.mock.calls.find((c) => c[0] === 'root');
    expect(rootCall?.[1]).toHaveLength(2); // a.txt, b.txt
    expect(rootCall?.[2]).toHaveLength(2); // sub1, sub2
  });

  it('onFolderListed is awaited (an async callback completes before the walk continues)', async () => {
    const drive = makeDriveService(TREE);
    const seen: string[] = [];
    await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
      onFolderListed: async (folderId) => {
        // Force a microtask so the await is real.
        await Promise.resolve();
        seen.push(folderId);
      },
    });
    expect(seen).toHaveLength(4);
    expect(seen).toContain('root');
  });

  it('returns an empty file list (truncated=false) for an empty folder', async () => {
    const drive = makeDriveService({ empty: { files: [], folders: [] } });
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'empty',
    });
    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('parses file size as an integer (string → number)', async () => {
    const drive = makeDriveService({
      root: { files: [file('big', 'big.bin', { size: '1048576' })], folders: [] },
    });
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
    });
    expect(result.files[0].size).toBe(1048576);
    expect(typeof result.files[0].size).toBe('number');
  });

  it('treats a missing size as 0', async () => {
    const drive = makeDriveService({
      root: { files: [{ ...file('nosize', 'nosize.txt'), size: undefined }], folders: [] },
    });
    const result = await buildDownloadTree({
      driveService: drive as never,
      driveId: 'd1',
      rootFolderId: 'root',
    });
    expect(result.files[0].size).toBe(0);
  });
});
