import { useEffect, useRef, useState } from 'react';
import { Loader2, FileWarning } from 'lucide-react';

/**
 * A drawing sheet, rendered.
 *
 * PDF.js renders one page to a canvas at a chosen width. The width is the only
 * thing zoom changes: the sheet's own coordinate space stays fixed at the
 * page's natural size, so a measurement taken at 100% and the same measurement
 * taken at 400% are the same numbers. A viewer that stored screen pixels would
 * silently reprice an estimate when somebody zoomed in to click accurately.
 *
 * Loaded dynamically because the renderer is large and most of the application
 * never opens a drawing.
 */
export interface SheetCanvasProps {
  /** A URL the browser can fetch, or the bytes themselves. */
  source: string | ArrayBuffer;
  pageNumber: number;
  /** Rendered width in screen pixels. */
  displayWidth: number;
  /** Reports the page's natural size, which is the measuring coordinate space. */
  onSize?: (size: { width: number; height: number }) => void;
}

export function SheetCanvas({ source, pageNumber, displayWidth, onSize }: SheetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let canceled = false;
    let cleanup: (() => void) | undefined;

    async function render() {
      /*
       * No document is not a failure. It is what the screen looks like before a
       * plan set has been uploaded, and showing a PDF library's exception there
       * would tell an estimator their tools are broken when they are simply
       * waiting on drawings.
       */
      if (!source || (typeof source === 'string' && source.trim() === '')) {
        setState('empty');
        onSize?.({ width: 1224, height: 792 });
        return;
      }
      setState('loading');
      try {
        const pdfjs = await import('pdfjs-dist');
        // The worker ships beside the library; resolving it through the bundler
        // keeps it on the same origin rather than reaching for a CDN.
        pdfjs.GlobalWorkerOptions.workerSrc =
          new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

        const doc = await pdfjs.getDocument(
          typeof source === 'string' ? { url: source } : { data: new Uint8Array(source) },
        ).promise;
        if (canceled) { void doc.destroy(); return; }
        cleanup = () => { void doc.destroy(); };

        const page = await doc.getPage(pageNumber);
        if (canceled) return;

        // The natural page size is the measuring space, fixed regardless of zoom.
        const natural = page.getViewport({ scale: 1 });
        onSize?.({ width: natural.width, height: natural.height });

        const viewport = page.getViewport({ scale: displayWidth / natural.width });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        // Render at the device's own resolution: a drawing measured on a blurry
        // raster is measured wrong.
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (!canceled) setState('ready');
      } catch (err) {
        if (canceled) return;
        setMessage(err instanceof Error ? err.message : 'The sheet could not be opened.');
        setState('error');
      }
    }

    void render();
    return () => { canceled = true; cleanup?.(); };
  }, [source, pageNumber, displayWidth, onSize]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="block bg-white shadow-sm" />
      {state === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70"
          role="status" aria-live="polite">
          <Loader2 className="size-5 animate-spin text-charcoal-400" />
          <span className="sr-only">Opening the sheet</span>
        </div>
      ) : null}
      {state === 'empty' ? (
        <div className="flex min-h-96 flex-col items-center justify-center gap-2 border border-dashed border-charcoal-300 bg-white p-8 text-center">
          <FileWarning className="size-6 text-charcoal-300" />
          <p className="text-sm font-medium text-charcoal-700">No sheet open</p>
          <p className="max-w-sm text-xs text-charcoal-500">
            Upload a plan set under Plans &amp; Specs and choose a sheet to measure on.
            The measuring tools stay available so a scale can be set up in advance.
          </p>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-2 border border-dashed border-charcoal-300 bg-charcoal-50 p-8 text-center">
          <FileWarning className="size-6 text-charcoal-400" />
          <p className="text-sm font-medium text-charcoal-700">This sheet could not be opened</p>
          <p className="max-w-md text-xs text-charcoal-500">{message}</p>
        </div>
      ) : null}
    </div>
  );
}
