import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/Button';
import { LoaderCircle, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { downloadZip } from 'client-zip';
import { asyncPool } from '../lib/asyncPool';
import { fetchDownloadWithRetry } from '../lib/fetchDownloadWithRetry';
import { getStreamMethod, openDownloadStream } from '../lib/streamDownload';
import { createProgressStream } from '../lib/progressStream';

interface FolderDownloadModalProps {
  open: boolean;
  onClose: () => void;
  // Authenticated mode:
  driveId?: string;
  folderId?: string;
  // Shared-link mode:
  sharedLinkId?: string;
  // Common:
  folderName: string;
}

interface TreeFile {
  id?: string; // D1 row ID (authenticated mode)
  googleFileId?: string; // Google file ID (shared-link mode)
  path: string;
  name: string;
  size: number;
}

type Status =
  | 'listing'
  | 'downloading'
  | 'done'
  | 'partial' // download completed but some files failed (skipped)
  | 'cancelled' // user clicked Cancel
  | 'mobile-warning' // mobile + folder >500MB — needs user confirmation
  | 'mobile-partial' // mobile "Try anyway" completed but truncated to 500MB limit
  | 'mobile-too-large' // mobile + first file exceeds 500MB — cannot download at all
  | 'error';

interface FailedFile {
  name: string;
  error: string;
}

interface DownloadTreeData {
  files: TreeFile[];
  rootName: string;
  truncated?: boolean;
}

/** Mobile Blob path memory ceiling (~500MB on iOS Safari). */
const MOBILE_BLOB_LIMIT = 500 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Truncate the file list to fit within the mobile Blob memory limit.
 * Returns the subset of files whose cumulative size stays under the cap,
 * preserving input order (alphabetical from download-tree).
 *
 * Returns an empty array if even the first file exceeds the limit — the
 * caller shows the 'mobile-too-large' status in that case.
 */
function truncateForMobile(files: TreeFile[], limit: number): TreeFile[] {
  const result: TreeFile[] = [];
  let cumulative = 0;
  for (const file of files) {
    if (cumulative + file.size > limit) break;
    cumulative += file.size;
    result.push(file);
  }
  return result;
}

export function FolderDownloadModal({
  open,
  onClose,
  driveId,
  folderId,
  sharedLinkId,
  folderName,
}: FolderDownloadModalProps) {
  const [status, setStatus] = useState<Status>('listing');
  const [progress, setProgress] = useState({ current: 0, total: 0, currentName: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [failedFiles, setFailedFiles] = useState<FailedFile[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  // True when the streaming write path (native/streamsaver) was used — the
  // cancel warning differs: streaming leaves a partial file on disk; the
  // legacy Blob path discards everything in RAM.
  const [streamingUsed, setStreamingUsed] = useState(false);
  // Original file count before mobile truncation — used in 'mobile-partial'
  // status to show "X of Y files" (progress.total is the truncated count).
  const [originalFileCount, setOriginalFileCount] = useState(0);
  // Bytes written to disk so far (streaming path only). Updated via
  // createProgressStream TransformStream, throttled to 250ms.
  const [bytesWritten, setBytesWritten] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // runDownload runs the full pipeline: asyncPool → downloadZip → write.
  // Extracted so the mobile-warning "Try anyway" button can invoke it after
  // user confirmation. The tree data and totalSize are passed as parameters
  // (not read from state) because React state updates are async — reading
  // totalSize from state inside this closure would return the stale value
  // from the render when the effect was created (always 0 on first run).
  const runDownload = async (data: DownloadTreeData, size: number, signal: AbortSignal) => {
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const failedFilesRef: FailedFile[] = [];
    let downloaded = 0;

    setProgress({
      current: 0,
      total: data.files.length,
      currentName: data.files[0]?.name ?? '',
    });
    setBytesWritten(0);

    const responses = (async function* () {
      for await (const { result, index } of asyncPool(
        data.files,
        3,
        (file) => {
          const downloadUrl = sharedLinkId
            ? `${apiUrl}/api/shared/${sharedLinkId}/download?fileId=${file.googleFileId}`
            : `${apiUrl}/api/files/${file.id}/download`;
          return fetchDownloadWithRetry(downloadUrl, { credentials: 'include', signal });
        },
        signal,
      )) {
        if (signal.aborted) return;
        const file = data.files[index];
        if (result) {
          yield { name: file.path, input: result, lastModified: new Date() };
        } else {
          failedFilesRef.push({ name: file.name, error: 'Download failed after retries' });
        }
        downloaded++;
        setProgress({
          current: downloaded,
          total: data.files.length,
          currentName: file.name,
        });
      }
    })();

    // Open write stream (3-tier: native → StreamSaver → Blob).
    // For native (Chrome/Edge), this MUST happen within 5s of the click —
    // handled by the caller calling this immediately on click.
    const method = getStreamMethod();
    let writable: WritableStream<Uint8Array> | null = null;
    let usedStreaming = false;
    if (method !== 'blob') {
      try {
        const handle = await openDownloadStream(`${data.rootName}.zip`, size);
        writable = handle.writable;
        usedStreaming = true;
      } catch (err) {
        // User cancelled the native Save As dialog (AbortError) → abort everything.
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }
        // StreamSaver failed (e.g., SW blocked by corporate firewall) —
        // fall through to legacy Blob path.
      }
    }
    setStreamingUsed(usedStreaming);

    const zipResponse = downloadZip(responses);
    if (writable) {
      // Streaming path — chunks flow to disk via SW or FileSystemWritableFileStream.
      // No Blob, no memory cap. The Response from downloadZip always has a body
      // (ReadableStream) — guard for type safety, but it's never null in practice.
      const zipStream = zipResponse.body;
      if (!zipStream) {
        throw new Error('client-zip did not produce a ReadableStream body');
      }
      // Insert a TransformStream to count bytes for progress UI (desktop only).
      // Mobile Blob path has no stream to insert into — keeps file-count progress.
      const progressStream = createProgressStream(size, (written) => setBytesWritten(written));
      await zipStream.pipeThrough(progressStream).pipeTo(writable);
    } else {
      // Legacy Blob path (mobile / streaming unsupported) — entire ZIP in RAM.
      const zipBlob = await zipResponse.blob();
      const blobUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${data.rootName}.zip`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    }

    // Sync failedFiles ref → state, then set final status.
    setFailedFiles(failedFilesRef);
    if (failedFilesRef.length > 0) {
      setStatus('partial');
    } else {
      setStatus('done');
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    (async () => {
      try {
        // 1. Get file tree from the appropriate endpoint
        const url = sharedLinkId
          ? `/api/shared/${sharedLinkId}/download-tree`
          : `/api/drives/${driveId}/folders/${folderId}/download-tree`;

        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as DownloadTreeData;

        if (cancelled) return;
        if (data.files.length === 0) {
          setStatus('error');
          setErrorMsg('This folder is empty.');
          return;
        }
        setTruncated(data.truncated === true);

        const size = data.files.reduce((sum, f) => sum + f.size, 0);
        setTotalSize(size);

        // 2. Mobile large-folder guard — mobile can't stream, so >500MB would
        // crash the tab silently. Show an upfront warning instead.
        const method = getStreamMethod();
        if (method === 'blob' && size > MOBILE_BLOB_LIMIT) {
          setStatus('mobile-warning');
          return; // Wait for user to click "Try anyway" or "Use desktop".
        }

        // 3. Run the download pipeline (streaming or blob).
        setStatus('downloading');
        await runDownload(data, size, signal);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))) {
          setStatus('cancelled');
          return;
        }
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Download failed');
      }
    })();

    return () => {
      cancelled = true;
      // Abort all in-flight fetches on unmount/close — prevents orphaned
      // network requests from completing after the modal is gone.
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driveId, folderId, sharedLinkId]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  // "Try anyway" — invoked from the mobile-warning footer. Truncates the file
  // list to fit MOBILE_BLOB_LIMIT, then runs the legacy Blob path (getStreamMethod
  // already returned 'blob', so runDownload will skip the streaming branch).
  // Without truncation, a >500MB folder would crash iOS Safari silently.
  const handleTryAnyway = async () => {
    if (!abortRef.current) return;
    const { signal } = abortRef.current;
    try {
      // Re-fetch the tree (the original closure's data is stale by now if
      // the user waited — but in practice the warning appears instantly).
      const url = sharedLinkId
        ? `/api/shared/${sharedLinkId}/download-tree`
        : `/api/drives/${driveId}/folders/${folderId}/download-tree`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as DownloadTreeData;
      setOriginalFileCount(data.files.length);

      // Edge case: single file exceeds mobile limit — can't download at all.
      if (data.files.length > 0 && data.files[0].size > MOBILE_BLOB_LIMIT) {
        setStatus('mobile-too-large');
        return;
      }

      // Truncate to mobile limit — prevents iOS Safari OOM crash.
      const truncatedFiles = truncateForMobile(data.files, MOBILE_BLOB_LIMIT);
      const mobileData: DownloadTreeData = { ...data, files: truncatedFiles };
      const retrySize = truncatedFiles.reduce((sum, f) => sum + f.size, 0);
      setStatus('downloading');
      await runDownload(mobileData, retrySize, signal);

      // If truncated, show mobile-partial status instead of done.
      if (truncatedFiles.length < data.files.length) {
        setStatus('mobile-partial');
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))) {
        setStatus('cancelled');
        return;
      }
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Download failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && status !== 'downloading' && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<Download size={20} className="text-primary" />}>
          <DialogTitle>Download &ldquo;{folderName}&rdquo;</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {status === 'listing' && (
            <div className="flex items-center gap-3 py-4">
              <LoaderCircle className="w-5 h-5 text-primary animate-spin" />
              <p className="text-sm text-slate-600">Preparing file list...</p>
            </div>
          )}

          {status === 'downloading' && (
            <div className="py-4">
              <div className="flex items-center gap-3 mb-3">
                <LoaderCircle className="w-5 h-5 text-primary animate-spin" />
                <p className="text-sm text-slate-600">
                  Downloading {progress.current} / {progress.total}
                </p>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 truncate">{progress.currentName}</p>
              {streamingUsed && totalSize > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  {formatBytes(bytesWritten)} / {formatBytes(totalSize)}
                </p>
              )}
            </div>
          )}

          {status === 'done' && (
            <div className="py-4 space-y-2">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <p className="text-sm text-slate-600">Download complete!</p>
              </div>
              {truncated && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    Folder has more than {progress.total} files. Download was capped for
                    performance. Download subfolders individually for the remaining files.
                  </p>
                </div>
              )}
            </div>
          )}

          {status === 'partial' && (
            <div className="py-4 space-y-2">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <p className="text-sm text-slate-600">
                  Download complete! {progress.total - failedFiles.length} of {progress.total} files
                </p>
              </div>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <p className="font-medium mb-1">
                    {failedFiles.length} file(s) failed to download:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {failedFiles.map((f) => (
                      <li key={f.name}>
                        {f.name} ({f.error})
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2">You can download them individually from the file list.</p>
                </div>
              </div>
            </div>
          )}

          {status === 'cancelled' && (
            <div className="py-4 space-y-2">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Download cancelled</p>
                  {streamingUsed ? (
                    <p className="mt-1">
                      The partial ZIP file on disk may be corrupt (missing central directory).
                      Delete it and restart the download for a valid archive.
                    </p>
                  ) : (
                    <p className="mt-1">
                      No file was saved. You can restart the download from the file list.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {status === 'mobile-warning' && (
            <div className="py-4 space-y-3">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium mb-1">Mobile browser limitation</p>
                  <p>
                    Your browser doesn&apos;t support streaming downloads. Folders larger than 500MB
                    may fail.
                  </p>
                  <p className="mt-2 font-medium">Total size: {formatBytes(totalSize)}</p>
                </div>
              </div>
            </div>
          )}

          {status === 'mobile-partial' && (
            <div className="py-4 space-y-2">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <p className="text-sm text-slate-600">
                  Download complete! {progress.total} of {originalFileCount} files
                </p>
              </div>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Mobile 500MB limit reached. Downloaded the first {progress.total} files. Download
                  remaining {originalFileCount - progress.total} files on a desktop browser.
                </p>
              </div>
            </div>
          )}

          {status === 'mobile-too-large' && (
            <div className="py-4 space-y-2">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Cannot download on mobile</p>
                  <p className="mt-1">
                    This folder contains a file larger than 500MB. It cannot be downloaded on mobile
                    — please use a desktop browser.
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-3 py-4">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <p className="text-sm text-red-600">{errorMsg}</p>
            </div>
          )}
        </DialogBody>
        {status === 'downloading' ? (
          <DialogFooter>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel download
            </Button>
          </DialogFooter>
        ) : status === 'mobile-warning' ? (
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Use desktop
            </Button>
            <Button variant="primary" onClick={handleTryAnyway}>
              Try anyway
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
