import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useUploadStore } from './useUploadStore';
import { filesApi } from '../lib/api/files';

vi.mock('../lib/api/files', () => ({
  filesApi: {
    initiateUpload: vi.fn(),
    uploadViaProxy: vi.fn(),
    confirmUpload: vi.fn(),
  },
}));

const makeFile = (name: string, size = 100): File => {
  const content = new Array(size).fill('x').join('');
  return new File([content], name, { type: 'text/plain' });
};

describe('useUploadStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUploadStore.setState({ queue: [], isUploading: false, showModal: false });
    (filesApi.initiateUpload as Mock).mockResolvedValue({
      uploadUrl: 'http://upload/url',
      driveAccountId: 'd1',
      googleFolderId: 'g1',
    });
    (filesApi.uploadViaProxy as Mock).mockResolvedValue({ id: 'g-file-1' });
    (filesApi.confirmUpload as Mock).mockResolvedValue(undefined);
  });

  it('addFiles adds items to the queue and sets showModal=true', () => {
    useUploadStore.getState().addFiles([makeFile('a.txt'), makeFile('b.txt')]);

    const state = useUploadStore.getState();
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0].file.name).toBe('a.txt');
    expect(state.queue[0].progress).toBe(0);
    expect(state.queue[0].status).toBe('pending');
    expect(state.queue[0].id).toEqual(expect.any(String));
    expect(state.showModal).toBe(true);
  });

  it('addFiles appends to an existing queue', () => {
    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    useUploadStore.getState().addFiles([makeFile('b.txt')]);

    expect(useUploadStore.getState().queue).toHaveLength(2);
    expect(useUploadStore.getState().queue.map((q) => q.file.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('removeFile removes the item by ID', () => {
    useUploadStore.getState().addFiles([makeFile('a.txt'), makeFile('b.txt')]);
    const id = useUploadStore.getState().queue[0].id;

    useUploadStore.getState().removeFile(id);

    expect(useUploadStore.getState().queue).toHaveLength(1);
    expect(useUploadStore.getState().queue[0].file.name).toBe('b.txt');
  });

  it('removeFile is a no-op for an unknown ID', () => {
    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    useUploadStore.getState().removeFile('nonexistent');

    expect(useUploadStore.getState().queue).toHaveLength(1);
  });

  it('clearQueue empties the queue and resets isUploading', () => {
    useUploadStore.setState({
      queue: [{ id: 'x', file: makeFile('a.txt'), progress: 50, status: 'uploading' }],
      isUploading: true,
    });

    useUploadStore.getState().clearQueue();

    expect(useUploadStore.getState().queue).toEqual([]);
    expect(useUploadStore.getState().isUploading).toBe(false);
  });

  it('setShowModal toggles the modal visibility', () => {
    useUploadStore.getState().setShowModal(true);
    expect(useUploadStore.getState().showModal).toBe(true);

    useUploadStore.getState().setShowModal(false);
    expect(useUploadStore.getState().showModal).toBe(false);
  });

  it('startUpload processes the queue: pending → uploading → confirming → done', async () => {
    useUploadStore.getState().addFiles([makeFile('a.txt', 100)]);
    const id = useUploadStore.getState().queue[0].id;

    await useUploadStore.getState().startUpload('d1', 'g1');

    expect(filesApi.initiateUpload).toHaveBeenCalledWith(
      {
        name: 'a.txt',
        mimeType: 'text/plain',
        size: 100,
        driveAccountId: 'd1',
        parentFolderId: 'g1',
      },
      expect.any(AbortSignal),
    );
    expect(filesApi.uploadViaProxy).toHaveBeenCalledWith(
      'http://upload/url',
      expect.any(File),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(filesApi.confirmUpload).toHaveBeenCalledWith(
      {
        googleFileId: 'g-file-1',
        driveAccountId: 'd1',
        parentFolderId: 'g1',
      },
      expect.any(AbortSignal),
    );

    const item = useUploadStore.getState().queue.find((q) => q.id === id);
    expect(item?.status).toBe('done');
    expect(item?.progress).toBe(100);
    expect(useUploadStore.getState().isUploading).toBe(false);
  });

  it('startUpload sets isUploading=true during the run and false after', async () => {
    let resolveInit: (v: {
      uploadUrl: string;
      driveAccountId: string;
      googleFolderId: string;
    }) => void;
    (filesApi.initiateUpload as Mock).mockImplementation(
      () =>
        new Promise((r) => {
          resolveInit = r;
        }),
    );

    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    const startPromise = useUploadStore.getState().startUpload('d1', 'g1');

    // Microtask flush so the action enters the loop + sets isUploading.
    await Promise.resolve();
    expect(useUploadStore.getState().isUploading).toBe(true);

    resolveInit!({
      uploadUrl: 'http://upload/url',
      driveAccountId: 'd1',
      googleFolderId: 'g1',
    });
    await startPromise;

    expect(useUploadStore.getState().isUploading).toBe(false);
  });

  it('progress callback updates the queue item progress', async () => {
    let capturedProgress: ((p: number) => void) | undefined;
    let resolveUpload: (v: { id: string }) => void;
    const uploadDeferred = new Promise<{ id: string }>((r) => {
      resolveUpload = r;
    });

    (filesApi.uploadViaProxy as Mock).mockImplementation(
      async (_url: string, _file: File, onProgress: (p: number) => void) => {
        capturedProgress = onProgress;
        return uploadDeferred;
      },
    );

    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    const id = useUploadStore.getState().queue[0].id;
    const startPromise = useUploadStore.getState().startUpload('d1', 'g1');

    // Let microtasks flush until uploadViaProxy is invoked.
    await vi.waitFor(() => expect(capturedProgress).toBeDefined());

    capturedProgress!(25);
    expect(useUploadStore.getState().queue[0].progress).toBe(25);

    capturedProgress!(75);
    expect(useUploadStore.getState().queue[0].progress).toBe(75);

    resolveUpload!({ id: 'g-file-1' });
    await startPromise;
  });

  it('upload error (initiateUpload rejects) sets status=error and error message', async () => {
    (filesApi.initiateUpload as Mock).mockRejectedValue(new Error('Init failed'));

    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    await useUploadStore.getState().startUpload('d1', 'g1');

    const item = useUploadStore.getState().queue[0];
    expect(item.status).toBe('error');
    expect(item.error).toBe('Init failed');
    expect(useUploadStore.getState().isUploading).toBe(false);
  });

  it('upload error (uploadViaProxy rejects) sets status=error and error message', async () => {
    (filesApi.uploadViaProxy as Mock).mockRejectedValue(new Error('Upload failed'));

    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    await useUploadStore.getState().startUpload('d1', 'g1');

    const item = useUploadStore.getState().queue[0];
    expect(item.status).toBe('error');
    expect(item.error).toBe('Upload failed');
  });

  it('upload error (confirmUpload rejects) sets status=error and error message', async () => {
    (filesApi.confirmUpload as Mock).mockRejectedValue(new Error('Confirm failed'));

    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    await useUploadStore.getState().startUpload('d1', 'g1');

    const item = useUploadStore.getState().queue[0];
    expect(item.status).toBe('error');
    expect(item.error).toBe('Confirm failed');
  });

  it('startUpload skips items that are not pending', async () => {
    useUploadStore.setState({
      queue: [
        {
          id: 'done-item',
          file: makeFile('done.txt'),
          progress: 100,
          status: 'done',
        },
        {
          id: 'error-item',
          file: makeFile('error.txt'),
          progress: 0,
          status: 'error',
          error: 'previous failure',
        },
      ],
    });

    await useUploadStore.getState().startUpload('d1', 'g1');

    expect(filesApi.initiateUpload).not.toHaveBeenCalled();
    expect(filesApi.uploadViaProxy).not.toHaveBeenCalled();
    expect(filesApi.confirmUpload).not.toHaveBeenCalled();
    expect(useUploadStore.getState().isUploading).toBe(false);
  });

  it('startUpload processes multiple files in order', async () => {
    useUploadStore.getState().addFiles([makeFile('a.txt'), makeFile('b.txt')]);
    await useUploadStore.getState().startUpload('d1', 'g1');

    expect(filesApi.initiateUpload).toHaveBeenCalledTimes(2);
    expect(filesApi.uploadViaProxy).toHaveBeenCalledTimes(2);
    expect(filesApi.confirmUpload).toHaveBeenCalledTimes(2);
    expect(useUploadStore.getState().queue.every((q) => q.status === 'done')).toBe(true);
  });

  it('startUpload continues processing remaining items after one fails', async () => {
    (filesApi.uploadViaProxy as Mock)
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce({ id: 'g-file-2' });

    useUploadStore.getState().addFiles([makeFile('a.txt'), makeFile('b.txt')]);
    await useUploadStore.getState().startUpload('d1', 'g1');

    const items = useUploadStore.getState().queue;
    expect(items[0].status).toBe('error');
    expect(items[0].error).toBe('first fails');
    expect(items[1].status).toBe('done');
  });

  it('startUpload with no args passes undefined through to the API', async () => {
    useUploadStore.getState().addFiles([makeFile('a.txt')]);
    await useUploadStore.getState().startUpload();

    expect(filesApi.initiateUpload).toHaveBeenCalledWith(
      {
        name: 'a.txt',
        mimeType: 'text/plain',
        size: 100,
        driveAccountId: undefined,
        parentFolderId: undefined,
      },
      expect.any(AbortSignal),
    );
  });
});
