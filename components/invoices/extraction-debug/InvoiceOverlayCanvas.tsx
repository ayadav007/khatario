'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { InvoiceSpatialDocument, OcrWord } from '@/lib/services/invoice-extract/ocrSpatialParser';
import type { SemanticInvoiceTableParseResult } from '@/lib/services/invoice-extract/semanticInvoiceTypes';
import type { InvoiceOptimizationResult } from '@/lib/services/invoice-extract/invoiceOptimizationTypes';
import { RegionOverlayLayer, hitTestRowAt, hitTestWordAt } from './RegionOverlayLayer';
import type { OverlayToggles } from './invoiceExtractionDebugTypes';

export type InvoiceOverlayCanvasProps = {
  imageSrc: string;
  imageAlt?: string;
  spatialDocument: InvoiceSpatialDocument;
  semanticParse?: SemanticInvoiceTableParseResult | null;
  optimization?: InvoiceOptimizationResult | null;
  toggles: OverlayToggles;
  selectedRowIndex: number | null;
  onSelectRow: (rowIndex: number | null) => void;
  className?: string;
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function InvoiceOverlayCanvas({
  imageSrc,
  imageAlt = 'Invoice',
  spatialDocument: doc,
  semanticParse,
  optimization,
  toggles,
  selectedRowIndex,
  onSelectRow,
  className,
}: InvoiceOverlayCanvasProps) {
  const [hoveredWordIndex, setHoveredWordIndex] = useState<number | null>(null);
  const [hoverWord, setHoverWord] = useState<OcrWord | null>(null);
  const [zoomIdx, setZoomIdx] = useState(2);

  const zoom = ZOOM_STEPS[zoomIdx] ?? 1;
  const { pageWidth, pageHeight } = doc;

  const svgPointFromEvent = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = pt.matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    },
    [],
  );

  const onSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const p = svgPointFromEvent(e);
      if (!p) return;
      const wi = hitTestWordAt(doc, p.x, p.y);
      if (wi != null) {
        const w = doc.words[wi];
        const row = doc.rows.find((r) => r.words.some((rw) => rw === w));
        if (row) onSelectRow(row.rowIndex);
        return;
      }
      const ri = hitTestRowAt(doc, p.x, p.y);
      if (ri != null) onSelectRow(ri);
    },
    [doc, onSelectRow, svgPointFromEvent],
  );

  const wordHover = useCallback((w: OcrWord, wi: number) => {
    setHoveredWordIndex(wi);
    setHoverWord(w);
  }, []);

  const wordLeave = useCallback(() => {
    setHoveredWordIndex(null);
    setHoverWord(null);
  }, []);

  const legend = useMemo(
    () => (
      <div className="flex flex-wrap gap-3 text-xs text-text-secondary border-b border-border pb-2 mb-2">
        <span>
          <span className="inline-block w-3 h-3 rounded-sm border-2 border-blue-600 mr-1 align-middle" /> Rows
        </span>
        <span>
          <span className="inline-block w-3 h-3 bg-green-600/15 border border-green-600 mr-1 align-middle" />{' '}
          Columns
        </span>
        <span>
          <span className="inline-block w-3 h-3 border-2 border-orange-600 mr-1 align-middle" /> GST
        </span>
        <span>
          <span className="inline-block w-3 h-3 border-2 border-amber-600 mr-1 align-middle" /> Totals
        </span>
        <span>
          <span className="inline-block w-3 h-3 bg-red-600/15 border border-red-600 mr-1 align-middle" />{' '}
          Suspicious
        </span>
        <span>
          <span className="inline-block w-3 h-3 bg-yellow-600/15 border border-yellow-600 mr-1 align-middle" />{' '}
          Repaired
        </span>
        <span>
          <span className="inline-block w-3 h-3 bg-purple-600/15 border border-purple-700 mr-1 align-middle" />{' '}
          Rejected cand.
        </span>
        <span>
          <span className="inline-block w-3 h-3 border border-slate-500 mr-1 align-middle" />
          Table regions
        </span>
      </div>
    ),
    [],
  );

  return (
    <div className={clsx('flex flex-col gap-2 min-w-0', className)}>
      {legend}

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-sm text-text-secondary">Zoom</label>
        <select
          className="border border-border rounded-md px-2 py-1 text-sm bg-white text-text-primary"
          value={zoomIdx}
          onChange={(e) => setZoomIdx(Number(e.target.value))}
        >
          {ZOOM_STEPS.map((z, i) => (
            <option key={z} value={i}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          Click a row (or word → owning row) to inspect semantics. Scroll to pan.
        </span>
      </div>

      <div className="relative overflow-auto max-h-[min(78vh,900px)] rounded-md border border-border bg-gray-100">
        <div
          className="relative inline-block"
          style={{
            width: pageWidth * zoom,
            height: pageHeight * zoom,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- debug viewer uses dynamic URLs / data URLs */}
          <img
            src={imageSrc}
            alt={imageAlt}
            className="block select-none absolute inset-0 w-full h-full object-fill"
            draggable={false}
            width={pageWidth}
            height={pageHeight}
          />

          <svg
            className="absolute left-0 top-0 pointer-events-auto"
            width="100%"
            height="100%"
            viewBox={`0 0 ${pageWidth} ${pageHeight}`}
            preserveAspectRatio="none"
            onClick={onSvgClick}
          >
            <RegionOverlayLayer
              doc={doc}
              semantic={semanticParse}
              optimization={optimization}
              toggles={toggles}
              selectedRowIndex={selectedRowIndex}
              hoveredWordIndex={hoveredWordIndex}
              onWordEnter={wordHover}
              onWordLeave={wordLeave}
            />
          </svg>
        </div>

        {hoverWord && toggles.ocrWords && (
          <div className="mt-2 text-xs font-mono text-text-secondary border-t border-border pt-2 px-1">
            <span className="text-text-primary font-medium">{hoverWord.text}</span>
            {' · '}
            conf {(hoverWord.confidence * 100).toFixed(0)}% ·{' '}
            {Math.round(hoverWord.bbox.maxX - hoverWord.bbox.minX)}×{Math.round(hoverWord.bbox.maxY - hoverWord.bbox.minY)} px
            · bbox[{hoverWord.bbox.minX.toFixed(0)}, {hoverWord.bbox.minY.toFixed(0)}, {hoverWord.bbox.maxX.toFixed(0)},{' '}
            {hoverWord.bbox.maxY.toFixed(0)}]
          </div>
        )}
      </div>
    </div>
  );
}
