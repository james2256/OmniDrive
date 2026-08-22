// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SharedLinksPage } from './SharedLinksPage';
import { useSharedLinks } from '../hooks/useSharedLinks';

// Stable mock refs.
const refetchMock = vi.hoisted(() => vi.fn());
const revokeMutMock = vi.hoisted(() => vi.fn());
const copyMock = vi.hoisted(() => vi.fn());
const addToastMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSharedLinks', () => ({
  useSharedLinks: vi.fn(),
  useRevokeSharedLink: () => ({ mutate: revokeMutMock, isPending: false }),
}));
vi.mock('../hooks/useClipboard', () => ({
  useClipboard: () => ({ copiedId: null, copy: copyMock, error: '' }),
}));
vi.mock('../stores/useToastStore', () => ({
  useToastStore: () => ({ addToast: addToastMock }),
}));
vi.mock('../lib/utils', () => ({ formatAbsoluteDate: () => 'Jan 1, 2024, 12:00 AM' }));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, loading, ...props }: any) => (
    <button onClick={onClick} disabled={disabled || loading} {...props}>
      {loading ? 'Loading...' : children}
    </button>
  ),
}));

vi.mock('../components/files/FileIcon', () => ({
  FileIcon: ({ mimeType }: any) => (
    <span data-testid="file-icon" data-mime={mimeType ?? 'unknown'} />
  ),
}));

vi.mock('../components/EditShareModal', () => ({
  EditShareModal: ({ open, link }: any) =>
    open ? (
      <div data-testid="edit-share-modal" data-link-id={link?.id}>
        EditShareModal
      </div>
    ) : null,
}));

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
  Link: () => <svg data-testid="link-icon" />,
  Folder: () => <svg data-testid="folder-icon" />,
  Eye: () => <svg data-testid="eye-icon" />,
  Download: () => <svg data-testid="download-icon" />,
  Trash2: () => <svg data-testid="trash-icon" />,
  Copy: () => <svg data-testid="copy-icon" />,
  Check: () => <svg data-testid="check-icon" />,
  Clock: () => <svg data-testid="clock-icon" />,
  Settings: () => <svg data-testid="settings-icon" />,
}));

const sampleLink = {
  id: 'link-1',
  userId: 'u1',
  targetType: 'file',
  targetId: 'f1',
  targetName: 'my-file.pdf',
  targetMimeType: 'application/pdf',
  expiresAt: null,
  viewCount: 12,
  downloadCount: 3,
  createdAt: '2024-01-01T00:00:00Z',
  allowDownloads: true,
  maxDownloads: null,
  webhookUrl: null,
};

describe('SharedLinksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSharedLinks as Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders loading skeleton while shared links are loading', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders error state with retry button when load fails', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('Failed to load shared links'),
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no shared links exist', () => {
    render(<SharedLinksPage />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No active shared links')).toBeTruthy();
  });

  it('renders shared link cards with target name and view/download counts', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [sampleLink],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    expect(screen.getByText('my-file.pdf')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByText('DLs')).toBeTruthy();
    expect(screen.getByText(/Created/)).toBeTruthy();
  });

  it('copies link to clipboard and shows success toast when Copy Link clicked', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [sampleLink],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    // The exact origin (port) is jsdom-dependent — assert only on the path + id.
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock.mock.calls[0][1]).toBe('link-1');
    expect(copyMock.mock.calls[0][0]).toMatch(/\/shared\/link-1$/);
    expect(addToastMock).toHaveBeenCalledWith('success', 'Link copied to clipboard');
  });

  it('opens EditShareModal when settings (Edit Settings) button clicked', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [sampleLink],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    fireEvent.click(screen.getByTitle('Edit Settings'));
    const modal = screen.getByTestId('edit-share-modal');
    expect(modal).toBeTruthy();
    expect(modal.getAttribute('data-link-id')).toBe('link-1');
  });

  it('opens confirm dialog with Stop Sharing title when stop sharing clicked', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [sampleLink],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    fireEvent.click(screen.getByTitle('Stop Sharing'));
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('data-title')).toBe('Stop Sharing');
    expect(dialog.getAttribute('data-message')).toContain('stop sharing');
  });

  it('revokes link via mutation when confirm button clicked', async () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [sampleLink],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    fireEvent.click(screen.getByTitle('Stop Sharing'));
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      expect(revokeMutMock).toHaveBeenCalledWith('link-1');
    });
  });

  it('renders folder icon for folder links and unknown-name fallback for missing targetName', () => {
    (useSharedLinks as Mock).mockReturnValue({
      data: [
        {
          ...sampleLink,
          id: 'link-folder',
          targetType: 'folder',
          targetName: 'My Folder',
        },
        {
          ...sampleLink,
          id: 'link-unknown',
          targetType: 'file',
          targetName: undefined as unknown as string,
        },
      ],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SharedLinksPage />);
    expect(screen.getByText('My Folder')).toBeTruthy();
    expect(screen.getByTestId('folder-icon')).toBeTruthy();
    expect(screen.getByText('Unknown File')).toBeTruthy();
  });
});
