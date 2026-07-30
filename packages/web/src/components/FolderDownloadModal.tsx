import { useState, useEffect } from 'react';
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

export function FolderDownloadModal({
  open,
  onClose,
  driveId,
  folderId,
  sharedLinkId,
  folderName,
}: FolderDownloadModalProps) {
  const [status, setStatus] = useState<'listing' | 'downloading' | 'done' | 'error'>('listing');
  const [progress, setProgress] = useState({ current: 0, total: 0, currentName: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        // 1. Get file tree from the appropriate endpoint
        const url = sharedLinkId
          ? `/api/shared/${sharedLinkId}/download-tree`
          : `/api/drives/${driveId}/folders/${folderId}/download-tree`;

        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          files: TreeFile[];
          rootName: string;
          truncated?: boolean;
        };

        if (cancelled) return;
        if (data.files.length === 0) {
          setStatus('error');
          setErrorMsg('This folder is empty.');
          return;
        }
        setTruncated(data.truncated === true);

        // 2. Download each file and stream into ZIP
        setStatus('downloading');
        setProgress({
          current: 0,
          total: data.files.length,
          currentName: data.files[0]?.name ?? '',
        });

        const apiUrl = import.meta.env.VITE_API_URL || '';
        let downloaded = 0;

        const responses = (async function* () {
          for (const file of data.files) {
            if (cancelled) return;
            const downloadUrl = sharedLinkId
              ? `${apiUrl}/api/shared/${sharedLinkId}/download?fileId=${file.googleFileId}`
              : `${apiUrl}/api/files/${file.id}/download`;
            const response = await fetch(downloadUrl, { credentials: 'include' });
            if (!response.ok) throw new Error(`Failed to download ${file.name}`);
            yield { name: file.path, input: response, lastModified: new Date() };
            downloaded++;
            if (!cancelled) {
              setProgress({
                current: downloaded,
                total: data.files.length,
                currentName: file.name,
              });
            }
          }
        })();

        const zipBlob = await downloadZip(responses).blob();
        if (cancelled) return;

        // 3. Trigger browser download
        const blobUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${data.rootName}.zip`;
        a.click();
        URL.revokeObjectURL(blobUrl);

        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Download failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, driveId, folderId, sharedLinkId]);

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

          {status === 'error' && (
            <div className="flex items-center gap-3 py-4">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <p className="text-sm text-red-600">{errorMsg}</p>
            </div>
          )}
        </DialogBody>
        {status !== 'downloading' && (
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
