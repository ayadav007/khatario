'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/** Print templates lay out up to this width (GST detailed uses max-width 850px). */
const PAGE_WIDTH = 850;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(touches: TouchList) {
  const a = touches[0];
  const b = touches[1];
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

/**
 * Renders a print document at its real page width, then scales it to fit.
 * A narrow iframe reflows the table and breaks words down the cell.
 * Pinch or the + button enlarges the fitted page so the text can be read.
 */
export function ScaledA4Preview({
  html,
  src,
  title = 'Document preview',
}: {
  html?: string;
  src?: string;
  title?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const zoomRef = useRef(1);
  const [fitScale, setFitScale] = useState(0.45);
  const [zoom, setZoom] = useState(1);
  const [contentHeight, setContentHeight] = useState(1123);

  const maxZoom = fitScale > 0 ? Math.min(4, 2 / fitScale) : 2;
  const viewScale = fitScale * zoom;
  const zoomed = zoom > 1.02;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) setFitScale(Math.min(1, width / PAGE_WIDTH));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setContentHeight(1123);
    setZoom(1);
  }, [html, src]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let startDist = 0;
    let startZoom = 1;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        startDist = touchDistance(event.touches);
        startZoom = zoomRef.current;
      }
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || startDist <= 0) return;
      event.preventDefault();
      const limit = fitScale > 0 ? Math.min(4, 2 / fitScale) : 2;
      const next = startZoom * (touchDistance(event.touches) / startDist);
      setZoom(clamp(next, 1, limit));
    };
    const onEnd = () => {
      startDist = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [fitScale]);

  function measureDocument() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    if (height > 0) setContentHeight(height);
  }

  function changeZoom(next: number) {
    setZoom(clamp(next, 1, maxZoom));
    if (next <= 1.02) {
      const scroller = scrollerRef.current;
      if (scroller) {
        scroller.scrollLeft = 0;
        scroller.scrollTop = 0;
      }
    }
  }

  const paperWidth = Math.round(PAGE_WIDTH * viewScale);
  const paperHeight = Math.round(contentHeight * viewScale);

  return (
    <div ref={frameRef} className="relative w-full">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={!zoomed}
          onClick={() => changeZoom(zoom / 1.25)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-text-primary shadow-md disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= maxZoom - 0.02}
          onClick={() => changeZoom(zoom * 1.25)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-text-primary shadow-md disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="w-full overflow-auto"
        style={{
          maxHeight: zoomed ? '70vh' : undefined,
          height: zoomed ? '70vh' : undefined,
          touchAction: 'pan-x pan-y',
        }}
      >
        <div
          className="relative mx-auto overflow-hidden bg-white shadow-md"
          style={{ width: paperWidth, height: paperHeight }}
        >
          <iframe
            ref={iframeRef}
            src={src}
            srcDoc={src ? undefined : html}
            title={title}
            scrolling="no"
            onLoad={() => {
              measureDocument();
              window.setTimeout(measureDocument, 300);
            }}
            className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
            style={{
              width: PAGE_WIDTH,
              height: contentHeight,
              transform: `scale(${viewScale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>
    </div>
  );
}
