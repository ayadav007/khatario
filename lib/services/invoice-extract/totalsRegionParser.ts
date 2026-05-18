/**
 * Footer / totals band extraction — grand total, subtotal, round-off (deterministic).
 */

import type { InvoiceSpatialDocument } from './ocrSpatialParser';
import { rowRawTextSpatial } from './ocrSpatialParser';
import { parseNumericCell } from './numericColumnInterpreter';
import type { ClassifiedTableRegionMeta, TotalsRegionExtract } from './semanticInvoiceTypes';

const RE_GRAND = /\bGRAND\s+TOTAL\b|\bTOTAL\s+DUE\b|\bNET\s+PAY\b|\bNET\s+AMOUNT\b|\bAMOUNT\s+PAYABLE\b/i;
const RE_SUB = /\bSUB\s*TOTAL\b|\bSUBTOTAL\b|\bTAXABLE\s+VALUE\b|\bTOTAL\s+BEFORE\b/i;
const RE_ROUND = /\bROUND\s*(OFF)?\b|\bROUNDING\b/i;
const RE_BALANCE = /\bBALANCE\s+DUE\b|\bOUTSTANDING\b/i;
const RE_TAX_LINE =
  /\bTOTAL\s+GST\b|\bTOTAL\s+TAX\b|\bCGST\b|\bSGST\b|\bIGST\b|\bVAT\b|\bSALES\s+TAX\b|\bSTATE\s+TAX\b|\bUSE\s+TAX\b|\bTAX\s+AMOUNT\b|\bGST\b(?!\s+SUMMARY)/i;

function classifyTotalsKind(raw: string): TotalsRegionExtract['lines'][0]['kind'] {
  const u = raw.toUpperCase();
  if (RE_GRAND.test(u)) return 'grand_total';
  if (RE_SUB.test(u)) return 'subtotal';
  if (RE_ROUND.test(u)) return 'round_off';
  if (RE_BALANCE.test(u)) return 'balance';
  if (RE_TAX_LINE.test(u)) return 'tax';
  return 'other';
}

/** Prefer the right-most / last money token on the line (labels on the left). */
function pickTrailingAmount(raw: string): number | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const v = parseNumericCell(parts[i]!);
    if (v != null && Math.abs(v) > 1e-9) return v;
  }
  const v = parseNumericCell(raw);
  return v ?? undefined;
}

export function parseTotalsRegion(
  doc: InvoiceSpatialDocument,
  classified: ClassifiedTableRegionMeta
): TotalsRegionExtract {
  const rows = classified.rowIndices.map((i) => doc.rows[i]!).filter(Boolean);
  const lines: TotalsRegionExtract['lines'] = [];

  for (const row of rows) {
    const raw = rowRawTextSpatial(row);
    if (!raw) continue;
    lines.push({
      rowIndex: row.rowIndex,
      rawText: raw,
      kind: classifyTotalsKind(raw),
      amount: pickTrailingAmount(raw),
    });
  }

  return {
    regionIndex: classified.regionIndex,
    bbox: classified.bbox,
    lines,
  };
}
