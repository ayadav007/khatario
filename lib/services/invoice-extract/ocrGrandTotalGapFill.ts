/**
 * When the LLM returns **too few line items** but `grand_total` matches the real invoice,
 * recover missing plain-GST (0%) rows from Vision OCR: handwritten bills often use `240-00`
 * amounts so rows stay `noise` in layout classification — this pass is text + geometry only.
 */

import type { ExtractedInvoiceLine, IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import {
  looksLikeGrandTotalAnchorLine,
  looksLikeTotalsOrGrandLine,
} from '@/lib/services/invoice-extract/invoiceRegionDetector';
import { looksLikeExchangeOrAdjustmentRow } from '@/lib/services/invoice-extract/ocrLayoutService';
import type { OcrLine } from '@/lib/services/invoice-extract/ocrLineTypes';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function headerTaxSum(e: Pick<IndianGstInvoiceExtract, 'total_cgst' | 'total_sgst' | 'total_igst'>): number {
  return (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
}

function sumPositiveLineTotals(items: ExtractedInvoiceLine[]): number {
  let s = 0;
  for (const it of items) {
    const lt = it.line_total;
    if (lt != null && Number.isFinite(lt) && lt > 0) s = round2(s + lt);
  }
  return s;
}

function amountUsedByItems(items: ExtractedInvoiceLine[], v: number, tol: number): boolean {
  return items.some((it) => {
    const lt = it.line_total;
    if (lt == null || !Number.isFinite(lt) || lt <= 0) return false;
    return Math.abs(lt - v) <= tol;
  });
}

/** Parse `240-00`, `800-0`, or `123.45` tokens. */
function parseMoneyToken(raw: string): number | null {
  const hy = raw.match(/^(\d{1,3}(?:,\d{3})*|\d+)-(\d{1,2})$/);
  if (hy) {
    const whole = parseInt(hy[1].replace(/,/g, ''), 10);
    const frac = parseInt(hy[2], 10);
    if (!Number.isFinite(whole) || !Number.isFinite(frac)) return null;
    return round2(whole + frac / 100);
  }
  const v = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(v) ? round2(v) : null;
}

/** Collect parsed rupee tokens (decimals, `240-00`, bare 3–5 digit groups). */
function collectParsedAmounts(text: string, maxValue: number): number[] {
  const s = text.replace(/\s+/g, ' ').trim();
  const seen = new Set<number>();
  const out: number[] = [];

  const push = (raw: string) => {
    const v = parseMoneyToken(raw);
    if (v == null || v < 1 || v > maxValue) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  let m: RegExpExecArray | null;
  const reDec = /\b(\d{1,3}(?:,\d{3})+|\d{2,5})\.\d{2}\b/g;
  while ((m = reDec.exec(s)) !== null) push(m[0]);

  const reHy = /\b(\d{3,5}-\d{1,2})\b/g;
  while ((m = reHy.exec(s)) !== null) push(m[1]);

  const reBare = /\b(\d{3,5})\b/g;
  while ((m = reBare.exec(s)) !== null) push(m[1]);

  return out;
}

/**
 * Largest money token on the line in `(50, grandTotal]`. If that maximum is already an
 * extracted **line_total**, the row is treated as already captured — do not fall back to a
 * smaller token (often qty × rate like `230` next to `460`).
 */
export function largestUnusedPlausibleTableAmount(
  text: string,
  grandTotal: number,
  usedCheck: (v: number) => boolean
): number | null {
  const vals = collectParsedAmounts(text, grandTotal + 0.01).filter((v) => v >= 50 && v <= grandTotal);
  if (!vals.length) return null;
  const vMax = Math.max(...vals);
  if (usedCheck(vMax)) return null;
  return vMax;
}

function isMostlyNumericGrandLine(text: string, grand: number): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters > 3) return false;
  const vals = collectParsedAmounts(t, grand * 1.01);
  return vals.some((v) => Math.abs(v - grand) <= 1.5);
}

function findGrandTotalBandY(lines: OcrLine[], grand: number): number | null {
  let best: number | null = null;
  for (const ln of lines) {
    const t = ln.text.replace(/\s+/g, ' ').trim();
    if (looksLikeGrandTotalAnchorLine(t) || looksLikeTotalsOrGrandLine(t)) {
      if (best == null || ln.y < best) best = ln.y;
      continue;
    }
    if (/\bRUPEES\s+IN\s+WORD\b/i.test(t)) {
      if (best == null || ln.y < best) best = ln.y;
      continue;
    }
    if (isMostlyNumericGrandLine(t, grand)) {
      if (best == null || ln.y < best) best = ln.y;
    }
  }
  return best;
}

function shouldSkipLineForGapMining(text: string): boolean {
  if (looksLikeTotalsOrGrandLine(text) || looksLikeGrandTotalAnchorLine(text)) return true;
  if (/\bRUPEES\s+IN\s+WORD\b/i.test(text)) return true;
  if (/\bRECEIVER\b|\bSIGNATURE\b|\bAUTHORIZED\b|\bE\.&\s*O\.E\b/i.test(text)) return true;
  if (/\bWWW\.|HTTP:\/\/|HTTPS:\/\//i.test(text)) return true;
  if (looksLikeExchangeOrAdjustmentRow(text)) return true;
  return false;
}

function lineHasDescriptionSignal(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  if (/\d+\s*\)/.test(t)) return true;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return letters >= 3;
}

export interface OcrGapFillCandidate {
  amount: number;
  description: string;
  y: number;
}

/**
 * Build one amount candidate per OCR row (clustering split continuation lines with the same amount).
 */
export function buildPlainTableGapCandidates(
  propagated: OcrLine[],
  grandTotal: number,
  items: ExtractedInvoiceLine[]
): OcrGapFillCandidate[] {
  const tol = 1.5;
  const used = (v: number) => amountUsedByItems(items, v, tol);
  const yBand = findGrandTotalBandY(propagated, grandTotal);
  const sorted = [...propagated].sort((a, b) => a.y - b.y);

  const out: OcrGapFillCandidate[] = [];
  const CLUSTER_PX = 30;

  for (const ln of sorted) {
    if (yBand != null && ln.y >= yBand - 4) continue;
    const raw = ln.text.replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > 220) continue;
    if (shouldSkipLineForGapMining(raw)) continue;
    if (!lineHasDescriptionSignal(raw)) continue;

    const amt = largestUnusedPlausibleTableAmount(raw, grandTotal, used);
    if (amt == null) continue;

    const desc = raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(ln.y - prev.y) <= CLUSTER_PX &&
      Math.abs(prev.amount - amt) <= 0.05
    ) {
      prev.description = `${prev.description} ${desc}`.replace(/\s+/g, ' ').trim().slice(0, 160);
      prev.y = ln.y;
      continue;
    }
    out.push({ amount: amt, description: desc, y: ln.y });
  }
  return out;
}

function subsetSumMatchIndices(amounts: number[], target: number, eps = 0.51): number[] | null {
  const n = amounts.length;
  if (n === 0 || n > 22) return null;
  const want = round2(target);
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        s = round2(s + amounts[i]);
        idx.push(i);
      }
    }
    if (Math.abs(s - want) <= eps) return idx;
  }
  return null;
}

/**
 * Append 0%-GST lines mined from OCR when **sum(line_total)** is below **grand_total** and
 * header tax is negligible (plain cash / unregistered bills).
 */
export function mergeMissingPlainLinesFromOcrGrandTotalGap(
  items: ExtractedInvoiceLine[],
  propagated: OcrLine[],
  extract: Pick<
    IndianGstInvoiceExtract,
    'grand_total' | 'total_cgst' | 'total_sgst' | 'total_igst' | 'round_off' | 'price_mode' | 'tax_type'
  >
): ExtractedInvoiceLine[] {
  const grand = extract.grand_total;
  if (grand == null || !Number.isFinite(grand) || grand <= 0) return items;

  if (items.some((it) => (it.line_total ?? 0) < -0.5)) return items;

  const taxH = headerTaxSum(extract);
  if (taxH > 0.75) return items;

  if (items.some((it) => (it.gst_rate ?? 0) > 0.5)) return items;

  const sumLt = sumPositiveLineTotals(items);
  const ro = extract.round_off ?? 0;
  const delta = round2(grand - sumLt - ro);
  const tol = Math.max(4, grand * 0.025);
  if (delta <= tol) return items;
  if (delta > 120_000) return items;

  const cands = buildPlainTableGapCandidates(propagated, grand, items);
  if (!cands.length) return items;

  const amounts = cands.map((c) => c.amount);
  const pick = subsetSumMatchIndices(amounts, delta);
  if (!pick || pick.length === 0) return items;

  const out = [...items];
  const priceMode = extract.price_mode ?? 'exclusive';
  for (const i of pick) {
    const { amount, description } = cands[i]!;
    if (amountUsedByItems(out, amount, 1.5)) continue;
    out.push({
      description: description || 'Line (recovered from invoice OCR)',
      hsn_code: null,
      qty: 1,
      unit: 'PCS',
      rate: amount,
      discount_amount: null,
      gst_rate: 0,
      tax_mode: extract.tax_type === 'igst' ? 'exclusive' : priceMode,
      taxable_value: amount,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
      line_total: amount,
      discount_on_tax_inclusive: false,
    });
  }
  return out;
}
