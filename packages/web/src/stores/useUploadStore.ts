import { create } from 'zustand';
import { filesApi } from '../lib/api/files';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'confirming' | 'done' | 'error';
  error?: string;
}

interface UploadState {
  queue: UploadItem[];
  isUploading: boolean;
  showModal: boolean;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearQueue: () => void;
  startUpload: (driveAccountId?: string, parentFolderId?: string) => Promise<void>;
  setShowModal: (show: boolean) => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  queue: [],
  isUploading: false,
  showModal: false,

  addFiles: (files: File[]) => {
    const items: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'pending',
    }));
    set((state) => ({ queue: [...state.queue, ...items], showModal: true }));
  },

  removeFile: (id: string) => {
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
  },

  clearQueue: () => set({ queue: [], isUploading: false }),

  startUpload: async (driveAccountId?: string, parentFolderId?: string) => {
    set({ isUploading: true });
    const { queue } = get();

    // Resolve per-file parentFolderId for folder uploads. When the user drops a
    // folder, the browser sets `webkitRelativePath` on each File (e.g.
    // "projects/src/index.ts"). We group by the directory portion and call
    // `/folders/ensure` once per unique path to create the real Google Drive
    // folder hierarchy, then use the returned leaf folder ID as the
    // `parentFolderId` for each file inside that path.
    const folderCache = new Map<string, string>(); // dirPath → driveFolderId
    const resolveParentForItem = async (file: File): Promise<string | undefined> => {
      const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (!relPath || !relPath.includes('/')) return parentFolderId;
      const dirPath = relPath.split('/').slice(0, -1).join('/');
      if (!dirPath) return parentFolderId;

      const cached = folderCache.get(dirPath);
      if (cached) return cached;

      // Ensure the folder path exists on the target drive. The drive must be
      // known (selected or auto-resolved) — folder upload requires a concrete
      // drive because the folder hierarchy is created on one specific drive.
      const targetDriveId = driveAccountId;
      if (!targetDriveId) {
        // Can't ensure folders without a selected drive — fall back to flat
        // upload into the current parent. The user will see files land flat.
        return parentFolderId;
      }
      const { googleFolderId } = await filesApi.ensureFolder(
        targetDriveId,
        dirPath,
        parentFolderId,
      );
      folderCache.set(dirPath, googleFolderId);
      return googleFolderId;
    };

    for (const item of queue) {
      if (item.status !== 'pending') continue;

      try {
        // Resolve this file's parent folder (flat or nested).
        const itemParentId = await resolveParentForItem(item.file);

        // Update status
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === item.id ? { ...q, status: 'uploading' as const } : q,
          ),
        }));

        // 1. Initiate upload — get resumable URL from Worker
        const { uploadUrl, driveAccountId: actualDriveId } = await filesApi.initiateUpload({
          name: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          size: item.file.size,
          driveAccountId,
          parentFolderId: itemParentId,
        });

        // 2. Upload via Worker proxy (bypasses Google CORS restriction)
        const uploadResponse = await filesApi.uploadViaProxy(uploadUrl, item.file, (progress) => {
          set((state) => ({
            queue: state.queue.map((q) => (q.id === item.id ? { ...q, progress } : q)),
          }));
        });

        // 3. Confirm upload with Worker
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === item.id ? { ...q, status: 'confirming' as const, progress: 100 } : q,
          ),
        }));

        await filesApi.confirmUpload({
          googleFileId: uploadResponse.id,
          driveAccountId: actualDriveId,
          parentFolderId: itemParentId,
        });

        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'done' as const } : q)),
        }));
      } catch (err) {
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === item.id
              ? { ...q, status: 'error' as const, error: (err as Error).message }
              : q,
          ),
        }));
      }
    }

    set({ isUploading: false });
  },

  setShowModal: (show: boolean) => set({ showModal: show }),
}));
