import { create } from 'zustand';
import { api } from '../lib/api';

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

    for (const item of queue) {
      if (item.status !== 'pending') continue;

      try {
        // Update status
        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'uploading' as const } : q)),
        }));

        // 1. Initiate upload — get resumable URL from Worker
        const { uploadUrl, driveAccountId: actualDriveId } = await api.initiateUpload({
          name: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          size: item.file.size,
          driveAccountId,
          parentFolderId,
        });

        // 2. Upload via Worker proxy (bypasses Google CORS restriction)
        const uploadResponse = await api.uploadViaProxy(uploadUrl, item.file, (progress) => {
          set((state) => ({
            queue: state.queue.map((q) => (q.id === item.id ? { ...q, progress } : q)),
          }));
        });

        // 3. Confirm upload with Worker
        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'confirming' as const, progress: 100 } : q)),
        }));

        await api.confirmUpload({
          googleFileId: uploadResponse.id,
          driveAccountId: actualDriveId,
          parentFolderId,
        });

        set((state) => ({
          queue: state.queue.map((q) => (q.id === item.id ? { ...q, status: 'done' as const } : q)),
        }));
      } catch (err) {
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === item.id ? { ...q, status: 'error' as const, error: (err as Error).message } : q
          ),
        }));
      }
    }

    set({ isUploading: false });
  },

  setShowModal: (show: boolean) => set({ showModal: show }),
}));

