// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadModal } from './UploadModal';
import { useDrives } from '../hooks/useDrives';
import type { DriveAccount } from '../types';

// --- Hoisted mocks ---
const { addToast, uploadStoreState, useUploadStoreMock } = vi.hoisted(() => {
  const addToast = vi.fn();
  const state: any = {
    queue: [],
    isUploading: false,
    removeFile: vi.fn(),
    startUpload: vi.fn(),
    clearQueue: vi.fn(),
    addFiles: vi.fn(),
  };
  // Zustand-style hook: callable as fn() OR fn(selector) AND has .getState()
  const fn = vi.fn((selector: any) => (selector ? selector(state) : state));
  (fn as any).getState = () => state;
  return { addToast, uploadStoreState: state, useUploadStoreMock: fn };
});

vi.mock('../stores/useUploadStore', () => ({ useUploadStore: useUploadStoreMock }));

vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn() }));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: () => ({ addToast }),
}));

vi.mock('lucide-react', () => ({
  X: (props: any) => <svg data-testid="x-icon" {...props} />,
  Upload: (props: any) => <svg data-testid="upload-icon" {...props} />,
  FolderUp: (props: any) => <svg data-testid="folder-up-icon" {...props} />,
  FileUp: (props: any) => <svg data-testid="file-up-icon" {...props} />,
  Check: (props: any) => <svg data-testid="check-icon" {...props} />,
  CircleAlert: (props: any) => <svg data-testid="circle-alert-icon" {...props} />,
  LoaderCircle: (props: any) => (
    <svg data-testid="loader-icon" className="animate-spin" {...props} />
  ),
}));

vi.mock('./ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? (
      <div data-testid="dialog">
        <button data-testid="dialog-backdrop" onClick={() => onOpenChange?.(false)} />
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children, icon }: any) => (
    <div>
      {icon}
      {children}
    </div>
  ),
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('./ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
    type,
    variant: _variant,
    'aria-label': ariaLabel,
    ...props
  }: any) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      type={type}
      aria-label={ariaLabel}
      {...props}
    >
      {loading && <span data-testid="button-spinner" />}
      {children}
    </button>
  ),
}));

const drive1: DriveAccount = {
  id: 'drive-1',
  userId: 'user-1',
  googleAccountId: 'g1',
  email: 'one@bar.com',
  name: null,
  type: 'oauth',
  isPrimary: true,
  rootFolderId: null,
  totalQuota: 100,
  usedQuota: 0,
  quotaOverride: null,
  freeSpace: 100,
  usagePercent: 0,
  quotaUpdatedAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const drive2: DriveAccount = {
  ...drive1,
  id: 'drive-2',
  email: 'two@bar.com',
  isPrimary: false,
};

function makeUploadFile(name: string, size = 10): File {
  // File.size is the byte length of the content; respect the requested size
  // by padding the content so formatFileSize renders the expected unit.
  const content = new Array(Math.max(1, size)).fill('x').join('');
  return new File([content], name, { type: 'text/plain' });
}

function resetStoreState() {
  uploadStoreState.queue = [];
  uploadStoreState.isUploading = false;
  uploadStoreState.removeFile = vi.fn();
  uploadStoreState.startUpload = vi.fn().mockResolvedValue(undefined);
  uploadStoreState.clearQueue = vi.fn();
  uploadStoreState.addFiles = vi.fn();
}

describe('UploadModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreState();
    (useDrives as Mock).mockReturnValue({ data: { drives: [drive1, drive2] } });
  });

  afterEach(() => cleanup());

  it('renders the empty upload zone ("Click to select files") when queue is empty', () => {
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText('Click to select files')).toBeTruthy();
    // Hidden file input is present
    expect(document.getElementById('modal-file-upload')).toBeTruthy();
  });

  it('renders file list with name and size when queue has items', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('report.pdf', 1024),
        progress: 0,
        status: 'pending',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('1.0 KB')).toBeTruthy();
  });

  it('renders progress percent for items currently uploading', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('big.bin', 1024 * 1024),
        progress: 50,
        status: 'uploading',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('renders Done-icon for finished items', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('done.txt', 10),
        progress: 100,
        status: 'done',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByTestId('check-icon')).toBeTruthy();
  });

  it('renders Error-icon for failed items', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('failed.txt', 10),
        progress: 0,
        status: 'error',
        error: 'boom',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByTestId('circle-alert-icon')).toBeTruthy();
  });

  it('renders a Remove button for pending items when not uploading', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('removable.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Remove file' })).toBeTruthy();
  });

  it('Remove button calls removeFile with item id', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('removable.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));

    expect(uploadStoreState.removeFile).toHaveBeenCalledWith('u1');
  });

  it('file input change calls useUploadStore.getState().addFiles with the dropped files', () => {
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    const input = document.getElementById('modal-file-upload') as HTMLInputElement;
    const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [fileA] } });

    expect(uploadStoreState.addFiles).toHaveBeenCalledTimes(1);
    const callArg = uploadStoreState.addFiles.mock.calls[0][0];
    expect(Array.isArray(callArg)).toBe(true);
    expect((callArg as File[]).length).toBe(1);
    expect((callArg as File[])[0].name).toBe('a.txt');
  });

  it('file input change does nothing when no files are selected', () => {
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    const input = document.getElementById('modal-file-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    expect(uploadStoreState.addFiles).not.toHaveBeenCalled();
  });

  it('Upload button is disabled when queue is empty', () => {
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Upload' })).toHaveProperty('disabled', true);
  });

  it('clicking Upload triggers startUpload with selected drive id and folder id', async () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    render(
      <UploadModal
        open
        folderId="folder-1"
        driveId="drive-2"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(uploadStoreState.startUpload).toHaveBeenCalledTimes(1);
    });
    // driveId prop is reflected into selectedDriveId state on mount
    expect(uploadStoreState.startUpload).toHaveBeenCalledWith('drive-2', 'folder-1');
  });

  it('emits "Upload completed" success toast when all queue items finish successfully', async () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    // Simulate the post-upload queue state: all done.
    uploadStoreState.startUpload = vi.fn().mockImplementation(async () => {
      uploadStoreState.queue = [
        { id: 'u1', file: makeUploadFile('a.txt', 10), progress: 100, status: 'done' },
      ];
    });
    const onSuccess = vi.fn();
    render(<UploadModal open onClose={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('success', 'Upload completed');
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('emits error toast when all queue items fail', async () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    uploadStoreState.startUpload = vi.fn().mockImplementation(async () => {
      uploadStoreState.queue = [
        { id: 'u1', file: makeUploadFile('a.txt', 10), progress: 0, status: 'error', error: 'x' },
      ];
    });
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'error',
        'Upload failed — 1 file(s) could not be uploaded',
      );
    });
  });

  it('emits mixed-success toast when some succeed and some fail', async () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
      {
        id: 'u2',
        file: makeUploadFile('b.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    uploadStoreState.startUpload = vi.fn().mockImplementation(async () => {
      uploadStoreState.queue = [
        { id: 'u1', file: makeUploadFile('a.txt', 10), progress: 100, status: 'done' },
        {
          id: 'u2',
          file: makeUploadFile('b.txt', 10),
          progress: 0,
          status: 'error',
          error: 'x',
        },
      ];
    });
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('success', '1 file(s) uploaded, 1 failed');
    });
  });

  it('emits error toast when startUpload throws', async () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    uploadStoreState.startUpload = vi.fn().mockRejectedValue(new Error('boom'));
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', 'Upload failed');
    });
  });

  it('Cancel button calls clearQueue + onClose when not uploading', () => {
    const onClose = vi.fn();
    render(<UploadModal open onClose={onClose} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(uploadStoreState.clearQueue).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel button is disabled while uploading', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    uploadStoreState.isUploading = true;
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
  });

  it('renders Done button (in place of Cancel/Upload) when all items are done', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 100,
        status: 'done',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });

  it('Done button calls clearQueue + onClose', () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 100,
        status: 'done',
      },
    ];
    const onClose = vi.fn();
    render(<UploadModal open onClose={onClose} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(uploadStoreState.clearQueue).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders drive selector with auto option + each drive', () => {
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('Auto (most free space)')).toBeTruthy();
    expect(screen.getByText('one@bar.com')).toBeTruthy();
    expect(screen.getByText('two@bar.com')).toBeTruthy();
  });

  it('clicking a drive radio selects that drive, then Upload uses it', async () => {
    uploadStoreState.queue = [
      {
        id: 'u1',
        file: makeUploadFile('a.txt', 10),
        progress: 0,
        status: 'pending',
      },
    ];
    render(<UploadModal open onClose={vi.fn()} onSuccess={vi.fn()} />);

    // drive-1 radio is the second radio (Auto is first)
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(3); // Auto + 2 drives
    fireEvent.click(radios[1]); // drive-1

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(uploadStoreState.startUpload).toHaveBeenCalledWith('drive-1', undefined);
    });
  });

  it('dialog backdrop triggers handleClose (clearQueue + onClose) when not uploading', () => {
    const onClose = vi.fn();
    render(<UploadModal open onClose={onClose} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByTestId('dialog-backdrop'));

    expect(uploadStoreState.clearQueue).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
