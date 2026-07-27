import { useEffect, useState } from 'react';
import { ExternalLink, Download, LoaderCircle } from 'lucide-react';
import type { FileEntry } from '../types';
import { formatFileSize, formatRelativeTime } from '../lib/utils';
import { fetchFilePreviewBlob } from '../lib/api';
import { FileIcon, getFileTypeName } from './files/FileIcon';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle } from './ui/dialog';
import { Button } from './ui/Button';

interface FilePreviewModalProps {
  open: boolean;
  file?: FileEntry;
  onClose: () => void;
}

export function FilePreviewModal({ open, file, onClose }: FilePreviewModalProps) {
  const isImage = file?.mimeType?.startsWith('image/') || file?.mimeType === 'application/vnd.google-apps.photo';
  const isGoogleDoc = file?.mimeType?.startsWith('application/vnd.google-apps.');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const fileId = file?.id;
    if (!open || !fileId || !isImage) {
      setPreviewUrl(null);
      setImageError(false);
      setIsLoading(false);
      return;
    }

    let revoked = false;
    let objectUrl: string | null = null;

    setIsLoading(true);
    setImageError(false);
    setPreviewUrl(null);

    fetchFilePreviewBlob(fileId)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setIsLoading(false);
      })
      .catch(() => {
        if (revoked) return;
        setImageError(true);
        setIsLoading(false);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, file?.id, isImage]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col overflow-hidden max-h-full">
        <DialogHeader
          icon={<FileIcon mimeType={file?.mimeType} />}
          subtitle={file?.driveEmail || 'Google Drive'}
        >
          <DialogTitle className="truncate" title={file?.name}>
            {file?.name}
          </DialogTitle>
        </DialogHeader>

        {file && (
          <DialogBody>
            {isImage && (
              <div className="mb-6 rounded-xl overflow-hidden bg-slate-50 border border-slate-200 flex justify-center items-center p-2 min-h-[200px]">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center text-slate-500 py-12">
                    <LoaderCircle className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-sm">Loading preview…</span>
                  </div>
                ) : previewUrl && !imageError ? (
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="max-w-full max-h-[400px] object-contain rounded-lg shadow-sm"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-500 py-12">
                    <FileIcon mimeType={file.mimeType} className="w-16 h-16 mb-2" />
                    <span className="text-sm">Preview unavailable</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">Size</div>
                <div className="text-slate-800 font-medium">{formatFileSize(file.size)}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">Type</div>
                <div className="text-slate-800 font-medium truncate" title={file.mimeType ?? 'File'}>
                  {getFileTypeName(file.mimeType)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">Modified</div>
                <div className="text-slate-800 font-medium truncate">
                  {file.googleModifiedAt ? formatRelativeTime(file.googleModifiedAt) : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">Created</div>
                <div className="text-slate-800 font-medium truncate">
                  {file.googleCreatedAt ? formatRelativeTime(file.googleCreatedAt) : '—'}
                </div>
              </div>
            </div>
          </DialogBody>
        )}

        {file && (
          <DialogFooter>
            {file.webViewLink && (
              <Button asChild variant="secondary">
                <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <ExternalLink size={18} /> Open in Drive
                </a>
              </Button>
            )}
            {file.webContentLink && !isGoogleDoc && (
              <Button asChild variant="primary">
                <a
                  href={`${import.meta.env.VITE_API_URL || ''}/api/files/${file.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <Download size={18} /> Download
                </a>
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
