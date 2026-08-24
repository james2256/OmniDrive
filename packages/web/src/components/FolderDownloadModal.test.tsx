// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FolderDownloadModal } from './FolderDownloadModal';
import { fetchDownloadWithRetry } from '../lib/fetchDownloadWithRetry';
import { getStreamMethod, openDownloadStream } from '../lib/streamDownload';

// Re-import the mocked modules so tests can override the mock implementation.
// vi.mock hoists the mock to the top of the file, so these imports get the
// mocked versions (not the real implementations).
const fetchDownloadWithRetryMock = fetchDownloadWithRetry as unknown as Mock;
const getStreamMethodMock = getStreamMethod as unknown as Mock;
const openDownloadStreamMock = openDownloadStream as unknown as Mock;

// Mock asyncPool so tests can control per-file yield order and content
// without depending on real Promise.race timing. The mock drains the items
// array sequentially (concurrency=1 effectively) and calls fn for each item,
// yielding { result, index } in input order. This matches the real asyncPool's
// contract (yields { result: R | null; index: number }) — null means "skip".
vi.mock('../lib/asyncPool', () => ({
  asyncPool: vi
    .fn()
    .mockImplementation(
      <T, R>(
        items: T[],
        _concurrency: number,
        fn: (item: T, index: number) => Promise<R | null>,
        signal?: AbortSignal,
      ) => ({
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < items.length; i++) {
            if (signal?.aborted) return;
            const result = await fn(items[i], i);
            yield { result, index: i };
          }
        },
      }),
    ),
}));

// Mock fetchDownloadWithRetry so tests can control per-file success/failure
// without depending on real fetch + backoff timing. Default returns a fake
// ok Response; individual tests override to return null (skip) or throw.
vi.mock('../lib/fetchDownloadWithRetry', () => ({
  fetchDownloadWithRetry: vi.fn().mockResolvedValue(new Response('file-bytes', { status: 200 })),
}));

// Mock streamDownload so tests can control the write method (native/streamsaver/blob)
// without depending on real browser feature detection. Default returns 'blob'
// so existing tests (which assert createObjectURL + Blob) stay valid.
vi.mock('../lib/streamDownload', () => ({
  getStreamMethod: vi.fn(() => 'blob'),
  openDownloadStream: vi.fn(),
}));

vi.mock('client-zip', () => ({
  // Iterate the async generator so the component's per-file fetch calls
  // actually run (otherwise the generator body never executes and per-file
  // state updates are skipped). The collected items are discarded — the
  // mock's job is to surface React renders between state transitions.
  //
  // Supports both .blob() (legacy path) and .body (streaming path) so the
  // same mock works regardless of which write method getStreamMethod returns.
  downloadZip: vi.fn().mockImplementation((gen: AsyncIterable<unknown>) => {
    // Drain the generator once and cache the result so both .blob() and
    // .body consumers see the same drained sequence.
    const drained = (async () => {
      for await (const _ of gen) {
        // intentionally empty
      }
    })();
    return {
      blob: async () => {
        await drained;
        return new Blob(['zip'], { type: 'application/zip' });
      },
      get body() {
        // Return a ReadableStream that completes (or errors) when the
        // generator drain completes (or rejects, e.g. on AbortError).
        return new ReadableStream({
          start(controller) {
            drained.then(
              () => controller.close(),
              (err) => controller.error(err),
            );
          },
        });
      },
    };
  }),
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

// Helper: build a minimal Response-like object for the download-tree fetch
// (NOT for per-file downloads — those go through fetchDownloadWithRetry mock).
function makeTreeResponse(body: unknown, ok = true, status = 200) {
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
    // Reset fetchDownloadWithRetry to default (ok Response) between tests.
    fetchDownloadWithRetryMock.mockResolvedValue(new Response('file-bytes', { status: 200 }));
    // Reset streamDownload mocks to default (blob method — legacy path).
    getStreamMethodMock.mockReturnValue('blob');
    openDownloadStreamMock.mockReset();
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
      makeTreeResponse({ files: [], rootName: 'MyFolder', truncated: false }),
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
      makeTreeResponse({
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
      makeTreeResponse({
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
    // download-tree returns 2 files; fetchDownloadWithRetry default returns ok.
    fetchMock.mockResolvedValue(
      makeTreeResponse({
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
      makeTreeResponse({
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
    fetchMock.mockResolvedValue(makeTreeResponse('Boom: not found', false, 404));

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
      makeTreeResponse({ files: [], rootName: 'MyFolder', truncated: false }),
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
    // Use a deferred promise to keep the per-file download mid-flight.
    let resolveDownload: (v: unknown) => void = () => {};
    const downloadPromise = new Promise((r) => {
      resolveDownload = r;
    });
    fetchDownloadWithRetryMock.mockReturnValue(downloadPromise);

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    // Wait for the downloading phase text to appear.
    expect(await screen.findByText('Downloading 0 / 1')).toBeTruthy();

    // Let the pipeline finish so cleanup completes cleanly.
    resolveDownload(new Response('body', { status: 200 }));
    await waitFor(() => {
      expect(screen.getByText('Download complete!')).toBeTruthy();
    });
  });

  it('does NOT render the Close button while downloading (shows Cancel instead)', async () => {
    let resolveDownload: (v: unknown) => void = () => {};
    const downloadPromise = new Promise((r) => {
      resolveDownload = r;
    });
    fetchDownloadWithRetryMock.mockReturnValue(downloadPromise);

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    await screen.findByText('Downloading 0 / 1');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    // Cancel button is shown instead during downloading.
    expect(screen.getByRole('button', { name: 'Cancel download' })).toBeTruthy();

    // Let the pipeline finish so cleanup completes cleanly.
    resolveDownload(new Response('body', { status: 200 }));
    await screen.findByText('Download complete!');
  });

  it('clicking the Close button (after completion) calls onClose', async () => {
    const onClose = vi.fn();
    fetchMock.mockResolvedValue(
      makeTreeResponse({
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
    fetchMock.mockResolvedValue(makeTreeResponse('boom', false, 500));

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
    fetchMock.mockResolvedValue(makeTreeResponse('boom', false, 500));

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

  // ─── Phase 1 new tests: retry, skip, cancel ───

  it('skips a file that fails after retries and continues with remaining files (partial status)', async () => {
    // file-1 succeeds, file-2 fails (returns null = skip after retries), file-3 succeeds.
    fetchDownloadWithRetryMock
      .mockResolvedValueOnce(new Response('a', { status: 200 }))
      .mockResolvedValueOnce(null) // file-2 skipped
      .mockResolvedValueOnce(new Response('c', { status: 200 }));

    fetchMock.mockResolvedValue(
      makeTreeResponse({
        files: [
          { id: 'f1', path: 'a.txt', name: 'a.txt', size: 1 },
          { id: 'f2', path: 'b.txt', name: 'b.txt', size: 1 },
          { id: 'f3', path: 'c.txt', name: 'c.txt', size: 1 },
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

    // Should show partial status with 2 of 3 files + 1 failed file.
    expect(await screen.findByText(/Download complete! 2 of 3 files/)).toBeTruthy();
    expect(screen.getByText(/1 file\(s\) failed to download:/)).toBeTruthy();
    expect(screen.getByText(/b.txt/)).toBeTruthy();
    expect(screen.getByText(/Download failed after retries/)).toBeTruthy();
  });

  it('shows "Download complete!" (not partial) when all files succeed', async () => {
    // Default mock returns ok for all files — no partial status.
    fetchMock.mockResolvedValue(
      makeTreeResponse({
        files: [
          { id: 'f1', path: 'a.txt', name: 'a.txt', size: 1 },
          { id: 'f2', path: 'b.txt', name: 'b.txt', size: 1 },
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

    // Plain "Download complete!" without the "X of Y files" suffix.
    expect(await screen.findByText('Download complete!')).toBeTruthy();
    expect(screen.queryByText(/file\(s\) failed to download/)).toBeNull();
  });

  it('Cancel button calls abortRef.current.abort() and sets status to "cancelled"', async () => {
    // Mock fetchDownloadWithRetry to hang until the abort signal fires, then
    // reject with AbortError — mirrors the real fetch() behavior when passed
    // an AbortSignal that gets aborted.
    fetchDownloadWithRetryMock.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise<Response | null>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    await screen.findByText('Downloading 0 / 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));

    // Should show cancelled status with "No file was saved" message.
    expect(await screen.findByText('Download cancelled')).toBeTruthy();
    expect(screen.getByText(/No file was saved/)).toBeTruthy();
  });

  it('cancelled status shows Close button', async () => {
    fetchDownloadWithRetryMock.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise<Response | null>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    await screen.findByText('Downloading 0 / 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    await screen.findByText('Download cancelled');

    // After cancel, the Close button replaces the Cancel button.
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull();
  });

  it('partial status shows Close button', async () => {
    fetchDownloadWithRetryMock.mockResolvedValue(null); // all files skipped

    fetchMock.mockResolvedValue(
      makeTreeResponse({
        files: [{ id: 'f1', path: 'a.txt', name: 'a.txt', size: 1 }],
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

    await screen.findByText(/Download complete! 0 of 1 files/);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  // ─── Phase 2 new tests: streaming write layer (native/streamsaver) ───

  it('uses openDownloadStream and pipeTo when getStreamMethod returns "native"', async () => {
    // Use a real WritableStream (jsdom's ReadableStream.pipeTo validates the
    // argument is a WritableStream instance — a plain object fails validation).
    const writeSpy = vi.fn();
    const realWritable = new WritableStream<Uint8Array>({ write: writeSpy });
    getStreamMethodMock.mockReturnValue('native');
    openDownloadStreamMock.mockResolvedValue({
      writable: realWritable,
      method: 'native',
    });

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    expect(await screen.findByText('Download complete!')).toBeTruthy();
    // openDownloadStream was called with the filename and total size.
    expect(openDownloadStreamMock).toHaveBeenCalledWith('MyFolder.zip', 10);
    // createObjectURL was NOT called (streaming path skips the Blob).
    const createObjectURL = (URL as any).createObjectURL as Mock;
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('uses openDownloadStream when getStreamMethod returns "streamsaver"', async () => {
    const writeSpy = vi.fn();
    const realWritable = new WritableStream<Uint8Array>({ write: writeSpy });
    getStreamMethodMock.mockReturnValue('streamsaver');
    openDownloadStreamMock.mockResolvedValue({
      writable: realWritable,
      method: 'streamsaver',
    });

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    expect(await screen.findByText('Download complete!')).toBeTruthy();
    expect(openDownloadStreamMock).toHaveBeenCalled();
    // createObjectURL was NOT called (streaming path skips the Blob).
    const createObjectURL2 = (URL as any).createObjectURL as Mock;
    expect(createObjectURL2).not.toHaveBeenCalled();
  });

  it('falls back to blob path when openDownloadStream throws (SW blocked)', async () => {
    // getStreamMethod says 'streamsaver' but openDownloadStream throws —
    // the component should fall back to the legacy Blob path.
    getStreamMethodMock.mockReturnValue('streamsaver');
    openDownloadStreamMock.mockRejectedValue(new Error('SW registration failed'));

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    // Should still complete via the Blob fallback path.
    expect(await screen.findByText('Download complete!')).toBeTruthy();
    const createObjectURL = (URL as any).createObjectURL as Mock;
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('cancelled status shows "partial ZIP may be corrupt" when streaming was used', async () => {
    // Streaming path that hangs until aborted — fetchDownloadWithRetry hangs
    // (mirrors real fetch+signal), then AbortController fires and the catch
    // block sets status='cancelled' with the streaming-specific message.
    getStreamMethodMock.mockReturnValue('native');
    fetchDownloadWithRetryMock.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise<Response | null>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const realWritable = new WritableStream<Uint8Array>({ write: () => {} });
    openDownloadStreamMock.mockResolvedValue({
      writable: realWritable,
      method: 'native',
    });

    fetchMock.mockResolvedValue(
      makeTreeResponse({
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

    await screen.findByText('Downloading 0 / 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));

    // Streaming was used → "partial ZIP may be corrupt" message.
    expect(await screen.findByText('Download cancelled')).toBeTruthy();
    expect(screen.getByText(/partial ZIP file on disk may be corrupt/)).toBeTruthy();
    expect(screen.queryByText(/No file was saved/)).toBeNull();
  });

  it('mobile path shows warning when totalSize > 500MB', async () => {
    // getStreamMethod returns 'blob' (mobile) + folder >500MB → warning.
    getStreamMethodMock.mockReturnValue('blob');

    const largeSize = 600 * 1024 * 1024; // 600MB > 500MB threshold
    fetchMock.mockResolvedValue(
      makeTreeResponse({
        files: [{ id: 'f1', path: 'big.mp4', name: 'big.mp4', size: largeSize }],
        rootName: 'LargeFolder',
      }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="LargeFolder"
      />,
    );

    expect(await screen.findByText('Mobile browser limitation')).toBeTruthy();
    expect(screen.getByText(/600\.0 MB/)).toBeTruthy();
    // Footer has both buttons.
    expect(screen.getByRole('button', { name: 'Use desktop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try anyway' })).toBeTruthy();
  });

  it('mobile path proceeds directly (no warning) when totalSize < 500MB', async () => {
    // getStreamMethod returns 'blob' (mobile) + folder <500MB → no warning,
    // proceeds directly to download.
    getStreamMethodMock.mockReturnValue('blob');

    fetchMock.mockResolvedValue(
      makeTreeResponse({
        files: [{ id: 'f1', path: 'small.txt', name: 'small.txt', size: 1024 }],
        rootName: 'SmallFolder',
      }),
    );

    render(
      <FolderDownloadModal
        open
        onClose={vi.fn()}
        driveId="d-1"
        folderId="f-1"
        folderName="SmallFolder"
      />,
    );

    // Should NOT show the mobile warning — proceeds to download complete.
    expect(await screen.findByText('Download complete!')).toBeTruthy();
    expect(screen.queryByText('Mobile browser limitation')).toBeNull();
  });
});
