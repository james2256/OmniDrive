import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { useUploadStore } from '../stores/useUploadStore';

export function DropZone({ children }: { children: React.ReactNode }) {
  const addFiles = useUploadStore((s) => s.addFiles);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        addFiles(acceptedFiles);
      }
    },
    [addFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
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
              <Upload size={28} className="text-primary" aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-slate-900">
              Drop files to upload
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
