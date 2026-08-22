// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TrashPage } from './TrashPage';
import { useDrives } from '../hooks/useDrives';
import { useQuery } from '@tanstack/react-query';

// Stable mock refs so we can assert calls across renders.
const mocks = vi.hoisted(() => ({
  restoreFile: vi.fn(),
  permanentDeleteFile: vi.fn(),
  permanentDeleteFileAsync: vi.fn(),
  restoreDriveFolder: vi.fn(),
  permanentDeleteDriveFolder: vi.fn(),
  permanentDeleteDriveFolderAsync: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn(), useGetDriveInfo: () => vi.fn() }));
vi.mock('../hooks/useSharedLinks', () => ({
  useSharedLinks: vi.fn(() => ({ data: [] })),
  useIsTargetSharedCallback: () => vi.fn(),
}));
vi.mock('../hooks/useFileMutations', () => ({
  useRestoreFile: () => ({ mutate: mocks.restoreFile }),
  usePermanentDeleteFile: () => ({
    mutate: mocks.permanentDeleteFile,
    mutateAsync: mocks.permanentDeleteFileAsync,
    isPending: false,
  }),
}));
vi.mock('../hooks/useFolderMutations', () => ({
  useRestoreDriveFolder: () => ({ mutate: mocks.restoreDriveFolder }),
  usePermanentDeleteDriveFolder: () => ({
    mutate: mocks.permanentDeleteDriveFolder,
    mutateAsync: mocks.permanentDeleteDriveFolderAsync,
    isPending: false,
  }),
}));
vi.mock('../stores/useToastStore', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/queryKeys', () => ({ qk: { trash: ['trash'] } }));

vi.mock('../components/files/FileGrid', () => ({
  FileGrid: ({ files, subfolders, actions }: any) => (
    <div data-testid="file-grid">
      {subfolders.map((f: any) => (
        <div key={f.id} data-testid={`folder-${f.id}`}>
          <span>{f.name}</span>
          <button
            data-testid={`restore-folder-${f.id}`}
            onClick={() => actions.onRestoreFolder?.(f.driveId, f.id)}
          >
            Restore Folder
          </button>
          <button
            data-testid={`delete-folder-${f.id}`}
            onClick={() => actions.onPermanentDeleteFolder?.(f.driveId, f.id)}
          >
            Delete Folder
          </button>
        </div>
      ))}
      {files.map((f: any) => (
        <div key={f.id} data-testid={`file-${f.id}`}>
          <span>{f.name}</span>
          <button data-testid={`restore-${f.id}`} onClick={() => actions.onRestore?.(f.id)}>
            Restore
          </button>
          <button data-testid={`delete-${f.id}`} onClick={() => actions.onPermanentDelete?.(f.id)}>
            Delete
          </button>
          <button data-testid={`preview-${f.id}`} onClick={() => actions.onPreviewFile?.(f)}>
            Preview
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/layout/BulkActionBar', () => ({ BulkActionBar: () => null }));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, title, message }: any) =>
    open ? (
      <div data-testid="confirm-dialog" data-title={title} data-message={message}>
        <button data-testid="confirm-button" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/FilePreviewModal', () => ({ FilePreviewModal: () => null }));

vi.mock('../components/EmptyState', () => ({
  EmptyState: ({ title, description }: any) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
  ListSkeleton: () => <div data-testid="skeleton">Loading...</div>,
}));

vi.mock('../components/ErrorState', () => ({
  ErrorState: ({ onRetry }: any) => (
    <div data-testid="error-state">
      <button data-testid="retry-button" onClick={onRetry}>
        Retry
      </button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  Trash2: () => <svg data-testid="trash-icon" />,
}));

vi.mock('../components/layout/FilesToolbar', () => ({
  FilesToolbar: () => null,
}));

describe('TrashPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'u@gmail.com' }] },
    });
    (useQuery as Mock).mockReturnValue({
      data: { folder: null, subfolders: [], files: [], breadcrumb: [] },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders loading skeleton while trash is loading', () => {
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders error state with retry button when load fails', () => {
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load trash'),
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when trash has no items', () => {
    render(<TrashPage />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('Trash is empty')).toBeTruthy();
    expect(screen.getByText('Deleted files and folders will appear here.')).toBeTruthy();
  });

  it('renders the trash subtitle without a false 30-day removal claim', () => {
    render(<TrashPage />);
    // The subtitle must NOT promise auto-removal after 30 days — OmniDrive
    // has no trash-empty cron. Only Google Drive's own auto-purge removes
    // trashed items, and only on the next sync after that purge.
    expect(screen.getByText('Deleted files and folders')).toBeTruthy();
    expect(screen.queryByText(/permanently removed after 30 days/)).toBeNull();
  });

  it('renders files and folders in the file grid', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [{ id: 'sf1', name: 'Old Folder', driveId: 'd1' }],
        files: [
          { id: 'f1', name: 'deleted-file.pdf', mimeType: 'application/pdf' },
          { id: 'f2', name: 'old-photo.jpg', mimeType: 'image/jpeg' },
        ],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    expect(screen.getByTestId('file-grid')).toBeTruthy();
    expect(screen.getByText('deleted-file.pdf')).toBeTruthy();
    expect(screen.getByText('old-photo.jpg')).toBeTruthy();
    expect(screen.getByText('Old Folder')).toBeTruthy();
  });

  it('triggers restore mutation when file restore button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    fireEvent.click(screen.getByTestId('restore-f1'));
    expect(mocks.restoreFile).toHaveBeenCalledWith('f1');
  });

  it('opens confirm dialog and permanently deletes a file on confirm', async () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    fireEvent.click(screen.getByTestId('delete-f1'));
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog.getAttribute('data-title')).toBe('Permanently Delete File');
    expect(dialog.getAttribute('data-message')).toContain('cannot be undone');
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      expect(mocks.permanentDeleteFileAsync).toHaveBeenCalledWith('f1');
    });
  });

  it('triggers restore mutation when folder restore button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [{ id: 'sf1', name: 'Old Folder', driveId: 'd1' }],
        files: [],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    fireEvent.click(screen.getByTestId('restore-folder-sf1'));
    expect(mocks.restoreDriveFolder).toHaveBeenCalledWith({ driveId: 'd1', folderId: 'sf1' });
  });

  it('opens confirm dialog and permanently deletes a folder on confirm', async () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [{ id: 'sf1', name: 'Old Folder', driveId: 'd1' }],
        files: [],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    });
    render(<TrashPage />);
    fireEvent.click(screen.getByTestId('delete-folder-sf1'));
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog.getAttribute('data-title')).toBe('Permanently Delete Folder');
    expect(dialog.getAttribute('data-message')).toContain('ALL its contents');
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      expect(mocks.permanentDeleteDriveFolderAsync).toHaveBeenCalledWith({
        driveId: 'd1',
        folderId: 'sf1',
      });
    });
  });
});
