import { useCallback } from 'react';
import { useDropzone, type DropEvent } from 'react-dropzone';
import { FolderUp } from 'lucide-react';
import { useUploadStore } from '../stores/useUploadStore';
import { traverseDroppedItems } from '../lib/drag-traverse';

export function DropZone({ children }: { children: React.ReactNode }) {
  const addFiles = useUploadStore((s) => s.addFiles);
  const setEmptyFolders = useUploadStore((s) => s.setEmptyFolders);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        addFiles(acceptedFiles);
      }
    },
    [addFiles],
  );

  // getFilesFromEvent: traverse dropped directories recursively, setting
  // webkitRelativePath on each file (matching <input webkitdirectory> contract).
  // Also collects empty directory paths for Fix 2 (empty folder creation).
  // Reference: https://react-dropzone.js.org/#!/Components (getFilesFromEvent prop)
  //
  // Side effect: calls setEmptyFolders. This is the only hook with access to
  // DataTransfer.items (react-dropzone doesn't expose raw event to onDrop).
  // Acceptable trade-off vs reimplementing drag-drop natively.
  //
  // Type signature MUST use DropEvent (not DragEvent | Event) — the latter is
  // narrower than react-dropzone's expected type and would fail tsc under
  // strictFunctionTypes (function parameter contravariance).
  const getFilesFromEvent = useCallback(
    async (event: DropEvent | Array<FileSystemFileHandle>) => {
      const dt = 'dataTransfer' in event ? (event as DragEvent).dataTransfer : null;
      if (!dt) return [];
      const { files, directoryPaths } = await traverseDroppedItems(dt);
      if (directoryPaths.length > 0) {
        setEmptyFolders(directoryPaths);
      }
      return files;
    },
    [setEmptyFolders],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    getFilesFromEvent,
    noClick: true, // Disable file-picker dialog — UploadModal has its own <input>.
    // Required because getFilesFromEvent returns [] for dialog events
    // (no dataTransfer), which would silently drop dialog-selected files.
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} className="relative min-h-full">
      <input {...getInputProps()} />
      {children}
      {isDragActive && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-4 border-dashed border-primary rounded-lg pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
              <FolderUp size={28} className="text-primary" aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-slate-900">Drop files or folders to upload</p>
          </div>
        </div>
      )}
    </div>
  );
}
