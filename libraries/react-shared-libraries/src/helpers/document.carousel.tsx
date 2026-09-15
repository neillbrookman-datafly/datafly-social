'use client';

import {
  FC,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { clsx } from 'clsx';
import { PdfTile } from '@gitroom/react/helpers/pdf.tile';

/**
 * LinkedIn document ("carousel") posts, previewed the way LinkedIn shows them:
 * a title bar, one page at a time, arrows and a page counter.
 *
 * PDF pages are drawn with pdf.js into a canvas. The PDF can't simply be
 * embedded: /uploads is served with a sandbox CSP and frame-ancestors 'none'
 * (hardening against scripted uploads), which blanks an <iframe>/<object>.
 * Fetching the bytes and rendering them ourselves sidesteps that without
 * loosening it, and pdf.js never executes a PDF's own JavaScript.
 */

// Copied out of node_modules at build time by apps/frontend/scripts/copy-pdf-worker.mjs,
// so the worker always matches the installed pdfjs-dist version.
const PDF_WORKER_SRC = '/pdfjs/pdf.worker.min.mjs';

const MAX_DEVICE_PIXEL_RATIO = 2;

const Frame: FC<{
  title?: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
  children: ReactNode;
  className?: string;
}> = ({ title, page, pages, onPage, children, className }) => {
  // Previews wrap media in <a href>; without this a click on an arrow would
  // open the file instead of turning the page.
  const go = (to: number) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPage(Math.max(0, Math.min(pages - 1, to)));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onPage(Math.max(0, page - 1));
    if (e.key === 'ArrowRight') onPage(Math.min(pages - 1, page + 1));
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={clsx('w-full flex flex-col outline-none select-none', className)}
      aria-roledescription="carousel"
      aria-label={title ? `${title}, ${pages} pages` : `${pages} pages`}
    >
      <div className="bg-black/80 text-white text-[12px] font-[600] px-[12px] py-[8px] truncate">
        {title || 'Document'}
        {pages > 0 && <span className="font-[400] opacity-80"> • {pages} {pages === 1 ? 'page' : 'pages'}</span>}
      </div>
      <div className="relative bg-[#f3f2ef] flex items-center justify-center min-h-[200px]">
        {children}
        {page > 0 && (
          <button
            type="button"
            onClick={go(page - 1)}
            aria-label="Previous page"
            className="absolute start-[8px] top-1/2 -translate-y-1/2 w-[36px] h-[36px] rounded-full bg-white/95 text-black shadow flex items-center justify-center text-[20px] leading-none"
          >
            ‹
          </button>
        )}
        {page < pages - 1 && (
          <button
            type="button"
            onClick={go(page + 1)}
            aria-label="Next page"
            className="absolute end-[8px] top-1/2 -translate-y-1/2 w-[36px] h-[36px] rounded-full bg-white/95 text-black shadow flex items-center justify-center text-[20px] leading-none"
          >
            ›
          </button>
        )}
        {pages > 0 && (
          <div className="absolute end-[8px] bottom-[8px] rounded-full bg-black/70 text-white text-[11px] px-[8px] py-[2px]">
            {page + 1} / {pages}
          </div>
        )}
      </div>
    </div>
  );
};

/** A PDF, one rendered page at a time. */
export const PdfCarousel: FC<{ src: string; title?: string; className?: string }> = ({
  src,
  title,
  className,
}) => {
  const [doc, setDoc] = useState<any>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load the document. pdf.js is imported on demand: it's browser-only and
  // heavy, and most previews never contain a PDF.
  useEffect(() => {
    let cancelled = false;
    let task: any;
    setDoc(null);
    setPages(0);
    setPage(0);
    setFailed(false);

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
        task = pdfjs.getDocument({ url: src });
        const loaded = await task.promise;
        if (cancelled) return;
        setDoc(loaded);
        setPages(loaded.numPages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      task?.destroy?.();
    };
  }, [src]);

  // Draw the current page at the width it's shown, sharp on high-DPI screens.
  useEffect(() => {
    if (!doc || !canvasRef.current || !stageRef.current) return;
    let renderTask: any;
    let cancelled = false;

    (async () => {
      try {
        const pdfPage = await doc.getPage(page + 1);
        if (cancelled || !canvasRef.current || !stageRef.current) return;
        const cssWidth = stageRef.current.clientWidth || 500;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: (cssWidth * dpr) / base.width });

        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        renderTask = pdfPage.render({ canvas, viewport });
        await renderTask.promise;
      } catch (err: any) {
        // Paging quickly cancels the previous render — that isn't a failure.
        if (!cancelled && err?.name !== 'RenderingCancelledException') setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [doc, page]);

  if (failed) {
    return (
      <div className={clsx('w-full h-[200px] flex flex-col', className)}>
        <PdfTile />
        <p className="text-[11px] text-center opacity-70 py-[4px]">Couldn&apos;t preview this PDF.</p>
      </div>
    );
  }

  return (
    <Frame title={title} page={page} pages={pages} onPage={setPage} className={className}>
      <div ref={stageRef} className="w-full flex justify-center">
        {!doc && (
          <div className="w-full h-[240px]">
            <PdfTile />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={clsx('block max-w-full max-h-[560px] w-auto h-auto bg-white', !doc && 'hidden')}
        />
      </div>
    </Frame>
  );
};

/** "Post as images carousel": LinkedIn turns the images into a document. */
export const ImagesCarousel: FC<{ images: string[]; title?: string; className?: string }> = ({
  images,
  title,
  className,
}) => {
  const [page, setPage] = useState(0);
  const safePage = Math.min(page, Math.max(0, images.length - 1));
  const onPage = useCallback((p: number) => setPage(p), []);
  return (
    <Frame title={title} page={safePage} pages={images.length} onPage={onPage} className={className}>
      <img src={images[safePage]} alt="" className="block max-w-full max-h-[560px] w-auto h-auto" />
    </Frame>
  );
};
