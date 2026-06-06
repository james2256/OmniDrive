import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';

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
    <div {...getRootProps()} style={{ position: 'relative', minHeight: '100%' }}>
      <input {...getInputProps()} />
      {children}
      {isDragActive && (
        <div className="dropzone-overlay">
          <div style={{ textAlign: 'center' }}>
            <Upload size={48} color="var(--accent-primary)" />
            <p style={{ marginTop: 'var(--space-md)', fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
              Drop files to upload
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
