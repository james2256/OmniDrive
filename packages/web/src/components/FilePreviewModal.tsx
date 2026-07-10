import { useEffect, useState } from 'react';
import { ExternalLink, Download, Loader2 } from 'lucide-react';
import type { FileEntry } from '../types';
import { formatFileSize, formatRelativeTime } from '../lib/utils';
import { fetchFilePreviewBlob } from '../lib/api';
import { FileIcon } from './files/FileIcon';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

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
    if (!open || !file || !isImage) {
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

    fetchFilePreviewBlob(file.id)
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
      <DialogContent className="max-w-2xl p-0 gap-0 rounded-2xl overflow-hidden flex flex-col max-h-full">
        {/* Header */}
        <div className="flex items-start p-5 border-b border-stone-100 shrink-0">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <span className="text-4xl shrink-0"><FileIcon mimeType={file?.mimeType} /></span>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold text-stone-800 truncate" title={file?.name}>
                {file?.name}
              </DialogTitle>
              <div className="text-xs text-stone-500 truncate">
                {file?.driveEmail || 'Google Drive'}
              </div>
            </div>
          </div>
        </div>

        {/* Content Body - Scrollable */}
        {file && (
          <div className="p-6 overflow-y-auto">
            {/* Image preview via authenticated API proxy */}
            {isImage && (
              <div className="mb-6 rounded-xl overflow-hidden bg-stone-50 border border-stone-200 flex justify-center items-center p-2 min-h-[200px]">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center text-stone-400 py-12">
                    <Loader2 className="w-8 h-8 animate-spin mb-2" />
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
                  <div className="flex flex-col items-center justify-center text-stone-400 py-12">
                    <FileIcon mimeType={file.mimeType} className="w-16 h-16 mb-2" />
                    <span className="text-sm">Preview unavailable</span>
                  </div>
                )}
              </div>
            )}

            {/* File Info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-stone-50 p-4 rounded-xl border border-stone-100">
              <div>
                <div className="text-stone-500 text-xs uppercase tracking-wide font-medium mb-1">Size</div>
                <div className="text-stone-800 font-medium">{formatFileSize(file.size)}</div>
              </div>
              <div>
                <div className="text-stone-500 text-xs uppercase tracking-wide font-medium mb-1">Type</div>
                <div className="text-stone-800 font-medium truncate" title={file.mimeType ?? 'Unknown'}>
                  {file.mimeType ?? 'Unknown'}
                </div>
              </div>
              <div>
                <div className="text-stone-500 text-xs uppercase tracking-wide font-medium mb-1">Modified</div>
                <div className="text-stone-800 font-medium truncate">
                  {file.googleModifiedAt ? formatRelativeTime(file.googleModifiedAt) : '—'}
                </div>
              </div>
              <div>
                <div className="text-stone-500 text-xs uppercase tracking-wide font-medium mb-1">Created</div>
                <div className="text-stone-800 font-medium truncate">
                  {file.googleCreatedAt ? formatRelativeTime(file.googleCreatedAt) : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {file && (
          <div className="p-5 border-t border-stone-100 bg-stone-50 flex gap-3 justify-end shrink-0">
            {file.webViewLink && (
              <a
                href={file.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 bg-card border border-stone-300 rounded-xl hover:bg-stone-100 transition-colors shadow-sm"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={18} /> Open in Drive
              </a>
            )}
            {file.webContentLink && !isGoogleDoc && (
              <a
                href={`${import.meta.env.VITE_API_URL || ''}/api/files/${file.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                style={{ textDecoration: 'none' }}
              >
                <Download size={18} /> Download
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}