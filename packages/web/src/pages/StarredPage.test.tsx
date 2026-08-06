// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StarredPage } from './StarredPage';
import { useDrives } from '../hooks/useDrives';
import { useQuery } from '@tanstack/react-query';

// Stable mock refs.
const navigateMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const itemModals = vi.hoisted(() => ({
  setPreviewFile: vi.fn(),
  setShareTarget: vi.fn(),
  setMoveDriveFiles: vi.fn(),
  setMoveTarget: vi.fn(),
  setFolderDownloadTarget: vi.fn(),
  setWorkspaceTarget: vi.fn(),
  handleRenameFileRequest: vi.fn(),
  handleRenameFolderRequest: vi.fn(),
  handleDeleteFile: vi.fn(),
  handleDeleteFolder: vi.fn(),
  toggleStar: vi.fn(),
  handleViewInfo: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn(), useGetDriveInfo: () => vi.fn() }));
vi.mock('../hooks/useSharedLinks', () => ({
  useSharedLinks: vi.fn(() => ({ data: [] })),
  useIsTargetSharedCallback: () => vi.fn(),
}));
vi.mock('../hooks/useItemModals', () => ({ useItemModals: () => itemModals }));
vi.mock('../stores/useSelectionStore', () => ({
  useSelectionStore: vi.fn(() => ({ selectedItems: [] })),
}));
vi.mock('../stores/useToastStore', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('../lib/queryKeys', () => ({ qk: { starred: ['starred'] } }));

vi.mock('../components/files/FileGrid', () => ({
  FileGrid: ({ files, subfolders, actions }: any) => (
    <div data-testid="file-grid">
      {subfolders.map((f: any) => (
        <button
          key={f.id}
          data-testid={`folder-${f.id}`}
          onClick={() => actions.onNavigateFolder?.(f.id, f.driveId)}
        >
          {f.name}
        </button>
      ))}
      {files.map((f: any) => (
        <div key={f.id} data-testid={`file-${f.id}`}>
          <span>{f.name}</span>
          <button
            data-testid={`star-${f.id}`}
            onClick={() => actions.onToggleStar?.(f.id, 'file', f.isStarred)}
          >
            Star
          </button>
          <button data-testid={`preview-${f.id}`} onClick={() => actions.onPreviewFile?.(f)}>
            Preview
          </button>
          <button data-testid={`share-${f.id}`} onClick={() => actions.onShare?.(f.id, 'file')}>
            Share
          </button>
          <button
            data-testid={`rename-${f.id}`}
            onClick={() => actions.onRenameFileRequest?.(f.id, f.name)}
          >
            Rename
          </button>
          <button
            data-testid={`delete-${f.id}`}
            onClick={() => actions.onDeleteFile?.(f.id, f.name)}
          >
            Delete
          </button>
          <button data-testid={`move-drive-${f.id}`} onClick={() => actions.onMoveDrive?.(f)}>
            MoveDrive
          </button>
          <button
            data-testid={`move-${f.id}`}
            onClick={() => actions.onMove?.([{ type: 'file', item: f }])}
          >
            Move
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/layout/BulkActionBar', () => ({ BulkActionBar: () => null }));
vi.mock('../components/files/ItemModals', () => ({ ItemModals: () => null }));
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
  Star: () => <svg data-testid="star-icon" />,
}));

vi.mock('../components/layout/FilesToolbar', () => ({
  FilesToolbar: () => null,
}));

describe('StarredPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'u@gmail.com' }] },
    });
    (useQuery as Mock).mockReturnValue({
      data: { folder: null, subfolders: [], files: [], breadcrumb: [] },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders loading skeleton while starred items are loading', () => {
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders error state with retry button when load fails', () => {
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load starred'),
      refetch: refetchMock,
    });
    render(<StarredPage />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no starred items exist', () => {
    render(<StarredPage />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No starred items')).toBeTruthy();
  });

  it('renders starred files and folders in the file grid', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [
          { id: 'ws1', name: 'WS Folder', driveId: 'virtual' },
          { id: 'df1', name: 'Drive Folder', driveId: 'd1' },
        ],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    expect(screen.getByTestId('file-grid')).toBeTruthy();
    expect(screen.getByText('starred.pdf')).toBeTruthy();
    expect(screen.getByText('WS Folder')).toBeTruthy();
    expect(screen.getByText('Drive Folder')).toBeTruthy();
  });

  it('toggles star when star button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('star-f1'));
    expect(itemModals.toggleStar).toHaveBeenCalledWith('f1', 'file', true);
  });

  it('navigates to workspace folder when driveId is virtual', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [{ id: 'ws1', name: 'WS Folder', driveId: 'virtual' }],
        files: [],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('folder-ws1'));
    expect(navigateMock).toHaveBeenCalledWith('/files/ws1');
  });

  it('navigates to external folder when driveId is real', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [{ id: 'df1', name: 'Drive Folder', driveId: 'd1' }],
        files: [],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('folder-df1'));
    expect(navigateMock).toHaveBeenCalledWith('/external/df1?driveId=d1');
  });

  it('opens preview modal when preview button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('preview-f1'));
    expect(itemModals.setPreviewFile).toHaveBeenCalled();
  });

  it('opens share modal when share button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('share-f1'));
    expect(itemModals.setShareTarget).toHaveBeenCalledWith({ id: 'f1', type: 'file' });
  });

  it('triggers rename handler when rename button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('rename-f1'));
    expect(itemModals.handleRenameFileRequest).toHaveBeenCalledWith('f1', 'starred.pdf');
  });

  it('triggers delete handler when delete button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('delete-f1'));
    expect(itemModals.handleDeleteFile).toHaveBeenCalledWith('f1', 'starred.pdf');
  });

  it('triggers move target setter when move button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('move-f1'));
    expect(itemModals.setMoveTarget).toHaveBeenCalled();
  });

  it('triggers move-drive target setter when move-drive button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        folder: null,
        subfolders: [],
        files: [{ id: 'f1', name: 'starred.pdf', isStarred: true, mimeType: 'application/pdf' }],
        breadcrumb: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<StarredPage />);
    fireEvent.click(screen.getByTestId('move-drive-f1'));
    expect(itemModals.setMoveDriveFiles).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'f1' }),
    ]);
  });
});
