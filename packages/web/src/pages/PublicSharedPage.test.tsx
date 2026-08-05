// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PublicSharedPage } from './PublicSharedPage';
import { sharedApi } from '../lib/api/shared';
import { useParams } from 'react-router-dom';

vi.mock('../lib/api/shared', () => ({
  sharedApi: {
    getSharedMeta: vi.fn(),
    verifySharedPassword: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(() => ({ id: 'link-abc' })),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('../components/FolderDownloadModal', () => ({
  FolderDownloadModal: ({ open, folderName, sharedLinkId }: any) =>
    open ? (
      <div data-testid="folder-download-modal" data-folder={folderName} data-link={sharedLinkId}>
        FolderDownloadModal
      </div>
    ) : null,
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, loading, ...props }: any) => (
    <button onClick={onClick} disabled={disabled || loading} type={type} {...props}>
      {loading ? 'Loading...' : children}
    </button>
  ),
}));

vi.mock('../components/files/FileIcon', () => ({
  FileIcon: ({ mimeType }: any) => (
    <span data-testid="file-icon" data-mime={mimeType ?? 'unknown'} />
  ),
}));

vi.mock('lucide-react', () => ({
  Lock: () => <svg data-testid="lock-icon" />,
  Download: () => <svg data-testid="download-icon" />,
  CircleAlert: () => <svg data-testid="circle-alert-icon" />,
  LoaderCircle: () => <svg data-testid="loader-icon" />,
  Folder: () => <svg data-testid="folder-icon" />,
}));

describe('PublicSharedPage', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    (useParams as Mock).mockReturnValue({ id: 'link-abc' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  // Helper: stub window.location.href with a setter that records assignments.
  const stubLocationHref = () => {
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        set href(url: string) {
          hrefSetter(url);
        },
        get href() {
          return '';
        },
      },
    });
    return hrefSetter;
  };

  it('renders loading state when fetching link info', () => {
    // Never-resolving promise → page stays in loading state.
    (sharedApi.getSharedMeta as Mock).mockReturnValue(new Promise(() => {}));

    render(<PublicSharedPage />);

    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(sharedApi.getSharedMeta).toHaveBeenCalledWith('link-abc');
  });

  it('renders password gate when link is password-protected', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({ requiresPassword: true });

    render(<PublicSharedPage />);

    expect(await screen.findByText('Password Required')).toBeTruthy();
    expect(screen.getByText('This shared link is protected by a password.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter password')).toBeTruthy();
    expect(screen.getByText('Unlock')).toBeTruthy();
  });

  it('submits password, verifies against API, then re-fetches meta on success', async () => {
    // First call (from useEffect) → password gate.
    // Second call (from handlePasswordSubmit → loadMeta(true)) → file meta.
    (sharedApi.getSharedMeta as Mock)
      .mockResolvedValueOnce({ requiresPassword: true })
      .mockResolvedValueOnce({
        type: 'file',
        target: { name: 'doc.pdf', size: 1024, mimeType: 'application/pdf' },
      });
    (sharedApi.verifySharedPassword as Mock).mockResolvedValue(undefined);

    render(<PublicSharedPage />);

    const input = await screen.findByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'secret123' } });

    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(sharedApi.verifySharedPassword).toHaveBeenCalledWith('link-abc', 'secret123');
    });

    // After verifying, meta reloaded → file download view shown.
    expect(await screen.findByText('doc.pdf')).toBeTruthy();
  });

  it('shows error message for wrong password', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({ requiresPassword: true });
    (sharedApi.verifySharedPassword as Mock).mockRejectedValue(new Error('Invalid password'));

    render(<PublicSharedPage />);

    const input = await screen.findByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'wrong' } });

    fireEvent.click(screen.getByText('Unlock'));

    expect(await screen.findByText('Invalid password')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders file download button for file links', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({
      type: 'file',
      target: { name: 'photo.jpg', size: 2048, mimeType: 'image/jpeg' },
    });

    render(<PublicSharedPage />);

    expect(await screen.findByText('photo.jpg')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByText('Download')).toBeTruthy();
  });

  it('triggers download via window.location.href when Download clicked for file link', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({
      type: 'file',
      target: { name: 'photo.jpg', size: 2048, mimeType: 'image/jpeg' },
    });
    const hrefSetter = stubLocationHref();

    render(<PublicSharedPage />);

    const downloadBtn = await screen.findByText('Download');
    fireEvent.click(downloadBtn);

    // VITE_API_URL is undefined in test env → apiUrl='' → bare path.
    expect(hrefSetter).toHaveBeenCalledWith('/api/shared/link-abc/download');
  });

  it('renders folder browser with contents for folder links', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({
      type: 'folder',
      targetName: 'My Folder',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [
            { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', size: 1024 },
            { id: 'f2', name: 'img.png', mimeType: 'image/png', size: 4096 },
          ],
          folders: [{ id: 'sub1', name: 'Subfolder' }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicSharedPage />);

    expect(await screen.findByText('My Folder')).toBeTruthy();
    expect(screen.getByText('Download All as ZIP')).toBeTruthy();
    expect(await screen.findByText('doc.pdf')).toBeTruthy();
    expect(screen.getByText('img.png')).toBeTruthy();
    expect(screen.getByText('Subfolder')).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledWith('/api/shared/link-abc/folder-contents', {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    });
  });

  it('shows "Loading contents..." while folder contents are being fetched', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({
      type: 'folder',
      targetName: 'My Folder',
    });

    // Never-resolving fetch → loading-contents state stays.
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    render(<PublicSharedPage />);

    expect(await screen.findByText('My Folder')).toBeTruthy();
    expect(screen.getByText('Loading contents...')).toBeTruthy();
  });

  it('shows folder contents error and Retry button when fetch fails, and retries on click', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({
      type: 'folder',
      targetName: 'My Folder',
    });

    // First fetch fails (non-ok), second succeeds with empty folder.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [], folders: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicSharedPage />);

    expect(await screen.findByText('Failed to load folder contents')).toBeTruthy();
    const retryBtn = screen.getByText('Retry');

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    // After retry succeeds with empty folder, the empty message renders.
    expect(await screen.findByText('This folder is empty.')).toBeTruthy();
  });

  it('opens FolderDownloadModal when "Download All as ZIP" clicked for folder link', async () => {
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({
      type: 'folder',
      targetName: 'My Folder',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ files: [], folders: [] }),
      }),
    );

    render(<PublicSharedPage />);

    const downloadAllBtn = await screen.findByText('Download All as ZIP');
    fireEvent.click(downloadAllBtn);

    const modal = screen.getByTestId('folder-download-modal');
    expect(modal).toBeTruthy();
    expect(modal.getAttribute('data-folder')).toBe('My Folder');
    expect(modal.getAttribute('data-link')).toBe('link-abc');
  });

  it('shows error view for expired/invalid link', async () => {
    (sharedApi.getSharedMeta as Mock).mockRejectedValue(new Error('Link expired'));

    render(<PublicSharedPage />);

    expect(await screen.findByText('Error')).toBeTruthy();
    expect(screen.getByText('Link expired')).toBeTruthy();
  });

  it('shows "Invalid link ID" error when id route param is missing', async () => {
    (useParams as Mock).mockReturnValue({ id: undefined });
    (sharedApi.getSharedMeta as Mock).mockResolvedValue({ type: 'file' });

    render(<PublicSharedPage />);

    expect(await screen.findByText('Invalid link ID')).toBeTruthy();
    expect(sharedApi.getSharedMeta).not.toHaveBeenCalled();
  });

  it('uses generic fallback message when error has no message', async () => {
    (sharedApi.getSharedMeta as Mock).mockRejectedValue(new Error(''));

    render(<PublicSharedPage />);

    expect(await screen.findByText('Failed to load shared link')).toBeTruthy();
  });
});
