/**
 * Extracts HSN-code → GST-rate annotations from raw OCR text.
 *
 * Indian marketplace invoices (Myntra, Meesho, Flipkart, Amazon) annotate GST rates
 * directly on the HSN line, e.g.:
 *   "HSN 61119090, 5.0% IGST"
 *   "HSN: 62091000, 12% GST"
 *   "HSN/SAC 9983, IGST @ 18%"
 *
 * These annotations are the authoritative source for GST rate per item.
 * They are injected into the Groq prompt so the model doesn't invent rates
 * by back-calculating from scrambled column numbers.
 *
 * After LLM extraction, `applyHsnRateAnnotations` applies them as a deterministic
 * override when the model's extracted rate diverges from the annotation.
 */

import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

export interface HsnRateAnnotation {
  hsnCode: string;
  gstRate: number;
  taxType: 'igst' | 'cgst_sgst' | null;
  rawMatch: string;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/**
 * Regex patterns for "HSN XXXXXXXX, X.X% IGST/GST" style annotations.
 * Also handles "HSN/SAC XXXX @ 18%" and "IGST @ 5%" without explicit HSN.
 */
const HSN_RATE_PATTERNS: RegExp[] = [
  // "HSN 61119090, 5.0% IGST"  or  "HSN: 61119090 5.0% IGST"
  /\bHSN[\/\s:]*(\d{4,8})[,.\s]+(\d+(?:\.\d+)?)\s*%\s*(IGST|GST|CGST|SGST)/gi,
  // "HSN 61119090  IGST @ 5%"
  /\bHSN[\/\s:]*(\d{4,8})\s+(?:IGST|GST|CGST|SGST)\s*@\s*(\d+(?:\.\d+)?)\s*%/gi,
  // "HSN/SAC 9983, 18% GST"
  /\bHSN\/SAC\s*:?\s*(\d{4,8})[,.\s]+(\d+(?:\.\d+)?)\s*%\s*(IGST|GST|CGST|SGST)/gi,
];

/** Loose pattern to catch "IGST @ X%" or "5% IGST" without an HSN code (applies to all items) */
const STANDALONE_RATE_PATTERNS: RegExp[] = [
  /\bIGST\s*@\s*(\d+(?:\.\d+)?)\s*%/gi,
  /(\d+(?:\.\d+)?)\s*%\s*IGST\b/gi,
  /\bGST\s*@\s*(\d+(?:\.\d+)?)\s*%/gi,
  /(\d+(?:\.\d+)?)\s*%\s*GST\b/gi,
];

function taxTypeFromMatch(s: string | undefined): 'igst' | 'cgst_sgst' | null {
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === 'IGST') return 'igst';
  if (u === 'CGST' || u === 'SGST' || u === 'GST') return 'cgst_sgst';
  return null;
}

function snapToStandardSlab(rate: number): number {
  const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
  let best = rate;
  let bestDist = Infinity;
  for (const s of SLABS) {
    const d = Math.abs(rate - s);
    if (d < bestDist && d <= 2) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Extract all HSN→rate annotations from raw OCR text.
 * Returns a deduplicated list; if the same HSN appears with multiple rates, keep the first.
 */
export function extractHsnRateAnnotations(ocrText: string): HsnRateAnnotation[] {
  const seen = new Map<string, HsnRateAnnotation>();

  for (const pattern of HSN_RATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(ocrText)) !== null) {
      const hsn = (m[1] ?? '').replace(/\D/g, '');
      const rawRate = parseFloat(m[2] ?? '0');
      const taxLabel = m[3] ?? m[4];
      if (!hsn || !Number.isFinite(rawRate) || rawRate <= 0) continue;
      const gstRate = snapToStandardSlab(rawRate);
      const key = hsn;
      if (!seen.has(key)) {
        seen.set(key, {
          hsnCode: hsn,
          gstRate,
          taxType: taxTypeFromMatch(taxLabel),
          rawMatch: m[0].trim(),
        });
      }
    }
  }

  return [...seen.values()];
}

/**
 * Extract standalone rate annotations from OCR text (no HSN code).
 * Used when all items share the same GST rate or to build a fallback rate hint.
 * Returns the most common / most explicit rate found, or null.
 */
export function extractStandaloneRateAnnotation(
  ocrText: string,
): { gstRate: number; taxType: 'igst' | 'cgst_sgst' | null } | null {
  const rates: { rate: number; taxType: 'igst' | 'cgst_sgst' | null }[] = [];

  // First check explicit "X.X% IGST" patterns (highest confidence)
  const igstPattern = /(\d+(?:\.\d+)?)\s*%\s*IGST\b/gi;
  igstPattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = igstPattern.exec(ocrText)) !== null) {
    const r = parseFloat(m[1]);
    if (r > 0 && r <= 40) rates.push({ rate: snapToStandardSlab(r), taxType: 'igst' });
  }

  const igstAt = /\bIGST\s*@\s*(\d+(?:\.\d+)?)\s*%/gi;
  igstAt.lastIndex = 0;
  while ((m = igstAt.exec(ocrText)) !== null) {
    const r = parseFloat(m[1]);
    if (r > 0 && r <= 40) rates.push({ rate: snapToStandardSlab(r), taxType: 'igst' });
  }

  if (!rates.length) return null;

  // Pick most frequent rate
  const freq = new Map<number, { count: number; taxType: 'igst' | 'cgst_sgst' | null }>();
  for (const { rate, taxType } of rates) {
    const existing = freq.get(rate);
    if (existing) existing.count++;
    else freq.set(rate, { count: 1, taxType });
  }
  let bestRate = 0;
  let bestCount = 0;
  let bestTaxType: 'igst' | 'cgst_sgst' | null = null;
  for (const [rate, { count, taxType }] of freq) {
    if (count > bestCount) {
      bestCount = count;
      bestRate = rate;
      bestTaxType = taxType;
    }
  }
  return bestRate > 0 ? { gstRate: bestRate, taxType: bestTaxType } : null;
}

/**
 * Format HSN rate annotations as a concise hint block for the Groq prompt.
 */
export function formatHsnRateHintBlock(
  hsnAnnotations: HsnRateAnnotation[],
  standaloneRate: { gstRate: number; taxType: 'igst' | 'cgst_sgst' | null } | null,
): string {
  const lines: string[] = [];
  lines.push('=== ITEM GST RATES (extracted from HSN annotations in OCR — authoritative) ===');
  lines.push('CRITICAL: Use these rates for line-item gst_rate. Do NOT override with back-calculated values.');

  if (hsnAnnotations.length) {
    for (const a of hsnAnnotations) {
      const tt = a.taxType === 'igst' ? 'IGST' : a.taxType === 'cgst_sgst' ? 'CGST+SGST' : 'GST';
      lines.push(`  HSN ${a.hsnCode}: gst_rate = ${a.gstRate}% (${tt}) — from OCR: "${a.rawMatch}"`);
    }
  }

  if (standaloneRate && !hsnAnnotations.length) {
    const tt = standaloneRate.taxType === 'igst' ? 'IGST' : standaloneRate.taxType === 'cgst_sgst' ? 'CGST+SGST' : 'GST';
    lines.push(`  All items: gst_rate = ${standaloneRate.gstRate}% (${tt}) — from OCR annotation`);
  }

  if (!hsnAnnotations.length && !standaloneRate) {
    return '';
  }

  lines.push('=== END GST RATES ===');
  return lines.join('\n');
}

// ─── Post-extraction repair ───────────────────────────────────────────────────

/**
 * Deterministic post-extraction repair: apply HSN annotation rates to items
 * where the model extracted a different rate.
 *
 * Also fixes the common "IGST amount confused with taxable_value" swap on single-item
 * marketplace invoices: if an item's `igst_amount` equals the taxable column value and
 * the extracted gst_rate is wrong, compute and swap.
 */
export function applyHsnRateAnnotationsToExtract(
  e: IndianGstInvoiceExtract,
  hsnAnnotations: HsnRateAnnotation[],
  standaloneRate: { gstRate: number; taxType: 'igst' | 'cgst_sgst' | null } | null,
  ocrText: string,
): { patched: IndianGstInvoiceExtract; notes: string[] } {
  const notes: string[] = [];

  if (!e.items?.length) return { patched: e, notes };

  const out = JSON.parse(JSON.stringify(e)) as IndianGstInvoiceExtract;

  // Build HSN→rate lookup
  const hsnLookup = new Map<string, HsnRateAnnotation>();
  for (const a of hsnAnnotations) {
    hsnLookup.set(a.hsnCode, a);
  }

  // ── Step 1: Fix GST rate per item from annotations ─────────────────────────
  for (const item of out.items) {
    const hsn = (item.hsn_code ?? '').replace(/\D/g, '');
    const annotation = hsn ? hsnLookup.get(hsn) : null;
    const annotatedRate = annotation?.gstRate ?? standaloneRate?.gstRate ?? null;
    const annotatedTaxType = annotation?.taxType ?? standaloneRate?.taxType ?? null;

    if (annotatedRate != null && annotatedRate > 0) {
      const currentRate = item.gst_rate ?? 0;
      if (Math.abs(currentRate - annotatedRate) > 0.5) {
        notes.push(
          `HSN ${hsn || '?'}: corrected gst_rate ${currentRate}% → ${annotatedRate}% (from OCR annotation)`,
        );
        item.gst_rate = annotatedRate;

        if (annotatedTaxType === 'igst' && out.tax_type !== 'igst') {
          out.tax_type = 'igst';
          notes.push('Set tax_type = igst from HSN annotation');
        }
      }
    }
  }

  // ── Step 2: Fix marketplace "IGST-amount/taxable-value swap" on single-item invoices ─
  // Pattern: Gross Amount (MRP) | Discount | Taxable Amount | IGST | Case Total
  // Model often maps Taxable → igst_amount and IGST → something else.
  // Detection: igst_amount is much larger than it should be given gst_rate.
  if (out.items.length === 1 && out.grand_total != null && out.grand_total > 0) {
    const item = out.items[0];
    const rate = item.gst_rate ?? 0;

    if (rate > 0 && item.igst_amount != null && item.igst_amount > 0) {
      // Expected IGST = taxable * rate/100
      const expectedFromTaxable =
        item.taxable_value != null && item.taxable_value > 0
          ? (item.taxable_value * rate) / 100
          : null;

      // If the extracted igst_amount is way too large for the given rate, check if swapped
      if (
        expectedFromTaxable != null &&
        Math.abs(item.igst_amount - expectedFromTaxable) > Math.max(2, item.igst_amount * 0.3)
      ) {
        // Check if igst_amount is actually the taxable value (i.e., it equals grand_total / (1+rate/100))
        const impliedTaxable = (out.grand_total * 100) / (100 + rate);
        const impliedIgst = out.grand_total - impliedTaxable;

        const swapWorks =
          Math.abs(impliedTaxable + impliedIgst - out.grand_total) <= 1 &&
          Math.abs(impliedIgst - (impliedTaxable * rate) / 100) <= 1;

        if (swapWorks && Math.abs(item.igst_amount - impliedTaxable) < Math.abs(item.igst_amount - impliedIgst)) {
          notes.push(
            `Single-item swap fix: igst_amount ${item.igst_amount} → ${Math.round(impliedIgst * 100) / 100}; taxable_value → ${Math.round(impliedTaxable * 100) / 100}`,
          );
          item.taxable_value = Math.round(impliedTaxable * 100) / 100;
          item.igst_amount = Math.round(impliedIgst * 100) / 100;
          item.cgst_amount = null;
          item.sgst_amount = null;
          item.line_total = out.grand_total;
        }
      }
    }
  }

  // ── Step 3: Fix header totals when grand_total from OCR doesn't match extracted ─
  // Look for a "Case Total Amount" or net payable in OCR that matches known values
  const grandInOcr = extractGrandTotalFromOcr(ocrText);
  if (
    grandInOcr != null &&
    out.grand_total != null &&
    Math.abs(grandInOcr - out.grand_total) > 2 &&
    grandInOcr > 0
  ) {
    // Validate grand from OCR: subtotal + tax ≈ grandInOcr?
    const rate = out.items[0]?.gst_rate ?? 0;
    if (rate > 0) {
      const impliedTaxable = (grandInOcr * 100) / (100 + rate);
      const impliedTax = grandInOcr - impliedTaxable;

      notes.push(
        `Grand total corrected from OCR: ${out.grand_total} → ${grandInOcr} (taxable=${Math.round(impliedTaxable * 100) / 100}, igst=${Math.round(impliedTax * 100) / 100})`,
      );
      out.grand_total = grandInOcr;

      if (out.items.length === 1) {
        const item = out.items[0];
        item.taxable_value = Math.round(impliedTaxable * 100) / 100;
        item.igst_amount = out.tax_type === 'igst' ? Math.round(impliedTax * 100) / 100 : null;
        item.cgst_amount = out.tax_type === 'cgst_sgst' ? Math.round(impliedTax / 2 * 100) / 100 : null;
        item.sgst_amount = out.tax_type === 'cgst_sgst' ? Math.round(impliedTax / 2 * 100) / 100 : null;
        item.line_total = grandInOcr;
      }

      out.subtotal = Math.round(impliedTaxable * 100) / 100;
      if (out.tax_type === 'igst') {
        out.total_igst = Math.round(impliedTax * 100) / 100;
        out.total_cgst = null;
        out.total_sgst = null;
      } else {
        out.total_cgst = Math.round(impliedTax / 2 * 100) / 100;
        out.total_sgst = Math.round(impliedTax / 2 * 100) / 100;
        out.total_igst = null;
      }
    }
  }

  return { patched: out, notes };
}

/**
 * Try to extract the actual payable grand total from OCR text.
 * Looks for patterns like "Rs 512.00", "Total Rs 512", checking against
 * the minimum amount found (e.g. the grand total is usually smaller than the MRP gross).
 */
function extractGrandTotalFromOcr(ocrText: string): number | null {
  // Find all currency amounts in the OCR
  const amounts: number[] = [];
  const RE = /(?:Rs\.?\s*|₹\s*)(\d{1,6}(?:[,\s]\d{3})*(?:\.\d{2})?|\d+\.\d{2})/gi;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(ocrText)) !== null) {
    const n = parseFloat(m[1].replace(/[,\s]/g, ''));
    if (Number.isFinite(n) && n > 0) amounts.push(n);
  }

  if (!amounts.length) return null;

  // The "Case Total Amount" or "Total" at end of line typically appears last in sequence
  // Heuristic: look for the smallest non-trivial amount that appears after "Total" keyword
  const totalIdx = ocrText.toUpperCase().lastIndexOf('TOTAL');
  if (totalIdx >= 0) {
    const afterTotal = ocrText.slice(totalIdx);
    const RE2 = /(?:Rs\.?\s*|₹\s*)(\d{1,6}(?:[,\s]\d{3})*(?:\.\d{2})?|\d+\.\d{2})/gi;
    RE2.lastIndex = 0;
    const postAmounts: number[] = [];
    while ((m = RE2.exec(afterTotal)) !== null) {
      const n = parseFloat(m[1].replace(/[,\s]/g, ''));
      if (Number.isFinite(n) && n > 10) postAmounts.push(n);
    }
    // The last distinct amount after TOTAL is often the grand total
    if (postAmounts.length >= 2) {
      return postAmounts[postAmounts.length - 1];
    }
  }

  return null;
}
