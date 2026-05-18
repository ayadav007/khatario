/**
 * Deterministic GST summary band extraction (CGST/SGST/IGST slabs, taxable amounts).
 * Output is meant for reconciliation engines — not merchandise line construction.
 */

import { nearestGstRate } from '@/lib/indian-gst-invoice-extract';
import type { InvoiceSpatialDocument } from './ocrSpatialParser';
import { rowRawTextSpatial } from './ocrSpatialParser';
import { parseNumericCell } from './numericColumnInterpreter';
import type { ClassifiedTableRegionMeta, GstSummaryRegionExtract } from './semanticInvoiceTypes';

/** Pull bracket-style percents e.g. `(18%)`, `18 %`. */
function gstPercentsFromText(raw: string): number[] {
  const out: number[] = [];
  for (const m of raw.matchAll(/\(?(\d{1,2}(?:\.\d+)?)\s*%/g)) {
    const v = parseFloat(m[1]!);
    if (Number.isFinite(v)) out.push(nearestGstRate(v));
  }
  return out;
}

export function parseGstSummaryRegion(
  doc: InvoiceSpatialDocument,
  classified: ClassifiedTableRegionMeta
): GstSummaryRegionExtract {
  const rows = classified.rowIndices.map((i) => doc.rows[i]!).filter(Boolean);
  const parsedRows: GstSummaryRegionExtract['rows'] = [];

  for (const row of rows) {
    const raw = rowRawTextSpatial(row);
    const parsedAmounts: number[] = [];
    for (const w of row.words) {
      const n = parseNumericCell(w.text);
      if (n != null && Math.abs(n) > 1e-9) parsedAmounts.push(n);
    }
    parsedRows.push({
      rowIndex: row.rowIndex,
      rawText: raw,
      parsedAmounts,
      inferredGstPercents: gstPercentsFromText(raw),
    });
  }

  return {
    regionIndex: classified.regionIndex,
    bbox: classified.bbox,
    rows: parsedRows,
  };
}
