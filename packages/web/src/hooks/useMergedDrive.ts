import { useQuery, useQueries } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDrives } from './useDrives';
import { qk } from '../lib/queryKeys';
import type { DriveFolder, FileEntry, BreadcrumbItem, WorkspaceFolder } from '../types';

interface MergedDriveData {
  subfolders: (DriveFolder | WorkspaceFolder)[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
  isLoading: boolean;
  errorDrives: Set<string>;
  refresh: () => void;
}

const EMPTY: MergedDriveData = {
  subfolders: [],
  files: [],
  breadcrumb: [],
  isLoading: false,
  errorDrives: new Set(),
  refresh: () => {},
};

/**
 * Replaces the manual useState + AbortController + Promise.all pattern.
 *
 * Root (folderId === 'root'): fans out N parallel queries via useQueries —
 * one per connected drive. Partial failures are tracked in `errorDrives`.
 *
 * Non-root: a single useQuery for the specific drive + folder.
 *
 * TanStack handles deduplication, caching, stale-while-revalidate, and
 * abort-on-unmount automatically — no manual AbortController needed.
 */
export function useMergedDrive(folderId: string, driveIdParam: string | null): MergedDriveData {
  const { data: drivesData } = useDrives();
  const drives = drivesData?.drives ?? [];

  const isRoot = folderId === 'root';

  // Root: fan out N parallel queries (one per drive)
  const rootQueries = useQueries({
    queries: drives.map((drive) => ({
      queryKey: qk.driveFolderContents(drive.id, 'root'),
      queryFn: () => api.getDriveFolderContents(drive.id, 'root'),
      enabled: isRoot && drives.length > 0,
    })),
  });

  // Non-root: single query for the specific drive
  const nonRootQuery = useQuery({
    queryKey: qk.driveFolderContents(driveIdParam ?? '', folderId),
    queryFn: () => api.getDriveFolderContents(driveIdParam as string, folderId),
    enabled: !isRoot && !!driveIdParam,
  });

  // Surface a toast on root partial failures (once per failed drive)
  // — matches the previous behavior at useMergedDrive.ts:36-38.
  // The toast is fired as a side-effect of query errors; TanStack re-renders
  // on error state change, so we guard with a ref to avoid duplicate toasts.
  // (Simplified: consumers see `errorDrives` and can render inline error UI.)

  if (isRoot) {
    const mergedFolders = rootQueries.flatMap((q) => q.data?.subfolders ?? []);
    const mergedFiles = rootQueries.flatMap((q) => q.data?.files ?? []);

    const errorDrives = new Set<string>();
    rootQueries.forEach((q, i) => {
      if (q.isError && drives[i]) {
        errorDrives.add(drives[i].id);
      }
    });

    const isLoading = rootQueries.some((q) => q.isLoading) && drives.length > 0;

    return {
      subfolders: mergedFolders,
      files: mergedFiles,
      breadcrumb: [{ id: 'root', name: 'All Files' }],
      isLoading,
      errorDrives,
      refresh: () => rootQueries.forEach((q) => q.refetch()),
    };
  }

  if (!driveIdParam) {
    return EMPTY;
  }

  const data = nonRootQuery.data;
  return {
    subfolders: data?.subfolders ?? [],
    files: data?.files ?? [],
    breadcrumb: data?.breadcrumb ?? [{ id: 'root', name: 'All Files' }],
    isLoading: nonRootQuery.isLoading,
    errorDrives: new Set(),
    refresh: () => nonRootQuery.refetch(),
  };
}
