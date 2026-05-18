/**
 * Validates OCR-propagated GST against footer `gst_summary` and flags impossible pairs.
 */

import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import type { OcrGstPropagationDebug } from './gstPropagationEngine';

export interface GstValidationIssue {
  code: string;
  message: string;
  severity: 'warning' | 'error';
  /** Optional item index for line-level warnings */
  itemIndex?: number;
}

export interface GstValidationResult {
  ok: boolean;
  confidence: number;
  /** 0–1 rough confidence from aggregate checks */
  issues: GstValidationIssue[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compare summed line implied taxable (by gst_rate + line_total) to gst_summary slabs — soft check.
 */
export function validateGstExtractAgainstOcr(
  extract: IndianGstInvoiceExtract,
  propagation: OcrGstPropagationDebug | null
): GstValidationResult {
  const issues: GstValidationIssue[] = [];
  let confidence = 0.75;

  if (propagation?.overrides?.length) {
    confidence += 0.1;
  }

  if (propagation?.trace?.footerIgnoredHeaders?.length) {
    confidence += 0.03;
  }

  if (propagation?.trace?.detectedHeaders?.length) {
    confidence += 0.02;
  }

  const slabs = extract.gst_summary ?? [];
  if (!slabs.length) {
    issues.push({
      code: 'no_footer_slab',
      message: 'No gst_summary rows — cannot cross-check section GST against footer.',
      severity: 'warning',
    });
    confidence -= 0.05;
  }

  /** Sum line totals bucketed by gst_rate */
  const bucket = new Map<number, { sumLt: number; count: number }>();
  for (let i = 0; i < (extract.items?.length ?? 0); i++) {
    const it = extract.items[i];
    const r = it.gst_rate != null && it.gst_rate >= 0 ? round2(it.gst_rate as number) : 0;
    const lt = it.line_total;
    if (lt == null || !Number.isFinite(lt) || lt <= 0) continue;
    const cur = bucket.get(r) || { sumLt: 0, count: 0 };
    cur.sumLt += lt;
    cur.count += 1;
    bucket.set(r, cur);
  }

  for (const row of slabs) {
    const r = row.gst_rate;
    const tv = row.taxable_value;
    const b = bucket.get(r);
    if (!b || r <= 0) continue;
    const impliedTaxable = b.sumLt / (1 + r / 100);
    const tol = Math.max(5, Math.abs(tv) * 0.04);
    if (Math.abs(impliedTaxable - tv) > tol && b.count > 0) {
      issues.push({
        code: 'slab_taxable_mismatch',
        message: `Slab ${r}%: footer taxable ${tv} vs ~${round2(impliedTaxable)} implied from line totals (tol ${tol}).`,
        severity: 'warning',
      });
      confidence -= 0.08;
    }
  }

  /** Propagation vs previous LLM rate — informational */
  for (const o of propagation?.overrides ?? []) {
    if (o.fromRate != null && o.fromRate > 0 && Math.abs(o.fromRate - o.toRate) >= 5) {
      issues.push({
        code: 'large_rate_revision',
        message: `Item ${o.index + 1}: GST rate revised from ${o.fromRate}% to ${o.toRate}% (${o.reason}).`,
        severity: 'warning',
        itemIndex: o.index,
      });
    }
  }

  confidence = Math.max(0, Math.min(1, confidence));
  return {
    ok: issues.filter((x) => x.severity === 'error').length === 0,
    confidence: round2(confidence),
    issues,
  };
}
