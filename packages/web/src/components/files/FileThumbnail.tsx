import { useEffect, useState } from 'react';
import type { FileEntry } from '../../types';
import { FileIcon } from './FileIcon';

interface FileThumbnailProps {
  file: FileEntry;
  /** Size + shape classes, e.g. "w-12 h-12 rounded object-cover" (grid) or "w-6 h-6" (list). */
  className?: string;
}

/**
 * Render a file's thumbnail from Google's signed `thumbnailUrl`, falling back
 * to the type-based {@link FileIcon} when the thumbnail is missing, expired,
 * or fails to load.
 *
 * Google's `thumbnailLink` includes a size suffix (`=s220` = 220px). Swapping
 * it to `=s600` fetches a larger image (600px) from the same signed URL — no
 * extra API call, no D1 read — so the grid/list shows a higher-quality
 * preview without a performance cost.
 *
 * The thumbnail URL is a short-lived Google-signed URL (typically hours).
 * On expiry or load failure, `onError` flips the internal `errored` state and
 * the component re-renders the {@link FileIcon} — a graceful degradation with
 * no broken-image icon. The next file-list fetch (navigation/refetch) brings
 * fresh signed URLs, and the `useEffect` below resets `errored` so the new
 * URL is retried (self-healing — no manual reload needed).
 */
export function FileThumbnail({ file, className }: FileThumbnailProps) {
  const [errored, setErrored] = useState(false);

  // Reset error state when the thumbnail URL changes (e.g., after TanStack
  // refetch brings a fresh Google-signed URL). Without this, a once-expired
  // URL would permanently show FileIcon even after the URL is refreshed.
  // Matches the pattern in FilePreviewModal.tsx (reset on file/id change).
  useEffect(() => {
    setErrored(false);
  }, [file.thumbnailUrl]);

  if (!file.thumbnailUrl || errored) {
    return <FileIcon mimeType={file.mimeType} className={className} />;
  }

  // Up-size from the default 220px to 600px for sharper grid/list previews.
  const largeThumb = file.thumbnailUrl.replace('=s220', '=s600');

  return (
    <img
      src={largeThumb}
      alt=""
      loading="lazy"
      className={className ?? 'w-10 h-10 rounded object-cover'}
      onError={() => setErrored(true)}
      referrerPolicy="no-referrer"
    />
  );
}
