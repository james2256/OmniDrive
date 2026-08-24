/// <reference types="vite/client" />

// ─── StreamSaver.js (untyped CommonJS module) ───────────────────────────
// StreamSaver ships without TypeScript declarations. Declare the minimal
// surface used by packages/web/src/lib/streamDownload.ts.
declare module 'streamsaver' {
  export interface StreamSaverOptions {
    size?: number;
    pathname?: string;
    writableStrategy?: QueuingStrategy<Uint8Array>;
    readableStrategy?: QueuingStrategy<Uint8Array>;
  }
  export interface StreamSaver {
    mitm: string;
    createWriteStream(
      filename: string,
      options?: StreamSaverOptions | number,
      size?: number,
    ): WritableStream<Uint8Array>;
    supported: boolean;
  }
  const streamSaver: StreamSaver;
  export default streamSaver;
}

// ─── File System Access API (showSaveFilePicker) ────────────────────────
// TypeScript's lib.dom.d.ts doesn't include the File System Access API yet
// (Chrome/Edge only — Firefox/Safari have not implemented it). Declare the
// minimal surface used by packages/web/src/lib/streamDownload.ts.
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream<Uint8Array> {
  write(data: BufferSource | Blob | string): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
  id?: string;
  startIn?: string | FileSystemHandle;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}
