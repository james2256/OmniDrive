import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

interface PdfCanvasProps {
  blob: Blob;
}

/**
 * Render a PDF blob to `<canvas>` via `pdf.js`. Unlike `<iframe src={blobUrl}>`,
 * which doesn't render on iOS Safari or Android Chrome (their PDF viewers are
 * top-level-only), canvas rendering works on every browser — iPhone, iPad,
 * Android, desktop.
 *
 * `pdf.js` is lazy-loaded via dynamic `import()` so only users who open a PDF
 * pay the bundle cost. The worker is a separate chunk fetched in parallel on
 * first render.
 *
 * @see https://github.com/mozilla/pdf.js
 */
export function PdfCanvas({ blob }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    // Lazy-load pdf.js only when a PDF is actually opened.
    import('pdfjs-dist')
      .then(async (pdfjsLib) => {
        if (cancelled) return;

        // Configure the worker — Vite resolves this URL at build time.
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);

        const page = await pdf.getPage(currentPage);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context || cancelled) return;
        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise;
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [blob, currentPage]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-slate-500 py-12">
        <span className="text-sm">Preview unavailable</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full">
      {loading && (
        <div className="flex flex-col items-center text-slate-500 py-12">
          <LoaderCircle className="w-8 h-8 animate-spin mb-2" />
          <span className="text-sm">Loading page {currentPage}…</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="max-w-full shadow-sm rounded-lg"
        style={{ display: loading ? 'none' : 'block' }}
      />
      {numPages > 1 && (
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1 || loading}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 disabled:opacity-50 hover:bg-slate-100 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-600">
            Page {currentPage} of {numPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages || loading}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 disabled:opacity-50 hover:bg-slate-100 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
