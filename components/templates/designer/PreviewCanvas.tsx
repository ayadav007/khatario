'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { TemplatePreviewSpec } from '@/lib/template-screen-preview';
import { Segmented } from './DesignerControls';

export type Zoom = 'fit' | 1 | 1.5;
export type PreviewSource = 'sample' | 'last_document';

/**
 * The paper on a grey canvas. "Fit" scales the whole page into view; 100% and 150% show it at size
 * and scroll. The page count comes from the rendered height against the paper height.
 */
export function PreviewCanvas({
  html,
  spec,
  loading,
  source,
  onSourceChange,
  lastDocumentLabel,
  documentNumber,
  onSectionClick,
}: {
  html: string | null;
  spec: TemplatePreviewSpec;
  loading: boolean;
  source: PreviewSource;
  onSourceChange: (s: PreviewSource) => void;
  /** e.g. "Last invoice"; null when this document type has no saved documents to show. */
  lastDocumentLabel: string | null;
  documentNumber?: string;
  /** A click on a marked part of the page (header, items, totals…). */
  onSectionClick: (section: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitScale, setFitScale] = useState(0.7);
  const [contentH, setContentH] = useState(spec.heightPx);
  const contentW = spec.widthPx;

  const measure = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, spec.heightPx);
    setContentH(h);
  }, [spec.heightPx]);

  const recomputeFit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 64;
    // Fit one page (not the whole document) so long invoices stay readable.
    // Thermal rolls are long and narrow: fit their width only.
    const s = spec.isThermal
      ? Math.min((width - pad) / contentW, 1.5)
      : Math.min((width - pad) / contentW, (height - pad) / spec.heightPx, 1);
    setFitScale(Math.max(0.25, s));
  }, [contentW, spec.heightPx, spec.isThermal]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onResize = () => {
      // Also re-measure: the page may have loaded while this pane was hidden (phone Edit view).
      measure();
      recomputeFit();
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeFit, measure]);

  useEffect(() => {
    if (html !== null && iframeRef.current) iframeRef.current.srcdoc = html;
  }, [html]);

  // The preview page posts the part that was clicked; only messages from this iframe count.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data as { type?: string; section?: unknown };
      if (data?.type === 'kh-designer-section' && typeof data.section === 'string') onSectionClick(data.section);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSectionClick]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  // Ignore a few pixels of overflow so a page that just fits counts as one.
  const pages = Math.max(1, Math.ceil((contentH - 4) / spec.heightPx));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-gray-100 dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
        {lastDocumentLabel ? (
          <Segmented<PreviewSource>
            size="sm"
            aria-label="Preview with"
            value={source}
            onChange={onSourceChange}
            options={[
              { value: 'sample', label: 'Sample data' },
              { value: 'last_document', label: lastDocumentLabel },
            ]}
          />
        ) : (
          <span className="text-xs text-gray-500 dark:text-slate-400">Sample data</span>
        )}
        <span className="hidden truncate text-xs text-gray-500 sm:inline dark:text-slate-400">
          {spec.pageLabel}
          {source === 'last_document' && documentNumber ? ` · ${documentNumber}` : ''}
        </span>
        <div className="flex-1" />
        <span className="text-xs tabular-nums text-gray-500 dark:text-slate-400" aria-live="polite">
          {spec.isThermal ? 'Thermal roll' : pages === 1 ? '1 page' : `${pages} pages`}
        </span>
        <Segmented<Zoom>
          size="sm"
          aria-label="Zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 'fit', label: 'Fit' },
            { value: 1, label: '100%' },
            { value: 1.5, label: '150%' },
          ]}
        />
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs text-gray-600 shadow-sm dark:bg-slate-800/90 dark:text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Updating
          </div>
        )}
        <div className="flex min-h-full justify-center p-8">
          <div className="shrink-0" style={{ width: contentW * scale, height: contentH * scale }}>
            <iframe
              ref={iframeRef}
              title="Invoice preview"
              scrolling="no"
              onLoad={() => {
                measure();
                requestAnimationFrame(measure);
              }}
              className="block border-0 bg-white ring-1 ring-black/5"
              style={{
                width: contentW,
                height: contentH,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)',
              }}
            />
          </div>
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-full bg-gray-900/75 px-3 py-1 text-[11px] text-white lg:block">
        Click any part of the invoice to edit it
      </p>
    </div>
  );
}
