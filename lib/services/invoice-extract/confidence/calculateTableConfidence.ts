import type { ExtractedInvoiceLine, IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

import { calculateFieldConfidence } from './calculateFieldConfidence';
import { combineConfidenceBreakdown } from './combine';
import type { ConfidenceBreakdown4, InvoiceConfidenceContext, TableConfidenceResult } from './types';
import {
  computeHistoricalPillar,
  computeInvoiceValidationPillar,
  computeOcrPillar,
  computeSemanticPillar,
} from './scores';

const LINE_FIELDS = ['qty', 'rate', 'line_total', 'gst_rate'] as const;

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function breakdownMean(xs: TableConfidenceResult['lines']): ConfidenceBreakdown4 {
  return {
    ocr: mean(xs.map((x) => x.confidence_breakdown.ocr)),
    validation: mean(xs.map((x) => x.confidence_breakdown.validation)),
    historical: mean(xs.map((x) => x.confidence_breakdown.historical)),
    semantic: mean(xs.map((x) => x.confidence_breakdown.semantic)),
  };
}

function linePrimitive(row: ExtractedInvoiceLine, k: (typeof LINE_FIELDS)[number]): unknown {
  if (k === 'line_total') return row.line_total;
  if (k === 'gst_rate') return row.gst_rate;
  return (row as unknown as Record<string, unknown>)[k];
}

/**
 * Confidence over line items — one composite per merchandise row plus a rolled-up table score.
 */
export function calculateTableConfidence(
  extract: IndianGstInvoiceExtract,
  ctx: InvoiceConfidenceContext,
): TableConfidenceResult {
  const items = extract.items ?? [];

  const lines =
    items.length === 0 ?
      []
    : items.map((row, i) => {
        const segments = LINE_FIELDS.map((k) =>
          calculateFieldConfidence(`items.${i}.${k}`, linePrimitive(row, k), extract, ctx),
        );
        const confidence_breakdown = breakdownMean(segments);
        return {
          value: row,
          confidence: combineConfidenceBreakdown(confidence_breakdown),
          confidence_breakdown,
        };
      });

  let weakest_line_index: number | null = null;
  let minC = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.confidence;
    if (c < minC) {
      minC = c;
      weakest_line_index = i;
    }
  }
  if (lines.length === 0) minC = Infinity;

  const confidence_breakdown: ConfidenceBreakdown4 =
    lines.length ?
      breakdownMean(lines)
    : {
        ocr: computeOcrPillar({ spatial: ctx.spatial, ocrGstSummary: ctx.ocrGstSummary }),
        validation: Math.max(
          0.22,
          computeInvoiceValidationPillar(extract, ctx.gstPropagation ?? null) - 0.28,
        ),
        historical: computeHistoricalPillar(ctx.historical),
        semantic: computeSemanticPillar(
          extract,
          ctx.semanticLines ?? undefined,
          ctx.headerAlignmentScore ?? undefined,
        ),
      };

  return {
    confidence: combineConfidenceBreakdown(confidence_breakdown),
    confidence_breakdown,
    line_count: lines.length,
    weakest_line_index: weakest_line_index,
    lines,
  };
}
