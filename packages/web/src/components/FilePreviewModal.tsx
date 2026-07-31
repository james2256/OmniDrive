import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Download, LoaderCircle } from 'lucide-react';
import type { FileEntry } from '../types';
import { formatFileSize, formatRelativeTime } from '../lib/utils';
import { fetchFilePreviewBlob } from '../lib/api/files';
import { FileIcon, getFileTypeName } from './files/FileIcon';
import { PdfCanvas } from './files/PdfCanvas';
import { parseCsv } from '../lib/parse-csv';
import { TEXT_APPLICATION_TYPES } from '../lib/text-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/Button';

interface FilePreviewModalProps {
  open: boolean;
  file?: FileEntry;
  onClose: () => void;
}

export function FilePreviewModal({ open, file, onClose }: FilePreviewModalProps) {
  const isImage =
    file?.mimeType?.startsWith('image/') || file?.mimeType === 'application/vnd.google-apps.photo';
  // PDF covers both regular PDFs and Google Workspace files (exported to PDF
  // by the /preview route via downloadFile's previewMode flag). Both render
  // via pdf.js canvas — works on ALL devices (iOS Safari, Android Chrome, desktop).
  const isPdf =
    file?.mimeType === 'application/pdf' ||
    file?.mimeType?.startsWith('application/vnd.google-apps.');
  const isVideo = file?.mimeType?.startsWith('video/');
  const isAudio = file?.mimeType?.startsWith('audio/');
  const isCsv = file?.mimeType === 'text/csv' || file?.mimeType === 'application/csv';
  // isText excludes CSV (which gets its own table renderer) and includes
  // text-based application/* types (JSON, XML, JS, YAML, etc.).
  const isText =
    ((file?.mimeType?.startsWith('text/') ?? false) && !isCsv) ||
    TEXT_APPLICATION_TYPES.has(file?.mimeType ?? '');
  const isXlsx =
    file?.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file?.mimeType === 'application/vnd.ms-excel';
  const isDocx =
    file?.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file?.mimeType === 'application/msword';
  const isPptx =
    file?.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const isGoogleDoc = file?.mimeType?.startsWith('application/vnd.google-apps.');

  // Shared state for blob-based previews (image, PDF, video, audio, text, CSV, XLSX, DOCX)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<string[][] | null>(null);
  const [xlsxRows, setXlsxRows] = useState<string[][] | null>(null);
  const [pptxDataUrl, setPptxDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  // DOCX renders into a DOM container (docx-preview appends directly)
  const docxContainerRef = useRef<HTMLDivElement>(null);

  const needsBlobFetch =
    isImage || isPdf || isVideo || isAudio || isText || isCsv || isXlsx || isDocx || isPptx;

  useEffect(() => {
    const fileId = file?.id;
    if (!open || !fileId || !needsBlobFetch) {
      setPreviewBlob(null);
      setPreviewUrl(null);
      setTextContent(null);
      setCsvRows(null);
      setXlsxRows(null);
      setPptxDataUrl(null);
      setImageError(false);
      setIsLoading(false);
      return;
    }

    let revoked = false;
    let objectUrl: string | null = null;

    setIsLoading(true);
    setImageError(false);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setTextContent(null);
    setCsvRows(null);
    setXlsxRows(null);
    setPptxDataUrl(null);

    fetchFilePreviewBlob(fileId)
      .then(async (blob) => {
        if (revoked) return;

        // PDF: store blob for PdfCanvas (pdf.js needs ArrayBuffer, not a URL)
        if (isPdf) {
          setPreviewBlob(blob);
          setIsLoading(false);
          return;
        }

        // Text (plain, JSON, XML, etc.): read as text
        if (isText) {
          const text = await blob.text();
          if (!revoked) {
            setTextContent(text);
            setIsLoading(false);
          }
          return;
        }

        // CSV: parse into rows for table rendering
        if (isCsv) {
          const text = await blob.text();
          if (!revoked) {
            setCsvRows(parseCsv(text));
            setIsLoading(false);
          }
          return;
        }

        // XLSX: lazy-load read-excel-file, parse to rows
        if (isXlsx) {
          const readXlsxFile = (await import('read-excel-file/browser')).default;
          const sheets = await readXlsxFile(blob);
          // readXlsxFile returns Sheet[] ({ sheet, data }). Use the first sheet's data.
          const rows = sheets[0]?.data ?? [];
          if (!revoked) {
            setXlsxRows(rows.map((r) => r.map((c) => (c != null ? String(c) : ''))));
            setIsLoading(false);
          }
          return;
        }

        // DOCX: lazy-load docx-preview, render into container
        if (isDocx) {
          const docx = await import('docx-preview');
          if (!docxContainerRef.current || revoked) return;
          await docx.renderAsync(blob, docxContainerRef.current, undefined, {
            renderAltChunks: false, // closes the altChunk XSS vector
          });
          if (!revoked) setIsLoading(false);
          return;
        }

        // PPTX: lazy-load pptx-svg, render slide 0 to SVG, convert to <img> data URL
        // The <img> approach is XSS-safe — browsers render SVG images in an inert
        // state without executing <script> tags (MDN security guarantee).
        if (isPptx) {
          const { PptxRenderer } = await import('pptx-svg');
          const renderer = new PptxRenderer();
          // Load the WASM binary — pptx-svg exports it at subpath "./wasm".
          const wasmUrl = new URL('pptx-svg/wasm', import.meta.url);
          await renderer.init(wasmUrl.toString());
          await renderer.loadPptx(await blob.arrayBuffer());
          const svgString = renderer.renderSlideSvg(0); // first slide
          if (!revoked) {
            const dataUrl = `data:image/svg+xml;base64,${btoa(
              unescape(encodeURIComponent(svgString)),
            )}`;
            setPptxDataUrl(dataUrl);
            setIsLoading(false);
          }
          return;
        }

        // Image, video, audio: create a blob URL for the element src
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
  }, [
    open,
    file?.id,
    isImage,
    isPdf,
    isVideo,
    isAudio,
    isText,
    isCsv,
    isXlsx,
    isDocx,
    isPptx,
    needsBlobFetch,
  ]);

  // Check if a file type is not covered by any preview branch (for fallback)
  const isUnsupported =
    !isImage &&
    !isPdf &&
    !isVideo &&
    !isAudio &&
    !isText &&
    !isCsv &&
    !isXlsx &&
    !isDocx &&
    !isPptx;

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

            {isPdf && (
              <div className="mb-6 rounded-xl overflow-hidden bg-slate-50 border border-slate-200 min-h-[400px] flex items-center justify-center p-4">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center text-slate-500 py-12">
                    <LoaderCircle className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-sm">Loading preview…</span>
                  </div>
                ) : previewBlob ? (
                  <PdfCanvas blob={previewBlob} />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-500 py-12">
                    <FileIcon mimeType={file.mimeType} className="w-16 h-16 mb-2" />
                    <span className="text-sm">Preview unavailable</span>
                  </div>
                )}
              </div>
            )}

            {isVideo && (
              <div className="mb-6 rounded-xl overflow-hidden bg-slate-950">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center text-slate-400 py-12">
                    <LoaderCircle className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-sm">Loading preview…</span>
                  </div>
                ) : previewUrl ? (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    className="w-full max-h-[60vh] rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 py-12">
                    <FileIcon mimeType={file.mimeType} className="w-16 h-16 mb-2" />
                    <span className="text-sm">Preview unavailable</span>
                  </div>
                )}
              </div>
            )}

            {isAudio && (
              <div className="mb-6 rounded-xl bg-slate-50 border border-slate-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <FileIcon mimeType={file.mimeType} className="w-8 h-8 text-blue-500" />
                  <span className="text-sm text-slate-600">Audio file</span>
                </div>
                {isLoading ? (
                  <div className="flex items-center text-slate-500">
                    <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-sm">Loading…</span>
                  </div>
                ) : previewUrl ? (
                  <audio src={previewUrl} controls className="w-full" />
                ) : (
                  <span className="text-sm text-slate-500">Preview unavailable</span>
                )}
              </div>
            )}

            {(isCsv || isXlsx) && (
              <div className="mb-6 rounded-xl bg-slate-50 border border-slate-200 p-4 max-h-[60vh] overflow-auto">
                {(() => {
                  const rows = isCsv ? csvRows : xlsxRows;
                  if (isLoading) {
                    return (
                      <div className="flex items-center text-slate-500">
                        <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-sm">Loading…</span>
                      </div>
                    );
                  }
                  if (!rows || rows.length === 0) {
                    return <span className="text-sm text-slate-500">Preview unavailable</span>;
                  }
                  return (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b-2 border-slate-300">
                          {rows[0].map((h, i) => (
                            <th
                              key={i}
                              className="text-left px-3 py-2 font-semibold text-slate-700 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(1).map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-200 hover:bg-slate-100">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-2 text-slate-600 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}

            {isDocx && (
              <div className="mb-6 rounded-xl bg-white border border-slate-200 p-4 max-h-[60vh] overflow-auto">
                {isLoading && (
                  <div className="flex items-center text-slate-500">
                    <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-sm">Loading…</span>
                  </div>
                )}
                <div ref={docxContainerRef} />
              </div>
            )}

            {isPptx && (
              <div className="mb-6 rounded-xl overflow-hidden bg-slate-50 border border-slate-200 min-h-[400px] flex items-center justify-center p-4">
                {isLoading ? (
                  <div className="flex flex-col items-center text-slate-500 py-12">
                    <LoaderCircle className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-sm">Loading slides…</span>
                  </div>
                ) : pptxDataUrl ? (
                  <img
                    src={pptxDataUrl}
                    alt={file.name}
                    className="max-w-full rounded-lg shadow-sm"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-500 py-12">
                    <FileIcon mimeType={file.mimeType} className="w-16 h-16 mb-2" />
                    <span className="text-sm">Preview unavailable</span>
                  </div>
                )}
              </div>
            )}

            {isText && (
              <div className="mb-6 rounded-xl bg-slate-50 border border-slate-200 p-4 max-h-[60vh] overflow-auto">
                {isLoading ? (
                  <div className="flex items-center text-slate-500">
                    <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-sm">Loading…</span>
                  </div>
                ) : textContent ? (
                  <pre className="text-sm whitespace-pre-wrap break-words text-slate-800">
                    {textContent}
                  </pre>
                ) : (
                  <span className="text-sm text-slate-500">Preview unavailable</span>
                )}
              </div>
            )}

            {isUnsupported && (
              <div className="mb-6 flex flex-col items-center justify-center text-slate-500 py-12 bg-slate-50 rounded-xl border border-slate-200">
                <FileIcon mimeType={file.mimeType} className="w-16 h-16 mb-3" />
                <span className="text-sm">Preview not available for this file type</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">
                  Size
                </div>
                <div className="text-slate-800 font-medium">{formatFileSize(file.size)}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">
                  Type
                </div>
                <div
                  className="text-slate-800 font-medium truncate"
                  title={file.mimeType ?? 'File'}
                >
                  {getFileTypeName(file.mimeType)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">
                  Modified
                </div>
                <div className="text-slate-800 font-medium truncate">
                  {file.googleModifiedAt ? formatRelativeTime(file.googleModifiedAt) : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1">
                  Created
                </div>
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
                <a
                  href={file.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
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
