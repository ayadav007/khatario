/**
 * Deterministic GST section propagation: slab from nearest preceding **accepted** header
 * onto product lines. No LLM. Uses geometry (footer guard) + confidence scoring.
 */

import type { ExtractedInvoiceLine, IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import { parseHeaderGstRate } from './gstHeaderParser';
import {
  DEFAULT_GST_HEADER_CONFIDENCE_THRESHOLD,
  scoreGstHeaderLikelihood,
  type GstHeaderScoreContext,
} from './gstHeaderHeuristics';
import {
  detectInvoiceRegionsFromOcrLines,
  isFooterRegion,
  looksLikeGrandTotalAnchorLine,
} from './invoiceRegionDetector';
import { mergeMissingPlainLinesFromOcrGrandTotalGap } from './ocrGrandTotalGapFill';
import { classifyOcrLineKind, inferPageHeightFromOcrLines, isLikelyProductRowText, looksLikeExchangeOrAdjustmentRow } from './ocrLayoutService';
import type { OcrLine } from './ocrLineTypes';

export interface GstPropagationTrace {
  detectedHeaders: Array<{
    lineIndex: number;
    text: string;
    rate: number;
    confidence: number;
  }>;
  rejectedHeaders: Array<{
    lineIndex: number;
    text: string;
    reason: string;
    confidence: number;
  }>;
  footerIgnoredHeaders: Array<{ lineIndex: number; text: string; reason: string }>;
  propagationSteps: Array<{ lineIndex: number; action: string; rate: number | null }>;
}

export interface AssignSectionGstOptions {
  pageHeight: number;
  /** Min score to treat line as section header (default 0.58) */
  minHeaderConfidence?: number;
}

export interface OcrGstPropagationDebug {
  lines: Array<{
    text: string;
    y: number;
    x: number;
    width?: number;
    height?: number;
    kind: string;
    assignedSectionGstRate: number | null;
  }>;
  overrides: Array<{ index: number; fromRate: number | null; toRate: number; reason: string }>;
  trace?: GstPropagationTrace;
}

function trimLine(t: string): string {
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/**
 * Core engine: walk OCR lines top-to-bottom, set `currentRate` on accepted headers,
 * assign `assignedSectionGstRate` on product rows. Footer GST summaries do **not**
 * update `currentRate`.
 */
export function assignSectionGstRates(
  lines: OcrLine[],
  options: AssignSectionGstOptions
): { lines: OcrLine[]; trace: GstPropagationTrace } {
  const ph = options.pageHeight > 0 ? options.pageHeight : 1;
  const threshold = options.minHeaderConfidence ?? DEFAULT_GST_HEADER_CONFIDENCE_THRESHOLD;
  const regions = detectInvoiceRegionsFromOcrLines(lines, ph);
  const scoreCtx: GstHeaderScoreContext = { pageHeight: ph, regions };

  const trace: GstPropagationTrace = {
    detectedHeaders: [],
    rejectedHeaders: [],
    footerIgnoredHeaders: [],
    propagationSteps: [],
  };

  let currentRate: number | null = null;
  /** After a printed grand-total anchor, slab GST lines are treated like footer summaries. */
  let afterGrandTotal = false;
  const out: OcrLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (looksLikeGrandTotalAnchorLine(text)) afterGrandTotal = true;

    const parsed = parseHeaderGstRate(text);
    const inFooter = isFooterRegion(line, ph);

    /**
     * Hard block: never advance `currentRate` for footer GST tables **or** for GST-looking
     * lines after a grand-total anchor (common on thermal bills above the physical footer).
     */
    const headerPropagationBlock = parsed != null && (inFooter || afterGrandTotal);
    if (headerPropagationBlock) {
      trace.footerIgnoredHeaders.push({
        lineIndex: i,
        text: trimLine(text),
        reason: inFooter ? 'footer_gst_summary_or_breakdown' : 'post_grand_total_gst_line',
      });
      trace.propagationSteps.push({
        lineIndex: i,
        action: inFooter ? 'footer_block_header' : 'post_grand_total_block_header',
        rate: null,
      });
      const isProduct =
        isLikelyProductRowText(text) || line.kind === 'item' || classifyOcrLineKind(text) === 'item';
      out.push({
        ...line,
        kind: isProduct ? 'item' : line.kind === 'gst_header' ? 'noise' : line.kind ?? 'noise',
        assignedSectionGstRate: isProduct ? currentRate : null,
      });
      continue;
    }

    if (parsed != null) {
      const conf = scoreGstHeaderLikelihood(line, scoreCtx);
      const productDisguise = isLikelyProductRowText(text);

      if (!productDisguise && conf >= threshold) {
        currentRate = parsed;
        trace.detectedHeaders.push({
          lineIndex: i,
          text: trimLine(text),
          rate: parsed,
          confidence: Math.round(conf * 1000) / 1000,
        });
        trace.propagationSteps.push({ lineIndex: i, action: 'accept_header', rate: parsed });
        out.push({ ...line, kind: 'gst_header', assignedSectionGstRate: null });
        continue;
      }

      trace.rejectedHeaders.push({
        lineIndex: i,
        text: trimLine(text),
        reason: productDisguise ? 'product_shape' : 'low_confidence',
        confidence: Math.round(conf * 1000) / 1000,
      });
      trace.propagationSteps.push({
        lineIndex: i,
        action: 'reject_header_candidate',
        rate: parsed,
      });
    }

    const isProduct =
      isLikelyProductRowText(text) ||
      line.kind === 'item' ||
      (line.kind !== 'gst_header' && classifyOcrLineKind(text) === 'item');

    if (isProduct) {
      let slab = currentRate;
      if (looksLikeExchangeOrAdjustmentRow(text)) slab = 0;
      trace.propagationSteps.push({
        lineIndex: i,
        action: 'assign_item',
        rate: slab,
      });
      out.push({
        ...line,
        kind: 'item',
        assignedSectionGstRate: slab,
      });
    } else {
      trace.propagationSteps.push({ lineIndex: i, action: 'skip_non_item', rate: null });
      out.push({
        ...line,
        kind: line.kind && line.kind !== 'gst_header' ? line.kind : 'noise',
        assignedSectionGstRate: null,
      });
    }
  }

  backfillSlabFromFollowingTaxLine(out, trace, scoreCtx, threshold);

  return { lines: out, trace };
}

/**
 * E‑invoices often print the main table row **before** the `IGST : 18%` label. After the
 * forward pass, fill null slabs from the next confident tax line within a short window.
 */
function backfillSlabFromFollowingTaxLine(
  out: OcrLine[],
  trace: GstPropagationTrace,
  scoreCtx: GstHeaderScoreContext,
  threshold: number
): void {
  const maxLook = 55;
  for (let i = 0; i < out.length; i++) {
    const L = out[i];
    if (L.kind !== 'item' || L.assignedSectionGstRate != null) continue;
    if (looksLikeExchangeOrAdjustmentRow(L.text)) continue;

    let picked: number | null = null;
    for (let k = i + 1; k < Math.min(out.length, i + maxLook); k++) {
      const cand = out[k];
      const t = cand.text.replace(/\s+/g, ' ').trim();
      const pr = parseHeaderGstRate(t);
      if (pr == null) continue;
      if (isLikelyProductRowText(t)) continue;
      const conf = scoreGstHeaderLikelihood(cand, scoreCtx);
      if (conf >= threshold) {
        picked = pr;
        break;
      }
    }
    if (picked != null) {
      L.assignedSectionGstRate = picked;
      trace.propagationSteps.push({
        lineIndex: i,
        action: 'backfill_from_following_tax_label',
        rate: picked,
      });
    }
  }
}

/** @deprecated Use assignSectionGstRates — kept for callers expecting old name */
export function propagateGstRatesOnOcrLines(lines: OcrLine[], pageHeight?: number): OcrLine[] {
  const ph =
    pageHeight && pageHeight > 0 ? pageHeight : inferPageHeightFromOcrLines(lines);
  return assignSectionGstRates(lines, { pageHeight: ph }).lines;
}

function itemHasExplicitPrintedLineTax(it: ExtractedInvoiceLine): boolean {
  const cg = it.cgst_amount != null && Number.isFinite(it.cgst_amount) ? it.cgst_amount : 0;
  const sg = it.sgst_amount != null && Number.isFinite(it.sgst_amount) ? it.sgst_amount : 0;
  const ig = it.igst_amount != null && Number.isFinite(it.igst_amount) ? it.igst_amount : 0;
  return cg + sg + ig > 0.01;
}

function normalizeDescKey(desc: string | null | undefined): string {
  return (desc || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 14);
}

function digitsOnlyHsn(h: string | null | undefined): string {
  return (h || '').replace(/\D/g, '');
}

/** Leading merchandise / HSN code on thermal lines: `071320 L DAL CHANA …` */
function ocrLeadingHsn(text: string): string | null {
  const m = text.trim().match(/^(\d{4,10})\b/);
  return m ? m[1] : null;
}

function lastNumberInString(s: string): number | null {
  const m = [...s.matchAll(/(\d+(?:\.\d+)?)/g)];
  if (!m.length) return null;
  const v = parseFloat(m[m.length - 1][1]);
  return Number.isFinite(v) ? v : null;
}

function lineTotalDelta(it: ExtractedInvoiceLine, ol: OcrLine): number {
  const lt = it.line_total != null && Number.isFinite(it.line_total) ? it.line_total : null;
  if (lt == null) return 1e9;
  const last = lastNumberInString(ol.text);
  if (last == null) return 1e9;
  return Math.abs(last - lt);
}

function lineTotalMatches(it: ExtractedInvoiceLine, ol: OcrLine): boolean {
  return lineTotalDelta(it, ol) < 0.06 + Math.abs((it.line_total ?? 0) * 0.002);
}

/** Strong score + tie distance (lower distance wins on equal score). */
function scoreOcrLineForItem(it: ExtractedInvoiceLine, ol: OcrLine): { score: number; lineDelta: number } {
  const W_HSN = 1000;
  const W_LINE = 500;
  const W_DESC = 3;

  const hsn = digitsOnlyHsn(it.hsn_code);
  const oh = ocrLeadingHsn(ol.text);
  const hsnMatch = hsn.length >= 4 && oh != null && hsn === oh;

  let score = 0;
  if (hsnMatch) score += W_HSN;

  const ltOk = lineTotalMatches(it, ol);
  if (ltOk) score += W_LINE;

  const lineDelta = lineTotalDelta(it, ol);

  /** Desc substring only when HSN missing — avoids `LCHANA` ⊂ `LDALCHANA` false positives */
  if (!hsnMatch && hsn.length < 4) {
    const key = normalizeDescKey(it.description);
    const otext = ol.text.toUpperCase();
    if (key.length >= 4 && otext.replace(/[^A-Z0-9]/g, '').includes(key)) score += W_DESC;
  }

  return { score, lineDelta };
}

function buildOcrItemSequence(lines: OcrLine[]): OcrLine[] {
  return lines.filter((l) => l.kind === 'item');
}

/** Min score to trust OCR row: HSN-only ok on DMart; without HSN need printed line-total match */
function minAcceptScoreForItem(it: ExtractedInvoiceLine): number {
  return digitsOnlyHsn(it.hsn_code).length >= 4 ? 1000 : 500;
}

/**
 * Globally pair extract lines to OCR item rows (max score, unique OCR index).
 * Fixes LLM item order ≠ receipt order and substring steals (e.g. L CHANA vs L DAL CHANA).
 */
function assignGstRatesFromOcrGlobal(
  needIndices: Array<{ it: ExtractedInvoiceLine; i: number }>,
  ocrItems: OcrLine[],
  nextItems: ExtractedInvoiceLine[],
  overrides: OcrGstPropagationDebug['overrides']
): void {
  const usedJ = new Set<number>();
  const assignedI = new Set<number>();

  while (assignedI.size < needIndices.length) {
    let best: {
      score: number;
      lineDelta: number;
      i: number;
      j: number;
      it: ExtractedInvoiceLine;
    } | null = null;

    for (const { it, i } of needIndices) {
      if (assignedI.has(i)) continue;
      const minSc = minAcceptScoreForItem(it);
      for (let j = 0; j < ocrItems.length; j++) {
        if (usedJ.has(j)) continue;
        const { score, lineDelta } = scoreOcrLineForItem(it, ocrItems[j]);
        if (score < minSc) continue;
        if (
          !best ||
          score > best.score ||
          (score === best.score && lineDelta < best.lineDelta)
        ) {
          best = { score, lineDelta, i, j, it };
        }
      }
    }

    if (!best) break;

    usedJ.add(best.j);
    assignedI.add(best.i);

    const rate = ocrItems[best.j].assignedSectionGstRate as number;
    const fromRate = best.it.gst_rate;
    if (fromRate == null || fromRate <= 0 || Math.abs(fromRate - rate) >= 0.5) {
      overrides.push({
        index: best.i,
        fromRate: fromRate ?? null,
        toRate: rate,
        reason: 'ocr_global_pair',
      });
      nextItems[best.i] = { ...best.it, gst_rate: rate };
    }
  }
}

/**
 * Apply OCR section GST to normalized extract items (after `assignSectionGstRates`).
 */
export function applyOcrSectionGstToExtract(
  extract: IndianGstInvoiceExtract,
  ocrLines: OcrLine[],
  pageHeight?: number
): { extract: IndianGstInvoiceExtract; debug: OcrGstPropagationDebug } {
  const ph =
    pageHeight != null && pageHeight > 0 ? pageHeight : inferPageHeightFromOcrLines(ocrLines);
  const { lines: propagated, trace } = assignSectionGstRates(ocrLines, { pageHeight: ph });
  const ocrItems = buildOcrItemSequence(propagated).filter(
    (l) => l.assignedSectionGstRate != null && Number.isFinite(l.assignedSectionGstRate as number)
  );
  const overrides: OcrGstPropagationDebug['overrides'] = [];

  const linePayload = propagated.slice(0, 400).map((l) => ({
    text: trimLine(l.text),
    y: l.y,
    x: l.x,
    width: l.width,
    height: l.height,
    kind: l.kind ?? 'noise',
    assignedSectionGstRate: l.assignedSectionGstRate ?? null,
  }));

  if (!extract.items?.length) {
    return { extract, debug: { lines: linePayload, overrides, trace } };
  }

  let nextItems = [...extract.items];

  if (ocrItems.length) {
    const needIndices = extract.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !itemHasExplicitPrintedLineTax(it));
    assignGstRatesFromOcrGlobal(needIndices, ocrItems, nextItems, overrides);
  }

  nextItems = mergeMissingOcrExchangeItemRowsIntoItems(nextItems, propagated, extract.tax_type);
  nextItems = mergeMissingPlainLinesFromOcrGrandTotalGap(nextItems, propagated, extract);

  return { extract: { ...extract, items: nextItems }, debug: { lines: linePayload, overrides, trace } };
}

function round2local(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse the most negative money token from an OCR item row (Flipkart-style table:
 * `Exchange Discount -10000.00 0.00 -10000.00 0.00 -10000.00`).
 */
export function inferNegativeLineTotalFromExchangeOcrText(text: string): number | null {
  const s = text.replace(/\s+/g, ' ').trim();
  const re = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const v = parseFloat(m[0].replace(/,/g, ''));
    if (Number.isFinite(v)) vals.push(v);
  }
  const negs = vals.filter((v) => v < -0.005);
  if (!negs.length) return null;
  return round2local(Math.min(...negs));
}

/**
 * When Groq drops an **Exchange / adjustment** table row, re-insert it from Vision-classified
 * OCR `item` lines (deterministic; no LLM).
 */
export function mergeMissingOcrExchangeItemRowsIntoItems(
  items: ExtractedInvoiceLine[],
  propagated: OcrLine[],
  taxType: IndianGstInvoiceExtract['tax_type']
): ExtractedInvoiceLine[] {
  const out = [...items];
  const tol = 1.5;

  const hasExchangeExtract = out.some(
    (it) =>
      looksLikeExchangeOrAdjustmentRow(it.description ?? '') && (it.line_total ?? 0) < -0.5
  );
  if (hasExchangeExtract) return out;

  const seen = new Set<number>();
  for (const row of propagated) {
    if (row.kind !== 'item') continue;
    const text = row.text.replace(/\s+/g, ' ').trim();
    if (!looksLikeExchangeOrAdjustmentRow(text)) continue;

    const lt = inferNegativeLineTotalFromExchangeOcrText(text);
    if (lt == null || lt >= -0.5) continue;
    if (seen.has(lt)) continue;

    const covered = out.some(
      (it) => it.line_total != null && Number.isFinite(it.line_total) && Math.abs((it.line_total as number) - lt) <= tol
    );
    if (covered) continue;

    seen.add(lt);
    const desc =
      text
        .split(/\s+-?\d/)[0]
        ?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160) || 'Exchange / adjustment (from invoice OCR)';

    out.push({
      description: desc,
      hsn_code: null,
      qty: 1,
      unit: 'PCS',
      rate: lt,
      discount_amount: null,
      gst_rate: 0,
      tax_mode: taxType === 'igst' ? 'exclusive' : null,
      taxable_value: lt,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: 0,
      line_total: lt,
      discount_on_tax_inclusive: false,
    });
  }
  return out;
}

export function refreshTaxableValuesAfterGstPatch(extract: IndianGstInvoiceExtract): IndianGstInvoiceExtract {
  const items = (extract.items || []).map((it) => {
    const lt = it.line_total;
    const g = it.gst_rate != null ? it.gst_rate : 0;
    if (lt == null || !Number.isFinite(lt) || lt <= 0 || g <= 0) return it;
    return {
      ...it,
      taxable_value: round2local(lt / (1 + g / 100)),
    };
  });
  return { ...extract, items };
}
