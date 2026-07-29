// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useMergedDrive } from './useMergedDrive';
import { useDrives } from './useDrives';
import type { DriveFolder, FileEntry } from '../types';

// Mock useDrives — controls the drives list fan-out input.
vi.mock('./useDrives', () => ({
  useDrives: vi.fn(),
}));

// Mock @tanstack/react-query — useQueries (root fan-out) + useQuery (non-root).
vi.mock('@tanstack/react-query', () => ({
  useQueries: vi.fn(),
  useQuery: vi.fn(),
}));

// Mock drivesApi — only getDriveFolderContents is invoked by the hook.
vi.mock('../lib/api/drives', () => ({
  drivesApi: {
    getDriveFolderContents: vi.fn(),
  },
}));

// Mock query keys — driveFolderContents is the only key used here.
vi.mock('../lib/queryKeys', () => ({
  qk: {
    driveFolder: ['driveFolder'],
    driveFolderContents: (driveId: string, folderId: string) => ['driveFolder', driveId, folderId],
  },
}));

const folder1: DriveFolder = {
  googleFolderId: 'g1',
  name: 'Folder 1',
  isSynced: true,
  driveAccountId: 'd1',
};
const folder2: DriveFolder = {
  googleFolderId: 'g2',
  name: 'Folder 2',
  isSynced: true,
  driveAccountId: 'd2',
};
const file1: FileEntry = {
  id: 'f1',
  userId: 'u1',
  driveAccountId: 'd1',
  googleFileId: 'gf1',
  workspaceId: null,
  workspaceFolderId: null,
  googleParentId: null,
  name: 'file1.txt',
  mimeType: 'text/plain',
  size: 100,
  thumbnailUrl: null,
  webViewLink: null,
  webContentLink: null,
  isTrashed: false,
  googleCreatedAt: null,
  googleModifiedAt: null,
  syncedAt: '2024-01-01',
  lastSyncedAt: null,
  syncStatus: 'idle',
  createdAt: '2024-01-01',
};
const file2: FileEntry = { ...file1, id: 'f2', name: 'file2.txt' };

describe('useMergedDrive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns merged subfolders + files + breadcrumb for root with one drive', () => {
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'a@b.com' }] },
    });
    (useQueries as Mock).mockReturnValue([
      {
        data: { subfolders: [folder1], files: [file1] },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
    ]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('root', null));

    expect(result.current.subfolders).toEqual([folder1]);
    expect(result.current.files).toEqual([file1]);
    expect(result.current.breadcrumb).toEqual([{ id: 'root', name: 'All Files' }]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorDrives.size).toBe(0);
  });

  it('handles empty drives list at root (returns empty data, no loading)', () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [] } });
    (useQueries as Mock).mockReturnValue([]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('root', null));

    expect(result.current.subfolders).toEqual([]);
    expect(result.current.files).toEqual([]);
    expect(result.current.breadcrumb).toEqual([{ id: 'root', name: 'All Files' }]);
    // isLoading = rootQueries.some(q.isLoading) && drives.length > 0 → false when no drives.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorDrives.size).toBe(0);
  });

  it('reports loading state while root queries are loading', () => {
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'a@b.com' }] },
    });
    (useQueries as Mock).mockReturnValue([
      {
        data: undefined,
        isError: false,
        isLoading: true,
        refetch: vi.fn(),
      },
    ]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('root', null));

    expect(result.current.isLoading).toBe(true);
  });

  it('merges subfolders and files from multiple drives at root', () => {
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1' }, { id: 'd2' }] },
    });
    (useQueries as Mock).mockReturnValue([
      {
        data: { subfolders: [folder1], files: [file1] },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
      {
        data: { subfolders: [folder2], files: [file2] },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
    ]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('root', null));

    expect(result.current.subfolders).toEqual([folder1, folder2]);
    expect(result.current.files).toEqual([file1, file2]);
  });

  it('collects errorDrive ids when root queries fail', () => {
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1' }, { id: 'd2' }] },
    });
    (useQueries as Mock).mockReturnValue([
      {
        data: undefined,
        isError: true,
        isLoading: false,
        refetch: vi.fn(),
      },
      {
        data: { subfolders: [folder2], files: [file2] },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
    ]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('root', null));

    expect(result.current.errorDrives.size).toBe(1);
    expect(result.current.errorDrives.has('d1')).toBe(true);
    expect(result.current.errorDrives.has('d2')).toBe(false);
  });

  it('refresh() calls refetch on every root query', () => {
    const refetch1 = vi.fn();
    const refetch2 = vi.fn();
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1' }, { id: 'd2' }] },
    });
    (useQueries as Mock).mockReturnValue([
      {
        data: { subfolders: [], files: [] },
        isError: false,
        isLoading: false,
        refetch: refetch1,
      },
      {
        data: { subfolders: [], files: [] },
        isError: false,
        isLoading: false,
        refetch: refetch2,
      },
    ]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('root', null));

    result.current.refresh();

    expect(refetch1).toHaveBeenCalledTimes(1);
    expect(refetch2).toHaveBeenCalledTimes(1);
  });

  it('returns EMPTY when non-root and driveIdParam is null', () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [{ id: 'd1' }] } });
    (useQueries as Mock).mockReturnValue([]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('folder-123', null));

    expect(result.current.subfolders).toEqual([]);
    expect(result.current.files).toEqual([]);
    expect(result.current.breadcrumb).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorDrives.size).toBe(0);
  });

  it('returns subfolders + files + breadcrumb for non-root with driveIdParam', () => {
    const breadcrumb = [
      { id: 'root', name: 'All Files' },
      { id: 'folder-123', name: 'Sub Folder' },
    ];
    (useDrives as Mock).mockReturnValue({ data: { drives: [{ id: 'd1' }] } });
    (useQueries as Mock).mockReturnValue([]);
    (useQuery as Mock).mockReturnValue({
      data: { subfolders: [folder1], files: [file1], breadcrumb },
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('folder-123', 'd1'));

    expect(result.current.subfolders).toEqual([folder1]);
    expect(result.current.files).toEqual([file1]);
    expect(result.current.breadcrumb).toEqual(breadcrumb);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorDrives.size).toBe(0);
  });

  it('falls back to default breadcrumb when non-root query data is undefined', () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [{ id: 'd1' }] } });
    (useQueries as Mock).mockReturnValue([]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useMergedDrive('folder-123', 'd1'));

    expect(result.current.subfolders).toEqual([]);
    expect(result.current.files).toEqual([]);
    expect(result.current.breadcrumb).toEqual([{ id: 'root', name: 'All Files' }]);
    expect(result.current.isLoading).toBe(true);
  });

  it('refresh() calls refetch on the non-root query', () => {
    const refetch = vi.fn();
    (useDrives as Mock).mockReturnValue({ data: { drives: [{ id: 'd1' }] } });
    (useQueries as Mock).mockReturnValue([]);
    (useQuery as Mock).mockReturnValue({
      data: { subfolders: [], files: [], breadcrumb: [] },
      isLoading: false,
      refetch,
    });

    const { result } = renderHook(() => useMergedDrive('folder-123', 'd1'));

    result.current.refresh();

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('uses drivesApi.getDriveFolderContents as the queryFn for both root + non-root', () => {
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1' }] },
    });
    (useQueries as Mock).mockReturnValue([
      {
        data: undefined,
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
    ]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    renderHook(() => useMergedDrive('root', null));

    // useQueries called with a queries array; each query's queryFn calls drivesApi.
    expect(useQueries).toHaveBeenCalledTimes(1);
    const queriesArg = (useQueries as Mock).mock.calls[0][0].queries;
    expect(queriesArg).toHaveLength(1);
    expect(queriesArg[0].queryKey).toEqual(['driveFolder', 'd1', 'root']);
    expect(queriesArg[0].enabled).toBe(true);
  });

  it('enables non-root useQuery only when driveIdParam is provided', () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [{ id: 'd1' }] } });
    (useQueries as Mock).mockReturnValue([]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    renderHook(() => useMergedDrive('folder-123', 'd1'));

    expect(useQuery).toHaveBeenCalledTimes(1);
    const queryArg = (useQuery as Mock).mock.calls[0][0];
    expect(queryArg.queryKey).toEqual(['driveFolder', 'd1', 'folder-123']);
    expect(queryArg.enabled).toBe(true);
  });
});
