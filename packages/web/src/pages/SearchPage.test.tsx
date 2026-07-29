// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SearchPage } from './SearchPage';
import { useDrives } from '../hooks/useDrives';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

// Stable mock refs.
const refetchMock = vi.hoisted(() => vi.fn());
const toggleStarMock = vi.hoisted(() => vi.fn());
const invalidateMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(),
}));
vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn(), useGetDriveInfo: () => vi.fn() }));
vi.mock('../hooks/useSharedLinks', () => ({
  useSharedLinks: vi.fn(() => ({ data: [] })),
  useIsTargetSharedCallback: () => vi.fn(),
}));
vi.mock('../hooks/useFileMutations', () => ({ useToggleStar: () => toggleStarMock }));
vi.mock('../stores/useToastStore', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('../lib/queryKeys', () => ({ qk: { search: (q: string) => ['search', q] } }));
vi.mock('../lib/invalidate', () => ({ invalidateAfterFileMutation: invalidateMock }));

vi.mock('../components/files/FileGrid', () => ({
  FileGrid: ({ files, subfolders, actions }: any) => (
    <div data-testid="file-grid">
      {subfolders.map((f: any) => (
        <div key={f.id} data-testid={`folder-${f.id}`}>
          {f.name}
        </div>
      ))}
      {files.map((f: any) => (
        <div key={f.id} data-testid={`file-${f.id}`}>
          <span>{f.name}</span>
          <button data-testid={`share-${f.id}`} onClick={() => actions.onShare?.(f.id, 'file')}>
            Share
          </button>
          <button data-testid={`move-drive-${f.id}`} onClick={() => actions.onMoveDrive?.(f)}>
            MoveDrive
          </button>
          <button data-testid={`preview-${f.id}`} onClick={() => actions.onPreviewFile?.(f)}>
            Preview
          </button>
          <button
            data-testid={`star-${f.id}`}
            onClick={() => actions.onToggleStar?.(f.id, 'file', f.isStarred)}
          >
            Star
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/ShareModal', () => ({
  ShareModal: ({ open, targetId, targetType }: any) =>
    open ? (
      <div data-testid="share-modal" data-target-id={targetId} data-target-type={targetType}>
        ShareModal
      </div>
    ) : null,
}));

vi.mock('../components/MoveDriveModal', () => ({
  MoveDriveModal: ({ files, onClose, onSuccess }: any) =>
    files.length > 0 ? (
      <div data-testid="move-drive-modal">
        <button data-testid="move-drive-close" onClick={onClose}>
          Close
        </button>
        <button data-testid="move-drive-success" onClick={onSuccess}>
          Success
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/FilePreviewModal', () => ({
  FilePreviewModal: ({ open, file }: any) =>
    open ? (
      <div data-testid="preview-modal" data-file-id={file?.id}>
        Preview
      </div>
    ) : null,
}));

vi.mock('../components/EmptyState', () => ({
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
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

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams('?q=test')]);
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'u@gmail.com' }] },
    });
    (useQuery as Mock).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders search heading with query from URL', () => {
    render(<SearchPage />);
    expect(screen.getByText('Search results for "test"')).toBeTruthy();
  });

  it('renders prompt to enter a search term when no query is present', () => {
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams()]);
    render(<SearchPage />);
    expect(screen.getByText('Please enter a search term.')).toBeTruthy();
  });

  it('renders "Search" heading when query is empty', () => {
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams()]);
    render(<SearchPage />);
    expect(screen.getByText('Search')).toBeTruthy();
  });

  it('renders loading skeleton while searching', () => {
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders error state with retry button when search fails', () => {
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Search failed'),
      refetch: refetchMock,
    });
    render(<SearchPage />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders no-results message when search returns no items', () => {
    (useQuery as Mock).mockReturnValue({
      data: { files: [], folders: [], driveFolders: [] },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    expect(screen.getByText("No results found matching 'test'.")).toBeTruthy();
  });

  it('renders search results (files + drive folders) in the file grid', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        files: [{ id: 'f1', name: 'report.pdf', isStarred: false, mimeType: 'application/pdf' }],
        folders: [],
        driveFolders: [{ id: 'df1', name: 'Drive Folder' }],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    expect(screen.getByTestId('file-grid')).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('Drive Folder')).toBeTruthy();
  });

  it('opens ShareModal with correct target when share button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        files: [{ id: 'f1', name: 'report.pdf', isStarred: false, mimeType: 'application/pdf' }],
        folders: [],
        driveFolders: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    fireEvent.click(screen.getByTestId('share-f1'));
    const modal = screen.getByTestId('share-modal');
    expect(modal.getAttribute('data-target-id')).toBe('f1');
    expect(modal.getAttribute('data-target-type')).toBe('file');
  });

  it('opens MoveDriveModal when move-drive clicked and invalidates on success', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        files: [{ id: 'f1', name: 'report.pdf', isStarred: false, mimeType: 'application/pdf' }],
        folders: [],
        driveFolders: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    fireEvent.click(screen.getByTestId('move-drive-f1'));
    expect(screen.getByTestId('move-drive-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('move-drive-success'));
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('closes MoveDriveModal when close button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        files: [{ id: 'f1', name: 'report.pdf', isStarred: false, mimeType: 'application/pdf' }],
        folders: [],
        driveFolders: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    fireEvent.click(screen.getByTestId('move-drive-f1'));
    fireEvent.click(screen.getByTestId('move-drive-close'));
    expect(screen.queryByTestId('move-drive-modal')).toBeNull();
  });

  it('opens FilePreviewModal with the correct file when preview clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        files: [{ id: 'f1', name: 'report.pdf', isStarred: false, mimeType: 'application/pdf' }],
        folders: [],
        driveFolders: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    fireEvent.click(screen.getByTestId('preview-f1'));
    const modal = screen.getByTestId('preview-modal');
    expect(modal.getAttribute('data-file-id')).toBe('f1');
  });

  it('calls toggleStar with the correct args when star button clicked', () => {
    (useQuery as Mock).mockReturnValue({
      data: {
        files: [{ id: 'f1', name: 'report.pdf', isStarred: false, mimeType: 'application/pdf' }],
        folders: [],
        driveFolders: [],
      },
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    fireEvent.click(screen.getByTestId('star-f1'));
    expect(toggleStarMock).toHaveBeenCalledWith('f1', 'file', false);
  });

  it('does not fetch when query is empty (useQuery disabled)', () => {
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams()]);
    (useQuery as Mock).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SearchPage />);
    // Use the call args to verify enabled: false was passed.
    const callArgs = (useQuery as Mock).mock.calls.at(-1)?.[0] as { enabled?: boolean };
    expect(callArgs.enabled).toBe(false);
  });
});
