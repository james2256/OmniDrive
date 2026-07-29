// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FolderDownloadModal } from './FolderDownloadModal';

vi.mock('client-zip', () => ({
  // Iterate the async generator so the component's per-file fetch calls
  // actually run (otherwise the generator body never executes and per-file
  // state updates are skipped). The collected items are discarded — the
  // mock's job is to surface React renders between state transitions.
  downloadZip: vi.fn().mockImplementation((gen: AsyncIterable<unknown>) => ({
    blob: async () => {
      // Drain the generator to trigger per-file fetches. The `_` is
      // conventionally allowed by no-unused-vars (leading underscore).
      for await (const _ of gen) {
        // intentionally empty
      }
      return new Blob(['zip'], { type: 'application/zip' });
    },
  })),
}));

vi.mock('lucide-react', () => ({
  LoaderCircle: (props: any) => <svg data-testid="loader-icon" {...props} />,
  CheckCircle2: (props: any) => <svg data-testid="check-icon" {...props} />,
  AlertCircle: (props: any) => <svg data-testid="alert-icon" {...props} />,
  Download: (props: any) => <svg data-testid="download-icon" {...props} />,
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
      <div>{children}</div>
    </div>
  ),
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

// Helper: build a minimal Response-like object that the component can consume.
function makeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

describe('FolderDownloadModal', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:fake-url'),
      revokeObjectURL: vi.fn(),
    });
    // Suppress jsdom "Not implemented: navigation to another Document" warnings
    // emitted when the component calls anchor.click() to trigger a download.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders null when open=false', () => {
    render(
      <FolderDownloadModal
        open={false}
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('renders the folder name in the dialog title when open', () => {
    // Suppress the auto-fetch by stubbing fetch with an empty-files response.
    fetchMock.mockResolvedValue(
      makeResponse({ files: [], rootName: 'MyFolder', truncated: false }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    // Source renders: <DialogTitle>Download "MyFolder"</DialogTitle>
    expect(screen.getByText('Download “MyFolder”')).toBeTruthy();
  });

  it('fetches the download-tree endpoint (authenticated mode) when open becomes true', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        files: [{ id: 'file-1', path: 'a.txt', name: 'a.txt', size: 10 }],
        rootName: 'MyFolder',
      }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/drives/d-1/folders/f-1/download-tree', {
        credentials: 'include',
      });
    });
  });

  it('fetches the shared-link download-tree endpoint when sharedLinkId is set', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        files: [{ googleFileId: 'g-1', path: 'a.txt', name: 'a.txt', size: 10 }],
        rootName: 'SharedFolder',
      }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        sharedLinkId="share-1"
        folderName="SharedFolder"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/shared/share-1/download-tree', {
        credentials: 'include',
      });
    });
  });

  it('shows "Preparing file list..." while listing (before fetch resolves)', () => {
    // Never-resolving fetch keeps the listing status active.
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    expect(screen.getByText('Preparing file list...')).toBeTruthy();
  });

  it('shows "Download complete!" after a successful download pipeline', async () => {
    // download-tree returns 2 files; each per-file fetch returns an ok Response.
    fetchMock.mockResolvedValue(
      makeResponse({
        files: [
          { id: 'file-1', path: 'a.txt', name: 'a.txt', size: 10 },
          { id: 'file-2', path: 'b.txt', name: 'b.txt', size: 20 },
        ],
        rootName: 'MyFolder',
      }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    expect(await screen.findByText('Download complete!')).toBeTruthy();
    // downloadZip was called once (with the 2-file async generator).
    const { downloadZip } = await import('client-zip');
    expect(downloadZip as Mock).toHaveBeenCalledTimes(1);
    // URL.createObjectURL was called once with the resulting zip Blob.
    const createObjectURL = (URL as any).createObjectURL as Mock;
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    // URL.revokeObjectURL was called once with the blob: URL.
    expect((URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('triggers the browser download via document.createElement("a") + .click()', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        files: [{ id: 'file-1', path: 'a.txt', name: 'a.txt', size: 10 }],
        rootName: 'MyFolder',
      }),
    );
    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    await waitFor(() => {
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    });
  });

  it('shows error message when the download-tree fetch fails (Res.ok=false)', async () => {
    fetchMock.mockResolvedValue(makeResponse('Boom: not found', false, 404));

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    expect(await screen.findByText('Boom: not found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('shows error message when the download-tree fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('Network down'));

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    expect(await screen.findByText('Network down')).toBeTruthy();
  });

  it('shows "This folder is empty." when download-tree returns no files', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ files: [], rootName: 'MyFolder', truncated: false }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    expect(await screen.findByText('This folder is empty.')).toBeTruthy();
  });

  it('shows "Downloading X / Y" with progress count during the download phase', async () => {
    // Use a deferred promise to keep the per-file download fetch mid-flight.
    let resolveDownload: (v: unknown) => void = () => {};
    const downloadPromise = new Promise((r) => {
      resolveDownload = r;
    });
    let fetchCall = 0;
    fetchMock.mockImplementation(() => {
      fetchCall++;
      if (fetchCall === 1) {
        // First call: download-tree → 1 file.
        return Promise.resolve(
          makeResponse({
            files: [{ id: 'file-1', path: 'a.txt', name: 'a.txt', size: 10 }],
            rootName: 'MyFolder',
          }),
        );
      }
      // Subsequent calls: per-file download → never resolves until we let it.
      return downloadPromise;
    });

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    // Wait for the downloading phase text to appear.
    expect(await screen.findByText('Downloading 0 / 1')).toBeTruthy();

    // Let the pipeline finish so cleanup completes cleanly.
    resolveDownload(makeResponse('body'));
    await waitFor(() => {
      expect(screen.getByText('Download complete!')).toBeTruthy();
    });
  });

  it('does NOT render the Close button while downloading', async () => {
    let resolveDownload: (v: unknown) => void = () => {};
    const downloadPromise = new Promise((r) => {
      resolveDownload = r;
    });
    let fetchCall = 0;
    fetchMock.mockImplementation(() => {
      fetchCall++;
      if (fetchCall === 1) {
        return Promise.resolve(
          makeResponse({
            files: [{ id: 'file-1', path: 'a.txt', name: 'a.txt', size: 10 }],
            rootName: 'MyFolder',
          }),
        );
      }
      return downloadPromise;
    });

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    await screen.findByText('Downloading 0 / 1');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    // Let the pipeline finish so cleanup completes cleanly.
    resolveDownload(makeResponse('body'));
    await screen.findByText('Download complete!');
  });

  it('clicking the Close button (after completion) calls onClose', async () => {
    const onClose = vi.fn();
    fetchMock.mockResolvedValue(
      makeResponse({
        files: [{ id: 'file-1', path: 'a.txt', name: 'a.txt', size: 10 }],
        rootName: 'MyFolder',
      }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={onClose}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    await screen.findByText('Download complete!');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the Close button (after error) calls onClose', async () => {
    const onClose = vi.fn();
    fetchMock.mockResolvedValue(makeResponse('boom', false, 500));

    render(
      <FolderDownloadModal
        open
        onClose={onClose}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    await screen.findByText('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dialog backdrop click calls onClose when status is not "downloading"', async () => {
    const onClose = vi.fn();
    fetchMock.mockResolvedValue(makeResponse('boom', false, 500));

    render(
      <FolderDownloadModal
        open
        onClose={onClose}
        driveId="d-1"
        folderId="f-1"
        folderName="MyFolder"
      />,
    );

    await screen.findByText('boom');
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
