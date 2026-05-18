'use client';

import React from 'react';
import type {
  BoundingBox,
  InvoiceSpatialDocument,
  OcrWord,
} from '@/lib/services/invoice-extract/ocrSpatialParser';
import type { SemanticInvoiceTableParseResult } from '@/lib/services/invoice-extract/semanticInvoiceTypes';
import type { InvoiceOptimizationResult } from '@/lib/services/invoice-extract/invoiceOptimizationTypes';
import type { OverlayToggles } from './invoiceExtractionDebugTypes';

function pointInBBox(
  x: number,
  y: number,
  bb: BoundingBox,
): boolean {
  return x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY;
}

/** Top-most word at document coordinates, or null. */
export function hitTestWordAt(doc: InvoiceSpatialDocument, x: number, y: number): number | null {
  for (let i = doc.words.length - 1; i >= 0; i--) {
    const w = doc.words[i];
    if (pointInBBox(x, y, w.bbox)) return i;
  }
  return null;
}

/** Row index if point falls in a row bbox (for row selection when not on a word interaction). */
export function hitTestRowAt(doc: InvoiceSpatialDocument, x: number, y: number): number | null {
  for (let i = doc.rows.length - 1; i >= 0; i--) {
    const row = doc.rows[i];
    if (pointInBBox(x, y, row.bbox)) return row.rowIndex;
  }
  return null;
}

/** Deterministic overlay styling (internal dev tool — not app chrome). */
const COL = {
  row: '#2563eb',
  col: '#16a34a',
  gst: '#ea580c',
  totals: '#d97706',
  suspicious: '#dc2626',
  repaired: '#ca8a04',
  rejected: '#9333ea',
  table: '#64748b',
  word: '#475569',
  wordHi: '#0f172a',
  selected: '#1d4ed8',
  link: '#0ea5e9',
} as const;

function boundsToSvg(bb: BoundingBox) {
  return { x: bb.minX, y: bb.minY, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY };
}

export type RegionOverlayLayerProps = {
  doc: InvoiceSpatialDocument;
  semantic?: SemanticInvoiceTableParseResult | null;
  optimization?: InvoiceOptimizationResult | null;
  toggles: OverlayToggles;
  selectedRowIndex: number | null;
  /** Global word index into `doc.words` */
  hoveredWordIndex: number | null;
  onWordEnter: (word: OcrWord, wordIndex: number) => void;
  onWordLeave: () => void;
};

export function RegionOverlayLayer({
  doc,
  semantic,
  optimization,
  toggles,
  selectedRowIndex,
  hoveredWordIndex,
  onWordEnter,
  onWordLeave,
}: RegionOverlayLayerProps) {
  const { pageHeight } = doc;
  const suspicious = new Set(semantic?.debug.suspiciousRows ?? []);
  const rejectedRows = new Set(optimization?.rejectedCandidates.map((r) => r.rowIndex) ?? []);
  const repairedRows = new Set(optimization?.repairedFields.map((r) => r.rowIndex) ?? []);

  return (
    <g pointerEvents="none">
      {/* Table regions (slate outline) */}
      {toggles.tableRegions &&
        doc.tableRegions.map((tr) => {
          const b = boundsToSvg(tr.bbox);
          return (
            <rect
              key={`tbl-${tr.regionIndex}`}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill="none"
              stroke={COL.table}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.85}
            />
          );
        })}

      {/* Classified GST / totals regions from semantic classifier */}
      {semantic?.debug?.regionClassifications?.map((meta) => {
        const b = boundsToSvg(meta.bbox);
        const isGst = meta.regionType === 'GST_SUMMARY';
        const isTotals = meta.regionType === 'TOTALS';
        if (isGst && !toggles.gstRegions) return null;
        if (isTotals && !toggles.totalsRegions) return null;
        if (!isGst && !isTotals) return null;
        const stroke = isGst ? COL.gst : COL.totals;
        const fill = isGst ? 'rgba(234,88,12,0.08)' : 'rgba(217,119,6,0.08)';
        return (
          <g key={`cls-${meta.regionIndex}`}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
              opacity={0.95}
            />
            <text
              x={b.x + 4}
              y={b.y + 14}
              fill={stroke}
              fontSize={11}
              fontWeight={600}
              pointerEvents="none"
            >
              {meta.regionType}
            </text>
          </g>
        );
      })}

      {/* Column guides */}
      {toggles.columns &&
        doc.columns.map((c) => (
          <rect
            key={`col-${c.columnIndex}`}
            x={c.minX}
            y={0}
            width={Math.max(1, c.maxX - c.minX)}
            height={pageHeight}
            fill="rgba(22,163,74,0.04)"
            stroke={COL.col}
            strokeWidth={1}
            strokeOpacity={0.5}
          />
        ))}

      {/* Rows (visual only — clicks handled by hit layer after words) */}
      {toggles.rows &&
        doc.rows.map((row) => {
          const b = boundsToSvg(row.bbox);
          const isSel = selectedRowIndex === row.rowIndex;
          const isSusp = suspicious.has(row.rowIndex) && toggles.suspiciousRows;
          const isRej = rejectedRows.has(row.rowIndex) && toggles.rejectedRepairs;
          const isRep = repairedRows.has(row.rowIndex) && toggles.repairedFields;

          let fill = 'transparent';
          let stroke: string = COL.row;
          const sw = isSel ? 3 : 1.5;
          if (isSusp) {
            fill = 'rgba(220,38,38,0.12)';
            stroke = COL.suspicious;
          } else if (isRej) {
            fill = 'rgba(147,51,234,0.1)';
            stroke = COL.rejected;
          } else if (isRep) {
            fill = 'rgba(202,138,4,0.12)';
            stroke = COL.repaired;
          }
          if (isSel) stroke = COL.selected;

          return (
            <rect
              key={`row-v-${row.rowIndex}`}
              x={b.x}
              y={b.y}
              width={Math.max(2, b.w)}
              height={Math.max(2, b.h)}
              fill={fill}
              stroke={stroke}
              strokeWidth={sw}
              opacity={0.95}
              pointerEvents="none"
            />
          );
        })}

      {/* Semantic line → row highlight (when toggled + selected) */}
      {toggles.semanticLinks &&
        selectedRowIndex != null &&
        semantic?.lineItems
          .filter((li) => li.rowIndex === selectedRowIndex)
          .map((li) => {
            const row = doc.rows.find((r) => r.rowIndex === li.rowIndex);
            if (!row) return null;
            const b = boundsToSvg(row.bbox);
            return (
              <rect
                key="sel-semantic"
                x={b.x}
                y={b.y}
                width={Math.max(2, b.w)}
                height={Math.max(2, b.h)}
                fill="none"
                stroke={COL.link}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            );
          })}

      {/* OCR words */}
      {toggles.ocrWords &&
        doc.words.map((w, i) => {
          const b = boundsToSvg(w.bbox);
          const hi = hoveredWordIndex === i;
          return (
            <rect
              key={`w-${i}`}
              x={b.x}
              y={b.y}
              width={Math.max(1, b.w)}
              height={Math.max(1, b.h)}
              fill={hi ? 'rgba(14,165,233,0.2)' : 'transparent'}
              stroke={hi ? COL.wordHi : COL.word}
              strokeWidth={hi ? 1.5 : 0.4}
              opacity={hi ? 1 : 0.45}
              pointerEvents="auto"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={() => onWordEnter(w, i)}
              onMouseLeave={() => onWordLeave()}
            />
          );
        })}

    </g>
  );
}
