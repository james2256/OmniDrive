import { create } from 'zustand';
import { filesApi } from '../lib/api/files';
import { ApiError } from '../lib/api/core';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'confirming' | 'done' | 'error' | 'cancelled';
  error?: string;
  abortController?: AbortController;
}

interface UploadState {
  queue: UploadItem[];
  isUploading: boolean;
  showModal: boolean;
  /** Directory paths to ensure (from drag-drop traversal, including empty folders). */
  emptyFolders: string[];
  addFiles: (files: File[]) => void;
  setEmptyFolders: (paths: string[]) => void;
  removeFile: (id: string) => void;
  clearQueue: () => void;
  startUpload: (driveAccountId?: string, parentFolderId?: string) => Promise<void>;
  setShowModal: (show: boolean) => void;
  cancelUpload: (id: string) => void;
}

/**
 * Run async tasks with a bounded concurrency limit. No external deps.
 *
 * Conservative default. Google Drive API enforces per-user rate limits
 * (configurable in Google Cloud Console, not published as a hard number).
 * 3 concurrent uploads × init/proxy/finalize = ~9 requests/second peak,
 * within typical quotas. Client-side uploadChunkWithRetry (core.ts) handles
 * transient 429s with exponential backoff (mirrors worker's withBackoff).
 */
const UPLOAD_CONCURRENCY = 3;

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().then(() => {});
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

export const useUploadStore = create<UploadState>((set, get) => ({
  queue: [],
  isUploading: false,
  showModal: false,
  emptyFolders: [],

  addFiles: (files: File[]) => {
    const items: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'pending',
    }));
    set((state) => ({ queue: [...state.queue, ...items], showModal: true }));
  },

  setEmptyFolders: (paths) => set({ emptyFolders: paths }),

  removeFile: (id: string) => {
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
  },

  clearQueue: () => set({ queue: [], isUploading: false, emptyFolders: [] }),

  cancelUpload: (id: string) => {
    const item = get().queue.find((q) => q.id === id);
    if (item?.abortController) {
      item.abortController.abort();
    }
    set((state) => ({
      queue: state.queue.map((q) => (q.id === id ? { ...q, status: 'cancelled' as const } : q)),
    }));
  },

  startUpload: async (driveAccountId?: string, parentFolderId?: string) => {
    if (get().isUploading) return; // Prevent double-entry on rapid clicks
    set({ isUploading: true });
    const { queue, emptyFolders } = get();

    // Collect all unique directory paths from the queue + emptyFolders.
    // Files carry webkitRelativePath (e.g. "my-project/src/index.ts"); we
    // extract the directory portion. emptyFolders (from drag-drop traversal)
    // includes empty directories that have no files to trigger creation.
    const allDirPaths = new Set<string>();
    for (const item of queue) {
      const relPath = (item.file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (relPath && relPath.includes('/')) {
        const dirPath = relPath.split('/').slice(0, -1).join('/');
        if (dirPath) allDirPaths.add(dirPath);
      }
    }
    for (const p of emptyFolders) allDirPaths.add(p);

    // Single batch call to create all folders (replaces N+1 per-path calls).
    // The server builds a trie, walks it once, and returns path → googleFolderId.
    // Server caps at 15 folder creations per call (D1 + external subrequest
    // budget). Client chunks conservatively; if server returns 400 (budget
    // exceeded), halves the chunk and retries.
    const folderCache = new Map<string, string>(); // dirPath → driveFolderId

    async function ensureFoldersWithRetry(paths: string[], targetDriveId: string): Promise<void> {
      if (paths.length === 0) return;
      try {
        const { folderIds } = await filesApi.ensureFoldersBatch(
          targetDriveId,
          paths,
          parentFolderId,
        );
        for (const [path, id] of Object.entries(folderIds)) {
          folderCache.set(path, id);
        }
      } catch (err) {
        // If subrequest budget exceeded (400) and chunk is splittable, retry with halves.
        if (paths.length > 1 && err instanceof ApiError && err.status === 400) {
          const mid = Math.floor(paths.length / 2);
          await ensureFoldersWithRetry(paths.slice(0, mid), targetDriveId);
          await ensureFoldersWithRetry(paths.slice(mid), targetDriveId);
        } else {
          throw err;
        }
      }
    }

    if (driveAccountId && allDirPaths.size > 0) {
      // Chunk conservatively: 5 paths × ~3 avg depth = ~15 creates (server cap).
      const MAX_PATHS_PER_BATCH = 5;
      const allPaths = [...allDirPaths];
      for (let i = 0; i < allPaths.length; i += MAX_PATHS_PER_BATCH) {
        const chunk = allPaths.slice(i, i + MAX_PATHS_PER_BATCH);
        await ensureFoldersWithRetry(chunk, driveAccountId);
      }
    }

    // Pure cache read — no race possible because all folders are pre-created
    // by the batch call above before any file upload starts.
    const resolveParentForItem = (file: File): string | undefined => {
      const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (!relPath || !relPath.includes('/')) return parentFolderId;
      const dirPath = relPath.split('/').slice(0, -1).join('/');
      if (!dirPath) return parentFolderId;
      return folderCache.get(dirPath) ?? parentFolderId;
    };

    // Build tasks for all pending items, then run with bounded concurrency.
    const tasks = queue
      .filter((item) => item.status === 'pending')
      .map((item) => async () => {
        const abortController = new AbortController();
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === item.id ? { ...q, status: 'uploading' as const, abortController } : q,
          ),
        }));
        try {
          const itemParentId = resolveParentForItem(item.file);

          // 1. Initiate upload — get resumable URL from Worker
          const { uploadUrl, driveAccountId: actualDriveId } = await filesApi.initiateUpload(
            {
              name: item.file.name,
              mimeType: item.file.type || 'application/octet-stream',
              size: item.file.size,
              driveAccountId,
              parentFolderId: itemParentId,
            },
            abortController.signal,
          );

          // 2. Upload via Worker proxy (uploadChunkWithRetry handles 429s)
          const uploadResponse = await filesApi.uploadViaProxy(
            uploadUrl,
            item.file,
            (progress) => {
              set((state) => ({
                queue: state.queue.map((q) => (q.id === item.id ? { ...q, progress } : q)),
              }));
            },
            abortController.signal,
          );

          // 3. Confirm upload with Worker
          set((state) => ({
            queue: state.queue.map((q) =>
              q.id === item.id ? { ...q, status: 'confirming' as const, progress: 100 } : q,
            ),
          }));

          await filesApi.confirmUpload(
            {
              googleFileId: uploadResponse.id,
              driveAccountId: actualDriveId,
              parentFolderId: itemParentId,
            },
            abortController.signal,
          );

          set((state) => ({
            queue: state.queue.map((q) =>
              q.id === item.id ? { ...q, status: 'done' as const } : q,
            ),
          }));
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            set((state) => ({
              queue: state.queue.map((q) =>
                q.id === item.id ? { ...q, status: 'cancelled' as const } : q,
              ),
            }));
            return;
          }
          set((state) => ({
            queue: state.queue.map((q) =>
              q.id === item.id
                ? { ...q, status: 'error' as const, error: (err as Error).message }
                : q,
            ),
          }));
        }
      });

    await runWithConcurrency(tasks, UPLOAD_CONCURRENCY);

    set({ isUploading: false, emptyFolders: [] });
  },

  setShowModal: (show: boolean) => set({ showModal: show }),
}));
