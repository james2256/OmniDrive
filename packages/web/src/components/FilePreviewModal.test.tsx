// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FilePreviewModal } from './FilePreviewModal';
import { fetchFilePreviewBlob } from '../lib/api/files';
import type { FileEntry } from '../types';

vi.mock('../lib/api/files', () => ({
  fetchFilePreviewBlob: vi.fn(),
  filesApi: {},
  getFilePreviewUrl: (fileId: string) => `/api/files/${fileId}/preview`,
}));

vi.mock('lucide-react', () => ({
  ExternalLink: (props: any) => <svg data-testid="external-link-icon" {...props} />,
  Download: (props: any) => <svg data-testid="download-icon" {...props} />,
  LoaderCircle: (props: any) => (
    <svg data-testid="loader-icon" className="animate-spin" {...props} />
  ),
}));

vi.mock('./files/FileIcon', () => ({
  FileIcon: ({ mimeType, className }: any) => (
    <span data-testid="file-icon" data-mime={mimeType ?? 'unknown'} className={className} />
  ),
  getFileTypeName: (mimeType: string | null | undefined) => {
    if (!mimeType) return 'File';
    if (mimeType.startsWith('image/')) return 'Image';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.startsWith('text/')) return 'Text';
    return mimeType;
  },
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
  DialogHeader: ({ children, icon, subtitle }: any) => (
    <div>
      {icon}
      {children}
      {subtitle && <div data-testid="dialog-subtitle">{subtitle}</div>}
    </div>
  ),
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children, title }: any) => <h2 title={title}>{children}</h2>,
}));

vi.mock('./ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    asChild,
    variant: _variant,
    loading,
    ...props
  }: any) => {
    // When asChild, render children directly (the <a> inside) so its href is queryable
    if (asChild) return <>{children}</>;
    return (
      <button onClick={onClick} disabled={disabled || loading} type={type} {...props}>
        {loading && <span data-testid="button-spinner" />}
        {children}
      </button>
    );
  },
}));

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'file-1',
    userId: 'user-1',
    driveAccountId: 'drive-1',
    googleFileId: 'g-file-1',
    workspaceId: null,
    workspaceFolderId: null,
    googleParentId: null,
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    thumbnailUrl: null,
    webViewLink: null,
    webContentLink: null,
    isTrashed: false,
    googleCreatedAt: null,
    googleModifiedAt: null,
    syncedAt: '2024-01-01T00:00:00.000Z',
    lastSyncedAt: null,
    syncStatus: 'idle',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FilePreviewModal', () => {
  const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
  const revokeObjectURLMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });
    (fetchFilePreviewBlob as Mock).mockResolvedValue(new Blob(['image bytes']));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders file name and size in the metadata grid', () => {
    const file = makeFile({ name: 'report.pdf', size: 1024, mimeType: 'application/pdf' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('1.0 KB')).toBeTruthy();
  });

  it('renders subtitle from driveEmail when present', () => {
    const file = makeFile({ driveEmail: 'user@drive.com' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.getByTestId('dialog-subtitle').textContent).toBe('user@drive.com');
  });

  it('renders subtitle as "Google Drive" when driveEmail is absent', () => {
    const file = makeFile({ driveEmail: undefined });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.getByTestId('dialog-subtitle').textContent).toBe('Google Drive');
  });

  it('renders image preview by fetching a blob and creating an object URL', async () => {
    const file = makeFile({ mimeType: 'image/jpeg' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    const img = (await screen.findByAltText('photo.jpg')) as HTMLImageElement;
    expect(img.src).toBe('blob:mock-url');
    expect(fetchFilePreviewBlob).toHaveBeenCalledWith('file-1');
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('shows "Loading preview…" while the image blob is fetching', async () => {
    (fetchFilePreviewBlob as Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const file = makeFile({ mimeType: 'image/jpeg' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(await screen.findByText('Loading preview…')).toBeTruthy();
  });

  it('shows "Preview unavailable" when the image fetch fails', async () => {
    (fetchFilePreviewBlob as Mock).mockRejectedValue(new Error('boom'));
    const file = makeFile({ mimeType: 'image/jpeg' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(await screen.findByText('Preview unavailable')).toBeTruthy();
  });

  it('renders Download button when webContentLink is set and not a Google native doc', () => {
    const file = makeFile({
      webContentLink: 'https://drive.google.com/download',
      mimeType: 'application/pdf',
    });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    const downloadLink = screen.getByText('Download').closest('a');
    expect(downloadLink).toBeTruthy();
    expect(downloadLink?.getAttribute('href')).toBe('/api/files/file-1/download');
  });

  it('hides Download button for Google native docs even when webContentLink is set', () => {
    const file = makeFile({
      webContentLink: 'https://drive.google.com/download',
      mimeType: 'application/vnd.google-apps.document',
    });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.queryByText('Download')).toBeNull();
  });

  it('hides Download button when webContentLink is absent', () => {
    const file = makeFile({ webContentLink: null, mimeType: 'application/pdf' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.queryByText('Download')).toBeNull();
  });

  it('renders "Open in Drive" button when webViewLink is set', () => {
    const file = makeFile({
      webViewLink: 'https://drive.google.com/open?id=abc',
      mimeType: 'application/pdf',
    });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    const openLink = screen.getByText('Open in Drive').closest('a');
    expect(openLink).toBeTruthy();
    expect(openLink?.getAttribute('href')).toBe('https://drive.google.com/open?id=abc');
  });

  it('renders PDF preview area (iframe) for PDF mime types', () => {
    const file = makeFile({ mimeType: 'application/pdf' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    // PDFs now render inline — the image preview area is NOT used (no <img>),
    // but the PDF branch shows a loading state then an <iframe>.
    expect(screen.queryByAltText('photo.jpg')).toBeNull();
    // fetchFilePreviewBlob is called for PDFs (the useEffect fetches the blob).
    expect(fetchFilePreviewBlob).toHaveBeenCalledWith('file-1');
    // Metadata grid still renders (default size 2048 → 2.0 KB)
    expect(screen.getByText('2.0 KB')).toBeTruthy();
  });

  it('renders text preview area for text mime types', () => {
    const file = makeFile({ mimeType: 'text/plain' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.queryByAltText('photo.jpg')).toBeNull();
    expect(fetchFilePreviewBlob).toHaveBeenCalledWith('file-1');
  });

  it('renders video preview area for video mime types', () => {
    const file = makeFile({ mimeType: 'video/mp4' });
    render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    expect(screen.queryByAltText('photo.jpg')).toBeNull();
    expect(fetchFilePreviewBlob).toHaveBeenCalledWith('file-1');
  });

  it('does not render body or footer when file is undefined', () => {
    render(<FilePreviewModal open file={undefined} onClose={vi.fn()} />);
    expect(screen.queryByText('Size')).toBeNull();
    expect(screen.queryByText('Open in Drive')).toBeNull();
    expect(screen.queryByText('Download')).toBeNull();
  });

  it('revokes the object URL when the modal is closed or file changes', async () => {
    const file = makeFile({ mimeType: 'image/jpeg' });
    const { rerender } = render(<FilePreviewModal open file={file} onClose={vi.fn()} />);

    await screen.findByAltText('photo.jpg');

    // Closing the modal (file stays, but open=false) triggers the cleanup effect
    rerender(<FilePreviewModal open={false} file={file} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(revokeObjectURLMock).toHaveBeenCalled();
    });
  });

  it('calls onClose when the dialog backdrop is clicked', () => {
    const onClose = vi.fn();
    const file = makeFile({ mimeType: 'application/pdf' });
    render(<FilePreviewModal open file={file} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
