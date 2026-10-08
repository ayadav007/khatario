'use client';

import { useEffect, useRef, useState } from 'react';

/** Print templates lay out up to this width (GST detailed uses max-width 850px). */
const PAGE_WIDTH = 850;

/**
 * Renders a print document at its real page width, then scales it to fit.
 * A narrow iframe reflows the table and breaks words down the cell.
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.45);
  const [contentHeight, setContentHeight] = useState(1123);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) setScale(Math.min(1, width / PAGE_WIDTH));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setContentHeight(1123);
  }, [html, src]);

  function measureDocument() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    if (height > 0) setContentHeight(height);
  }

  const paperWidth = Math.round(PAGE_WIDTH * scale);

  return (
    <div ref={frameRef} className="w-full">
      <div
        className="relative mx-auto overflow-hidden bg-white shadow-md"
        style={{ width: paperWidth, height: Math.round(contentHeight * scale) }}
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
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </div>
  );
}
