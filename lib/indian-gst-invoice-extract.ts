/**
 * Indian GST invoice extraction — canonical schema, coercion from LLM/OCR JSON,
 * normalization (footer-first), price_mode / tax_type detection, and mapping to purchase review UI.
 *
 * Google Vision stays OCR-only; Groq produces JSON that is coerced + normalized here.
 */

import {
  inclusiveLineTotal,
  inclusiveLineTotalWithDiscountAmount,
  deriveUnitPriceFromInvoiceLine,
} from '@/lib/invoice-line-math';
import { getStateCode } from '@/lib/gst-utils';
import { applyNumericOcrReconciliationToExtract } from '@/lib/services/invoice-extract/numericReconciliationEngine';
import type { NumericReconciliationDebug } from '@/lib/services/invoice-extract/numericReconciliationEngine';
import { roundExclusiveUnitPrice, roundRetailQty } from '@/lib/numeric-precision';

// --- Canonical extraction types (LLM target + internal pipeline) ---

export type InvoiceTaxType = 'igst' | 'cgst_sgst';
export type InvoicePriceMode = 'exclusive' | 'inclusive';

export interface GstSummarySlabRow {
  gst_rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_tax: number;
}

export interface ExtractedInvoiceLine {
  description: string | null;
  hsn_code: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  discount_amount: number | null;
  gst_rate: number | null;
  /** Per-line interpretation when model can infer it; may be null. */
  tax_mode: InvoicePriceMode | null;
  taxable_value: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  line_total: number | null;
  /** When true, rupee discount applies to tax-inclusive line value (MRP-style). */
  discount_on_tax_inclusive?: boolean | null;
}

export interface IndianGstInvoiceExtract {
  supplier_name: string | null;
  supplier_gstin: string | null;
  buyer_gstin: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  place_of_supply: string | null;
  tax_type: InvoiceTaxType | null;
  price_mode: InvoicePriceMode | null;
  subtotal: number | null;
  total_cgst: number | null;
  total_sgst: number | null;
  total_igst: number | null;
  round_off: number | null;
  grand_total: number | null;
  items: ExtractedInvoiceLine[];
  gst_summary: GstSummarySlabRow[];
  /** Populated by `applyNumericOcrReconciliationToExtract` inside normalization (debug / audit). */
  numeric_reconciliation_debug?: NumericReconciliationDebug | null;
  /**
   * When set, consolidated non-Indian tax (single “Sales Tax” / VAT-style %) was inferred and split
   * into CGST+SGST for purchase entry; slab math uses this combined % without snapping to standard GST slabs.
   */
  document_combined_gst_rate?: number | null;
}

// --- Purchase review payload (unchanged consumer shape + extensions) ---

export interface PurchaseReviewExtractPayload {
  supplier: {
    name: string | null;
    gstin: string | null;
    address: string | null;
  };
  invoice: {
    bill_number: string | null;
    bill_date: string | null;
    document_type: string;
    place_of_supply: string | null;
    /** Two-digit state code when derivable from place_of_supply or GSTIN hints */
    place_of_supply_state_code: string | null;
    tax_type: InvoiceTaxType | null;
    price_mode: InvoicePriceMode | null;
    buyer_gstin: string | null;
  };
  items: Array<{
    item_name: string | null;
    hsn_sac: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    unit: string;
    discount_percent: number;
    discount_amount: number;
    discount_on_tax_inclusive: boolean;
    tax_rate: number;
    tax_mode?: InvoicePriceMode | null;
    /** From model when present */
    taxable_value?: number | null;
    cgst_amount?: number | null;
    sgst_amount?: number | null;
    igst_amount?: number | null;
  }>;
  totals: {
    subtotal: number | null;
    grand_total: number | null;
    round_off: number | null;
    tax_amount: number | null;
    cgst: number | null;
    sgst: number | null;
    igst: number | null;
    gst_summary: GstSummarySlabRow[];
  };
}

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]{2}$/;
export const VALID_GST_RATES = new Set([
  0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28,
]);

export function gstinStateCode(gstin: string | null | undefined): string {
  if (!gstin || gstin.length < 2) return '';
  const d = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(d) ? d : '';
}

export function nearestGstRate(rate: number): number {
  if (VALID_GST_RATES.has(rate)) return rate;
  let best = rate;
  let bestDist = Infinity;
  for (const valid of VALID_GST_RATES) {
    const dist = Math.abs(rate - valid);
    if (dist < bestDist && dist <= 2) {
      best = valid;
      bestDist = dist;
    }
  }
  return best;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * If the OCR/model rate is basically on an Indian slab, snap — otherwise keep the numeric % intact
 * (sales tax / VAT / non-standard totals) so normalization does not coerce 20% → 18%.
 */
function normalizePositiveGstPercent(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  const snapped = nearestGstRate(raw);
  return Math.abs(snapped - raw) <= 0.85 ? snapped : round2(raw);
}

export function parseDateToISO(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : s;
  }
  const monMatch = s.match(/^(\d{1,2})[\-\/\s]([A-Za-z]{3,})[\-\/\s](\d{4})$/);
  if (monMatch) {
    const d = new Date(`${monMatch[2]} ${monMatch[1]}, ${monMatch[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const ddmmMatch = s.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
  if (ddmmMatch) {
    const [, dd, mm, yyyy] = ddmmMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime()) && d.getDate() === Number(dd)) {
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v.replace(/[,\s₹Rs.INR]/gi, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Accept legacy extractor keys + new GST schema keys. */
export function coerceRawInvoiceJson(raw: unknown): IndianGstInvoiceExtract {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const supplier_name = str(o.supplier_name ?? o.vendor_name);
  const supplier_gstinRaw = str(o.supplier_gstin ?? o.gst_number);
  let supplier_gstin = supplier_gstinRaw?.replace(/\s/g, '').toUpperCase() ?? null;
  if (supplier_gstin && !GSTIN_RE.test(supplier_gstin)) supplier_gstin = null;

  let buyer_gstin = str(o.buyer_gstin)?.replace(/\s/g, '').toUpperCase() ?? null;
  if (buyer_gstin && !GSTIN_RE.test(buyer_gstin)) buyer_gstin = null;

  const invoice_number = str(o.invoice_number ?? o.bill_number);
  const invoice_date = str(o.invoice_date);
  const place_of_supply = str(o.place_of_supply);

  let tax_type: InvoiceTaxType | null = null;
  const tt = str(o.tax_type)?.toLowerCase();
  if (tt === 'igst') tax_type = 'igst';
  else if (tt === 'cgst_sgst' || tt === 'cgst+sgst' || tt === 'intrastate') tax_type = 'cgst_sgst';

  let price_mode: InvoicePriceMode | null = null;
  const pm = str(o.price_mode)?.toLowerCase();
  if (pm === 'exclusive' || pm === 'excl') price_mode = 'exclusive';
  else if (pm === 'inclusive' || pm === 'incl') price_mode = 'inclusive';

  const subtotal =
    num(o.subtotal) ??
    num(o.taxable_amount ?? o.taxable_value_before_tax ?? o.amount_taxable ?? o.taxable_total);
  const total_cgst = num(o.total_cgst ?? o.cgst);
  const total_sgst = num(o.total_sgst ?? o.sgst);
  const total_igst = num(o.total_igst ?? o.igst);
  const round_off = num(o.round_off);
  const grand_total = num(o.grand_total ?? o.total);

  // gst_summary (new) or gst_breakup (legacy)
  let gstRows: unknown[] = [];
  if (Array.isArray(o.gst_summary)) gstRows = o.gst_summary;
  else if (Array.isArray(o.gst_breakup)) gstRows = o.gst_breakup;

  const gst_summary: GstSummarySlabRow[] = gstRows
    .map((row) => {
      const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      const rawRateNum = num(r.gst_rate ?? r.rate);
      const rate = rawRateNum != null ? normalizePositiveGstPercent(rawRateNum) : 0;
      const taxable_value = num(r.taxable_value ?? r.taxable_amount) ?? 0;
      const cgst = num(r.cgst ?? r.cgst_amount) ?? 0;
      const sgst = num(r.sgst ?? r.sgst_amount) ?? 0;
      const igst = num(r.igst ?? r.igst_amount) ?? 0;
      const total_tax = Math.round((cgst + sgst + igst + Number.EPSILON) * 100) / 100;
      if (!rate && !taxable_value && !total_tax) return null;
      return { gst_rate: rate, taxable_value, cgst, sgst, igst, total_tax };
    })
    .filter((x): x is GstSummarySlabRow => x != null);

  const lineSrc = Array.isArray(o.items)
    ? o.items
    : Array.isArray(o.line_items)
      ? o.line_items
      : [];

  const items: ExtractedInvoiceLine[] = lineSrc.map((row) => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const qty = num(r.qty ?? r.quantity) ?? 1;
    const rate = num(r.rate ?? r.unit_price);
    const disc = Math.abs(num(r.discount_amount ?? r.discount) ?? 0);
    const gst_rateRaw = num(r.gst_rate ?? r.tax_rate);
    const line_total = num(r.line_total ?? r.amount);
    const tm = str(r.tax_mode)?.toLowerCase();
    const tax_mode: InvoicePriceMode | null =
      tm === 'inclusive' ? 'inclusive' : tm === 'exclusive' ? 'exclusive' : null;
    const gstNormLine =
      gst_rateRaw != null && Number.isFinite(gst_rateRaw) ? normalizePositiveGstPercent(gst_rateRaw) : 0;
    return {
      description: str(r.description ?? r.item_name),
      hsn_code: str(r.hsn_code ?? r.hsn_sac),
      qty: qty > 0 ? qty : 1,
      unit: str(r.unit) ?? 'PCS',
      rate,
      discount_amount: disc > 0 ? disc : null,
      gst_rate: gstNormLine > 0 ? gstNormLine : null,
      tax_mode,
      taxable_value: num(r.taxable_value),
      cgst_amount: num(r.cgst_amount),
      sgst_amount: num(r.sgst_amount),
      igst_amount: num(r.igst_amount),
      line_total,
      discount_on_tax_inclusive:
        typeof r.discount_on_tax_inclusive === 'boolean'
          ? r.discount_on_tax_inclusive
          : typeof r.discount_on_tax_inclusive_gross === 'boolean'
            ? r.discount_on_tax_inclusive_gross
            : null,
    };
  });

  return {
    supplier_name,
    supplier_gstin,
    buyer_gstin,
    invoice_number,
    invoice_date,
    place_of_supply,
    tax_type,
    price_mode,
    subtotal,
    total_cgst,
    total_sgst,
    total_igst,
    round_off,
    grand_total,
    items,
    gst_summary,
    document_combined_gst_rate: num(o.document_combined_gst_rate),
  };
}

/**
 * Respect {@link IndianGstInvoiceExtract.document_combined_gst_rate} so non-standard combined rates
 * (e.g. 20% Sales Tax) are not snapped to the nearest Indian slab during rollups.
 */
export function nearestGstRateForExtract(rate: number, e: IndianGstInvoiceExtract): number {
  const doc = e.document_combined_gst_rate;
  if (doc != null && Number.isFinite(doc) && Math.abs(rate - doc) <= 0.2) {
    return round2(doc);
  }
  return nearestGstRate(rate);
}

/**
 * When the invoice shows one consolidated tax (Sales Tax, VAT, Use Tax, etc.) instead of Indian
 * CGST/SGST/IGST columns, derive the combined rate from totals and allocate tax into CGST+SGST halves
 * (conceptually SGST CGST component each equals half of the combined rate — e.g. 20% → 10%+10%).
 */
function lineHasPrintedSplitTax(it: ExtractedInvoiceLine): boolean {
  return (
    Math.abs(it.cgst_amount ?? 0) > 0.02 ||
    Math.abs(it.sgst_amount ?? 0) > 0.02 ||
    Math.abs(it.igst_amount ?? 0) > 0.02
  );
}

export function applyConsolidatedForeignTaxSplit(e: IndianGstInvoiceExtract): void {
  if (e.tax_type === 'igst') return;

  const items = e.items ?? [];
  if (items.length === 0) return;

  const headerTax = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  if (headerTax > 0.02) return;

  const gstRows = e.gst_summary ?? [];
  const gstHadTax = gstRows.some(
    (r) =>
      Math.abs(r.cgst) > 0.02 ||
      Math.abs(r.sgst) > 0.02 ||
      Math.abs(r.igst) > 0.02 ||
      Math.abs(r.total_tax ?? 0) > 0.02,
  );
  if (gstHadTax) return;

  const positiveLines = items.filter(
    (it) => it.line_total != null && it.line_total > 0 && Number.isFinite(it.line_total),
  ) as Array<ExtractedInvoiceLine & { line_total: number }>;
  if (positiveLines.length === 0) return;

  if (positiveLines.some(lineHasPrintedSplitTax)) return;

  const grand = e.grand_total;
  if (grand == null || !Number.isFinite(grand) || grand <= 0) return;

  const ro = e.round_off ?? 0;
  let sumLines = 0;
  for (const it of positiveLines) sumLines = round2(sumLines + it.line_total);

  const tolNear = Math.max(2.5, grand * 0.022);
  const sumsNearGrand =
    Math.abs(sumLines - grand) <= tolNear || Math.abs(sumLines + ro - grand) <= tolNear;

  const allLowGst = positiveLines.every((it) => (it.gst_rate ?? 0) <= 0.01);
  if (sumsNearGrand && allLowGst) return;

  let uniformR = 0;
  if (!allLowGst) {
    const base = positiveLines[0]!.gst_rate ?? 0;
    if (!(base > 0.01)) return;
    if (!positiveLines.every((it) => Math.abs((it.gst_rate ?? 0) - base) <= 0.85)) return;
    uniformR = round2(base);
  }

  let implicitTax = 0;
  let R = 0;
  let taxableRollPre = 0;
  let useInclusiveParsed = false;

  if (sumsNearGrand && uniformR >= 0.25) {
    useInclusiveParsed = true;
    for (const it of positiveLines) {
      taxableRollPre = round2(taxableRollPre + round2(it.line_total / (1 + uniformR / 100)));
    }

    const embedded = round2(sumLines - taxableRollPre);
    const fromGrandGap = round2(grand - ro - taxableRollPre);
    implicitTax =
      Math.abs(embedded - fromGrandGap) <= Math.max(2.5, grand * 0.025)
        ? embedded
        : fromGrandGap;

    if (implicitTax <= Math.max(1, grand * 0.004)) return;

    const inferredR =
      taxableRollPre > 0 ? round2((implicitTax / taxableRollPre) * 100) : 0;
    if (inferredR < 0.25 || inferredR > 42) return;

    R = inferredR;
    if (uniformR >= 0.25 && Math.abs(inferredR - uniformR) <= 2.75) R = uniformR;
    taxableRollPre = 0;
    for (const it of positiveLines) {
      taxableRollPre = round2(taxableRollPre + round2(it.line_total / (1 + R / 100)));
    }
    const embedded2 = round2(sumLines - taxableRollPre);
    const fromGrandGap2 = round2(grand - ro - taxableRollPre);
    implicitTax =
      Math.abs(embedded2 - fromGrandGap2) <= Math.max(2.5, grand * 0.025)
        ? embedded2
        : fromGrandGap2;
    const inferredVerify =
      taxableRollPre > 0 ? round2((implicitTax / taxableRollPre) * 100) : 0;
    if (Math.abs(inferredVerify - R) > 1.85) return;
    if (implicitTax <= Math.max(1, grand * 0.004)) return;
    if (
      taxableRollPre <= 0 ||
      !Number.isFinite(taxableRollPre) ||
      !Number.isFinite(implicitTax) ||
      !Number.isFinite(R)
    )
      return;
  } else {
    if (!allLowGst && uniformR < 0.25) return;

    let taxableBase =
      e.subtotal != null && e.subtotal > 0 ? e.subtotal : sumLines;
    if (
      e.subtotal != null &&
      e.subtotal > 0 &&
      sumLines > 0 &&
      Math.abs(sumLines - e.subtotal) > Math.max(3, e.subtotal * 0.035)
    ) {
      taxableBase = sumLines;
    }

    if (taxableBase <= 0 || !Number.isFinite(taxableBase)) return;

    implicitTax = round2(grand - taxableBase - ro);
    if (implicitTax <= Math.max(1, grand * 0.004)) return;

    let rCand = round2((implicitTax / taxableBase) * 100);
    if (uniformR >= 0.25 && Math.abs(rCand - uniformR) <= 2.75) rCand = uniformR;
    R = rCand;
    if (R < 0.25 || R > 42) return;

    taxableRollPre = round2(sumLines);
  }

  e.document_combined_gst_rate = R;
  e.subtotal = taxableRollPre;
  if (e.tax_type == null) e.tax_type = 'cgst_sgst';

  const half1 = round2(implicitTax / 2);
  const half2 = round2(implicitTax - half1);
  e.total_cgst = half1;
  e.total_sgst = half2;
  e.total_igst = null;

  const tbRollDenom = taxableRollPre;
  let taxAllocated = 0;
  for (let idx = 0; idx < positiveLines.length; idx++) {
    const it = positiveLines[idx]!;
    const taxablePreRaw = useInclusiveParsed
      ? round2(it.line_total / (1 + R / 100))
      : round2(it.line_total);
    const share =
      tbRollDenom > 0 ? taxablePreRaw / tbRollDenom : 1 / positiveLines.length;
    const last = idx === positiveLines.length - 1;
    const lineTax = last ? round2(implicitTax - taxAllocated) : round2(implicitTax * share);
    taxAllocated = round2(taxAllocated + lineTax);

    const inclusive = round2(taxablePreRaw + lineTax);
    const cg = round2(lineTax / 2);
    const sg = round2(lineTax - cg);

    it.gst_rate = R;
    it.taxable_value = taxablePreRaw;
    it.line_total = inclusive;
    it.cgst_amount = cg;
    it.sgst_amount = sg;
    it.igst_amount = null;
    if (it.tax_mode == null && e.price_mode === 'exclusive') it.tax_mode = 'exclusive';
  }

  e.gst_summary = [
    {
      gst_rate: R,
      taxable_value: round2(tbRollDenom),
      cgst: half1,
      sgst: half2,
      igst: 0,
      total_tax: implicitTax,
    },
  ];
}

/**
 * When the model picks the wrong slab (e.g. 5% vs 18%) but the line has printed taxable vs total,
 * or printed CGST/SGST, prefer the implied full GST %.
 */
function reconcileLineGstRateFromEvidence(it: ExtractedInvoiceLine): number {
  const fromModel =
    it.gst_rate != null && it.gst_rate > 0 ? normalizePositiveGstPercent(it.gst_rate) : 0;
  const lt = it.line_total;
  if (lt == null || !Number.isFinite(lt) || lt <= 0.01) return fromModel;

  const tvRaw = it.taxable_value;
  if (tvRaw != null && Number.isFinite(tvRaw)) {
    const tv = round2(tvRaw);
    if (tv > 0.01 && lt > tv + 0.01) {
      const implied = nearestGstRate(((lt / tv) - 1) * 100);
      if (implied > 0 && Math.abs(implied - fromModel) >= 0.75) {
        return implied;
      }
    }
  }

  const cg = it.cgst_amount != null && Number.isFinite(it.cgst_amount) ? it.cgst_amount : null;
  const sg = it.sgst_amount != null && Number.isFinite(it.sgst_amount) ? it.sgst_amount : null;
  const ig = it.igst_amount != null && Number.isFinite(it.igst_amount) ? it.igst_amount : null;
  const tax = (cg ?? 0) + (sg ?? 0) + (ig ?? 0);
  if (tax > 0.01) {
    const taxable = lt - tax;
    if (taxable > 0.01) {
      const implied = nearestGstRate((tax / taxable) * 100);
      if (implied > 0 && (fromModel <= 0 || Math.abs(implied - fromModel) >= 0.75)) {
        return implied;
      }
    }
  }

  return fromModel;
}

/** Prefer footer gst_summary for header figures when sums align with printed totals (tiny mismatch allowed). */
function applyFooterAsSourceOfTruth(e: IndianGstInvoiceExtract): void {
  if (!e.gst_summary.length) return;

  const origSub = e.subtotal ?? 0;
  const origHeaderTax =
    (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);

  let sTax = 0;
  let sC = 0;
  let sS = 0;
  let sI = 0;
  for (const row of e.gst_summary) {
    sTax += row.taxable_value;
    sC += row.cgst;
    sS += row.sgst;
    sI += row.igst;
  }
  sTax = round2(sTax);
  sC = round2(sC);
  sS = round2(sS);
  sI = round2(sI);

  const grand = e.grand_total ?? 0;
  const tol = Math.max(2, grand * 0.025);

  if (Math.abs((e.subtotal ?? 0) - sTax) <= tol || e.subtotal == null) {
    e.subtotal = sTax;
  }

  const headerTax = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  const footerTax = sC + sS + sI;
  if (footerTax > 0.01 && (headerTax < 0.01 || Math.abs(headerTax - footerTax) <= tol)) {
    e.total_cgst = sC;
    e.total_sgst = sS;
    e.total_igst = sI;
  }

  // Slab table taxable + slab taxes (+ round-off) matches printed grand, but header taxes are
  // wildly larger than slab CGST/SGST sums (LLM/OCR often pastes a taxable column into total_cgst).
  const ro = e.round_off ?? 0;
  const slabGrand = round2(sTax + footerTax + ro);
  const headerStory = round2(origSub + origHeaderTax + ro);
  const tolG = Math.max(2, grand * 0.02);
  if (
    grand > 0.01 &&
    footerTax > 0.01 &&
    Math.abs(slabGrand - grand) <= tolG &&
    origHeaderTax > footerTax * 2 &&
    Math.abs(headerStory - grand) > tolG
  ) {
    e.subtotal = sTax;
    e.total_cgst = sC;
    e.total_sgst = sS;
    e.total_igst = sI;
  }
}

export function detectTaxType(e: IndianGstInvoiceExtract): InvoiceTaxType {
  const ig = e.total_igst ?? 0;
  const c = e.total_cgst ?? 0;
  const s = e.total_sgst ?? 0;
  const cs = c + s;

  /** Printed rupee SGST/CGST totals win over interstate GSTIN heuristics (many templates misuse CGST+SGST on inter‑state drafts). */
  if (c > 0.01 && s > 0.01 && ig < 0.5) return 'cgst_sgst';
  if (ig > 0.01 && cs < 0.5) return 'igst';

  if (ig > 0.01 && cs > 0.01 && Math.abs(ig - cs) < 1) {
    /** normalizeTaxColumns will collapse duplicated totals; interim pick IGST-ish only if dominates */
    if (ig > cs * 1.05) return 'igst';
  }

  const sup = gstinStateCode(e.supplier_gstin);
  const buy = gstinStateCode(e.buyer_gstin);
  if (sup.length === 2 && buy.length === 2 && sup !== buy) return 'igst';
  if (sup.length === 2 && buy.length === 2 && sup === buy) return 'cgst_sgst';

  return e.tax_type === 'igst' ? 'igst' : 'cgst_sgst';
}

export function detectPriceMode(e: IndianGstInvoiceExtract): InvoicePriceMode {
  const inferred = inferPriceModeFromTotals(e);
  const grand = e.grand_total ?? 0;
  const tol = Math.max(1.5, grand * 0.02);
  const sub = e.subtotal ?? 0;
  const tax = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  const ro = e.round_off ?? 0;
  const lineSum = e.items.reduce((s, it) => s + (it.line_total ?? 0), 0);
  const exclusiveFit = grand > 0 ? Math.abs(sub + tax + ro - grand) : Infinity;
  const inclusiveFit = grand > 0 ? Math.abs(lineSum + ro - grand) : Infinity;

  if (e.price_mode === 'exclusive' && exclusiveFit <= tol) return 'exclusive';
  if (e.price_mode === 'inclusive' && inclusiveFit <= tol) return 'inclusive';
  if (e.price_mode === 'inclusive' && exclusiveFit <= tol) return 'exclusive';
  if (e.price_mode === 'exclusive' && inclusiveFit <= tol && exclusiveFit > tol) return 'inclusive';

  return inferred;
}

function inferPriceModeFromTotals(e: IndianGstInvoiceExtract): InvoicePriceMode {
  const sub = e.subtotal ?? 0;
  const tax = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  const grand = e.grand_total ?? 0;
  const ro = e.round_off ?? 0;
  if (grand > 0 && sub > 0) {
    const tol = Math.max(1.5, grand * 0.02);
    const exclusiveFit = Math.abs(sub + tax + ro - grand);
    if (exclusiveFit <= tol) return 'exclusive';

    const lineSum = e.items.reduce((s, it) => s + (it.line_total ?? 0), 0);
    if (Math.abs(lineSum + ro - grand) <= tol) return 'inclusive';
  }
  return 'exclusive';
}

/** Clear wrong tax split; never keep both full IGST and full CGST+SGST unless numerically tied. */
function normalizeTaxColumns(e: IndianGstInvoiceExtract): void {
  const ig = e.total_igst ?? 0;
  const c = e.total_cgst ?? 0;
  const s = e.total_sgst ?? 0;
  if (ig > 0.01 && (c > 0.01 || s > 0.01)) {
    const cs = c + s;
    if (Math.abs(ig - cs) < 1) {
      e.total_cgst = null;
      e.total_sgst = null;
    }
  }
}

/**
 * Footer totals often imply taxable = grand − tax − round_off while the extractor uses pre‑discount
 * gross lines as subtotal — prefer reconstructed taxable only when it ties payable.
 */
function preferTaxableSubtotalFromGrand(e: IndianGstInvoiceExtract): void {
  const grand = e.grand_total;
  if (grand == null || !Number.isFinite(grand) || grand <= 0) return;

  const ro = e.round_off ?? 0;
  const cg = e.total_cgst ?? 0;
  const sg = e.total_sgst ?? 0;
  const ig = e.total_igst ?? 0;
  const tax = round2(cg + sg + ig);
  if (tax < 1) return;

  const implied = round2(grand - ro - tax);
  if (implied <= 1) return;

  /** Tight-ish: ₹ stories must nearly close payable; avoids treating wrong large subtotal as OK. */
  const tolG = Math.max(2.5, Math.min(grand * 0.02, grand * 0.004));

  const cur = e.subtotal ?? 0;
  const curStory = round2(cur + tax + ro);
  const impliedStory = round2(implied + tax + ro);

  const curFails = cur <= 1 || Math.abs(curStory - grand) > tolG;
  const impliedOk = Math.abs(impliedStory - grand) <= tolG;
  const curMisaligned =
    cur > 1 &&
    Math.abs(cur - implied) > Math.max(3, implied * 0.01) &&
    impliedOk;

  if ((curFails && impliedOk) || (impliedOk && curMisaligned)) {
    e.subtotal = implied;
  }
}

/**
 * When Σ positive line taxable exceeds footer taxable by a plausible bill‑discount wedge, scale lines
 * so they sum to subtotal before distributing header SGST/CGST across lines.
 */
function scaleExclusiveLinesToFooterTaxableWhenDiscounted(e: IndianGstInvoiceExtract): void {
  if (e.price_mode !== 'exclusive') return;
  /** Consolidated‑tax split inflates lines to tax‑inclusive; do not rescale those. */
  if (e.document_combined_gst_rate != null && e.document_combined_gst_rate > 0.01) return;

  const sub = e.subtotal ?? 0;
  if (!Number.isFinite(sub) || sub < 50) return;

  const cg = e.total_cgst ?? 0;
  const sg = e.total_sgst ?? 0;
  if (!(cg > 0.01 && sg > 0.01)) return;

  const items = e.items ?? [];
  const positives = items.filter(
    (it) => it.line_total != null && Number.isFinite(it.line_total) && it.line_total > 0,
  );
  let gross = 0;
  for (const it of positives) gross = round2(gross + it.line_total!);
  if (gross <= 0.01) return;

  const alignTol = Math.max(2.5, Math.min(gross * 0.025, gross * 0.006));
  if (Math.abs(gross - sub) <= alignTol) return;
  /** Only shrink‑to‑taxable patterns (discount on total), never arbitrary mismatch. */
  if (sub > gross + 2) return;
  const maxGapFrac = 0.2;
  if (gross - sub > gross * maxGapFrac) return;

  const scale = gross > 0 ? sub / gross : 1;
  let acc = 0;
  for (let i = 0; i < positives.length; i++) {
    const it = positives[i]!;
    const lt = it.line_total!;
    const last = i === positives.length - 1;
    const next = last ? round2(sub - acc) : round2(lt * scale);
    acc = round2(acc + next);
    it.line_total = next;
    it.taxable_value = next;
    it.gst_rate = null;
    it.cgst_amount = null;
    it.sgst_amount = null;
    it.igst_amount = null;
  }
}

/**
 * Distribute printed header CGST/SGST across exclusive lines by taxable share (SGST≠CGST safe).
 */
function distributePrintedHeaderGstToExclusiveLines(e: IndianGstInvoiceExtract): void {
  const tt = e.tax_type ?? detectTaxType(e);
  if (tt !== 'cgst_sgst' || e.price_mode !== 'exclusive') return;

  const totC = e.total_cgst ?? 0;
  const totS = e.total_sgst ?? 0;
  if (!(totC > 0.01 || totS > 0.01)) return;

  const positiveLines =
    e.items?.filter(
      (it) => it.line_total != null && Number.isFinite(it.line_total) && it.line_total > 0,
    ) ?? [];

  const hasPrintedLineSplit = positiveLines.some(
    (it) => Math.abs(it.cgst_amount ?? 0) > 0.05 || Math.abs(it.sgst_amount ?? 0) > 0.05,
  );
  if (hasPrintedLineSplit || positiveLines.length === 0) return;

  let sumTaxable = 0;
  for (const it of positiveLines) sumTaxable = round2(sumTaxable + (it.line_total ?? 0));
  if (sumTaxable <= 0.01) return;

  const sub = e.subtotal ?? 0;
  if (sub > 0.01 && Math.abs(sumTaxable - sub) > Math.max(3, sumTaxable * 0.02)) return;

  let cAlloc = 0;
  let sAlloc = 0;
  const lastIdx = positiveLines.length - 1;

  positiveLines.forEach((it, idx) => {
    const base = round2(it.line_total ?? 0);
    const share = sumTaxable > 0 ? base / sumTaxable : 1 / positiveLines.length;
    const last = idx === lastIdx;
    const cg = last ? round2(totC - cAlloc) : round2(totC * share);
    const sg = last ? round2(totS - sAlloc) : round2(totS * share);
    cAlloc = round2(cAlloc + cg);
    sAlloc = round2(sAlloc + sg);
    const combined = base > 0 ? round2(((cg + sg) / base) * 100) : 0;
    it.cgst_amount = cg;
    it.sgst_amount = sg;
    it.igst_amount = null;
    it.taxable_value = base;
    it.gst_rate = combined > 0 ? combined : null;
  });
}

/**
 * E‑commerce: single product line + grand total gap → append adjustment row.
 */
export function maybeAppendAdjustmentForGrandTotal(e: IndianGstInvoiceExtract): void {
  const grand = e.grand_total;
  if (!grand || grand <= 0 || e.items.length !== 1) return;

  const hasNegative = e.items.some((it) => (it.line_total ?? 0) < 0);
  if (hasNegative) return;

  const sumAmt = e.items.reduce((s, it) => s + (it.line_total ?? 0), 0);
  const adjustment = round2(grand - sumAmt);
  if (adjustment > -500 || adjustment < -250_000) return;

  const headerTax = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  const expectedProductIncl =
    e.subtotal != null && e.subtotal > 0 && headerTax > 0.01
      ? round2(e.subtotal + headerTax)
      : null;

  const main = e.items[0];
  const mainAmt = main.line_total ?? 0;

  if (expectedProductIncl != null) {
    if (Math.abs(mainAmt - expectedProductIncl) > 300) return;
  } else {
    const nearK = Math.round(adjustment / 1000) * 1000;
    if (Math.abs(adjustment - nearK) > 50) return;
    if (Math.abs(adjustment) < 5000) return;
  }

  e.items.push({
    description: 'Exchange / adjustment (from invoice total)',
    hsn_code: null,
    qty: 1,
    unit: 'PCS',
    rate: adjustment,
    discount_amount: null,
    gst_rate: 0,
    tax_mode: null,
    taxable_value: adjustment,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: adjustment,
    discount_on_tax_inclusive: false,
  });
}

/**
 * E‑commerce / MRP lines under **exclusive** header: list rate × qty × (1+GST) minus rupee discount
 * equals tax-inclusive line total. Safe to call twice (before/after numeric qty repair).
 */
function inferDiscountTaxInclusiveFromGrossWhenExclusive(it: ExtractedInvoiceLine): ExtractedInvoiceLine {
  if (it.discount_on_tax_inclusive === true) return it;
  const disc = it.discount_amount ?? 0;
  const tr = it.gst_rate ?? 0;
  const qty = it.qty ?? 1;
  const rate = it.rate ?? 0;
  const lt = it.line_total;
  if (disc <= 0 || tr <= 0 || lt == null || rate <= 0) return it;
  const grossInc = qty * rate * (1 + tr / 100);
  const tol = Math.max(2, Math.abs(lt) * 0.02);
  if (Math.abs(grossInc - disc - lt) <= tol) {
    return { ...it, discount_on_tax_inclusive: true };
  }
  return it;
}

export function normalizeIndianGstInvoiceExtract(
  input: IndianGstInvoiceExtract
): IndianGstInvoiceExtract {
  const e: IndianGstInvoiceExtract = JSON.parse(JSON.stringify(input)) as IndianGstInvoiceExtract;

  e.invoice_date = parseDateToISO(e.invoice_date);

  e.subtotal = num(e.subtotal);
  e.total_cgst = num(e.total_cgst);
  e.total_sgst = num(e.total_sgst);
  e.total_igst = num(e.total_igst);
  e.round_off = num(e.round_off);
  e.grand_total = num(e.grand_total);

  e.gst_summary = (e.gst_summary || [])
    .map((row) => ({
      gst_rate: normalizePositiveGstPercent(row.gst_rate),
      taxable_value: round2(row.taxable_value),
      cgst: round2(row.cgst),
      sgst: round2(row.sgst),
      igst: round2(row.igst),
      total_tax: round2(row.cgst + row.sgst + row.igst),
    }))
    .filter(
      (r) =>
        r.gst_rate > 0 ||
        Math.abs(r.taxable_value) > 0.01 ||
        Math.abs(r.cgst) > 0.01 ||
        Math.abs(r.sgst) > 0.01 ||
        Math.abs(r.igst) > 0.01
    );

  applyFooterAsSourceOfTruth(e);
  normalizeTaxColumns(e);
  preferTaxableSubtotalFromGrand(e);

  e.tax_type = detectTaxType(e);
  e.price_mode = detectPriceMode(e);

  /** Exclusive header but line discount applied to tax-inclusive gross (MRP column) — infer when numbers match. */
  if (e.price_mode === 'exclusive') {
    e.items = e.items.map(inferDiscountTaxInclusiveFromGrossWhenExclusive);
  }

  e.items = (e.items || [])
    .filter((it) => it && (it.description || it.line_total != null))
    .map((it) => {
      const qty = it.qty != null && it.qty > 0 ? it.qty : 1;
      const rate = it.rate != null && Number.isFinite(it.rate) ? it.rate : 0;
      const disc = it.discount_amount != null ? Math.abs(it.discount_amount) : 0;
      const lt = it.line_total != null && Number.isFinite(it.line_total) ? round2(it.line_total) : null;
      let gst_rate = normalizePositiveGstPercent(it.gst_rate ?? null);

      let taxable_value =
        it.taxable_value != null && Number.isFinite(it.taxable_value)
          ? round2(it.taxable_value)
          : null;

      let discount_on_tax_inclusive = it.discount_on_tax_inclusive;
      if (e.price_mode === 'inclusive' && disc > 0 && gst_rate > 0) {
        discount_on_tax_inclusive = true;
      }

      return {
        ...it,
        qty,
        rate,
        discount_amount: disc > 0 ? round2(disc) : null,
        gst_rate,
        line_total: lt,
        taxable_value,
        cgst_amount: num(it.cgst_amount),
        sgst_amount: num(it.sgst_amount),
        igst_amount: num(it.igst_amount),
        discount_on_tax_inclusive,
      };
    });

  /** Deterministic qty/rate OCR repair vs line_total (thermal / retail). */
  applyNumericOcrReconciliationToExtract(e);

  /** Re-run after qty/rate repair — OCR qty drift can block grossInc − discount ≈ line_total match. */
  if (e.price_mode === 'exclusive') {
    e.items = e.items.map(inferDiscountTaxInclusiveFromGrossWhenExclusive);
  }

  e.items = e.items.map((it) => ({
    ...it,
    gst_rate: reconcileLineGstRateFromEvidence(it),
  }));

  e.items = e.items.map((it) => {
    const lt = it.line_total;
    const g = it.gst_rate ?? 0;
    let taxable_value = it.taxable_value;
    if (taxable_value == null && lt != null && lt > 0 && g > 0) {
      taxable_value = round2(lt / (1 + g / 100));
    }
    return { ...it, taxable_value };
  });

  // Infer missing line gst_rate from gst_summary when many lines lack rate
  const headerTaxSum = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  const slabs = e.gst_summary.length > 0 ? e.gst_summary : null;
  if (headerTaxSum > 0.01 && slabs && slabs.length > 0 && e.items.length > 0) {
    const zeroRateCount = e.items.filter((it) => !it.gst_rate || it.gst_rate <= 0).length;
    const mostlyMissing = zeroRateCount / e.items.length >= 0.5;
    if (mostlyMissing && slabs.length === 1) {
      const rate = slabs[0].gst_rate;
      e.items = e.items.map((it) => ({
        ...it,
        gst_rate: (it.gst_rate || 0) > 0 ? it.gst_rate! : rate,
      }));
    } else if (mostlyMissing && slabs.length > 1) {
      type L = ExtractedInvoiceLine & { _taxable_est: number };
      const lines: L[] = e.items.map((it) => {
        const qty = it.qty ?? 1;
        const up = it.rate ?? 0;
        const disc = it.discount_amount != null ? Math.abs(it.discount_amount) : 0;
        const lt = it.line_total ?? 0;
        const est =
          qty > 0 && up > 0 ? Math.max(0, qty * up - disc) : Math.max(0, lt > 0 ? lt / 1.18 : 0);
        return { ...it, _taxable_est: est };
      });
      const validSlabs = slabs
        .map((s) => ({
          rate: s.gst_rate,
          taxable: s.taxable_value,
        }))
        .filter((s) => s.rate > 0 && s.taxable > 0)
        .sort((a, b) => b.taxable - a.taxable);
      const remaining = validSlabs.map((s) => ({ ...s, remaining: s.taxable }));
      const tolerance = Math.max(5, remaining.reduce((x, s) => x + s.taxable, 0) * 0.01);
      lines.sort((a, b) => b._taxable_est - a._taxable_est);
      for (const line of lines) {
        if ((line.gst_rate || 0) > 0) continue;
        const val = line._taxable_est;
        if (val <= 0) continue;
        let bestIdx = 0;
        let bestScore = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const rem = remaining[i].remaining;
          const after = rem - val;
          const overshoot = after < 0 ? Math.abs(after) : 0;
          if (overshoot > tolerance) continue;
          const score = Math.abs(after);
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        remaining[bestIdx].remaining -= val;
        line.gst_rate = remaining[bestIdx].rate;
      }
      e.items = lines.map(({ _taxable_est, ...rest }) => rest);
    }
  }

  if (e.grand_total && e.subtotal) {
    const taxSum = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
    const computed = e.subtotal + taxSum + (e.round_off ?? 0);
    const tolerance = Math.max(2, e.grand_total * 0.02);
    if (Math.abs(computed - e.grand_total) > tolerance) {
      console.log(
        `[IndianGstExtract] Header reconciliation: subtotal(${e.subtotal}) + tax(${taxSum}) + ro = ${computed} vs grand ${e.grand_total}`
      );
    }
  }

  if (!e.grand_total && e.subtotal) {
    const taxSum = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
    e.grand_total = round2(e.subtotal + taxSum + (e.round_off ?? 0));
  }

  maybeAppendAdjustmentForGrandTotal(e);
  applyConsolidatedForeignTaxSplit(e);
  preferTaxableSubtotalFromGrand(e);
  scaleExclusiveLinesToFooterTaxableWhenDiscounted(e);
  distributePrintedHeaderGstToExclusiveLines(e);
  recomputeGstSummaryFromAuthoritativeLines(e);
  return e;
}

/**
 * Replace `gst_summary` and header tax/subtotal figures from **line items** (tax-inclusive
 * `line_total` + `gst_rate`), so slab taxable/CGST/SGST/IGST always roll up to the same lines
 * shown in the review UI. Footer slab OCR is discarded after normalization.
 *
 * Exported for callers that append OCR-recovered rows after the main normalize pass.
 */
export function recomputeGstSummaryFromAuthoritativeLines(e: IndianGstInvoiceExtract): void {
  if (!e.items?.length) return;

  const taxType = e.tax_type ?? detectTaxType(e);
  const priceMode = e.price_mode ?? 'exclusive';

  type Acc = { taxable: number; cgst: number; sgst: number; igst: number };
  const buckets = new Map<number, Acc>();

  const bump = (
    rateKey: number,
    taxable: number,
    cg: number,
    sg: number,
    ig: number,
  ) => {
    const key = Number.isFinite(rateKey) ? rateKey : 0;
    const acc = buckets.get(key) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    acc.taxable = round2(acc.taxable + taxable);
    acc.cgst = round2(acc.cgst + cg);
    acc.sgst = round2(acc.sgst + sg);
    acc.igst = round2(acc.igst + ig);
    buckets.set(key, acc);
  };

  /** Footer SGST≠CGST (or OCR line splits): roll up rupee columns without forcing ½/½ split. */
  const usePrintedLineSplitsCgst =
    taxType === 'cgst_sgst' &&
    priceMode === 'exclusive' &&
    e.items.some(
      (it) => Math.abs(it.cgst_amount ?? 0) > 0.015 || Math.abs(it.sgst_amount ?? 0) > 0.015,
    );

  const usePrintedLineSplitsIg =
    taxType === 'igst' &&
    priceMode === 'exclusive' &&
    e.items.some((it) => Math.abs(it.igst_amount ?? 0) > 0.015);

  for (const it of e.items) {
    const lt = it.line_total;
    if (lt == null || !Number.isFinite(lt)) continue;

    const cgP = Math.abs(it.cgst_amount ?? 0) > 0.005 ? round2(it.cgst_amount!) : 0;
    const sgP = Math.abs(it.sgst_amount ?? 0) > 0.005 ? round2(it.sgst_amount!) : 0;
    const igP = Math.abs(it.igst_amount ?? 0) > 0.005 ? round2(it.igst_amount!) : 0;

    if (usePrintedLineSplitsCgst && cgP + sgP > 0.01) {
      const taxableBase =
        it.taxable_value != null && it.taxable_value > 0.01 ? round2(it.taxable_value) : round2(lt);
      const rRaw = taxableBase > 0 ? round2(((cgP + sgP) / taxableBase) * 100) : 0;
      const rKey = nearestGstRateForExtract(rRaw, e);
      bump(rKey, taxableBase, cgP, sgP, 0);
      continue;
    }

    if (usePrintedLineSplitsIg && igP > 0.01) {
      const taxableBase =
        it.taxable_value != null && it.taxable_value > 0.01 ? round2(it.taxable_value) : round2(lt);
      const rRaw = taxableBase > 0 ? round2((igP / taxableBase) * 100) : 0;
      const rKey = nearestGstRateForExtract(rRaw, e);
      bump(rKey, taxableBase, 0, 0, igP);
      continue;
    }

    const r = nearestGstRateForExtract((it.gst_rate ?? 0) as number, e);

    let taxable: number;
    let tax: number;

    if (r <= 0) {
      taxable = lt;
      tax = 0;
    } else {
      const tvRaw = it.taxable_value;
      const derivedTaxable = round2(lt / (1 + r / 100));
      const tol = Math.max(0.05, Math.abs(lt) * 0.012);
      if (
        tvRaw != null &&
        Number.isFinite(tvRaw) &&
        tvRaw > 0.01 &&
        Math.abs(round2(tvRaw) * (1 + r / 100) - lt) <= tol
      ) {
        taxable = round2(tvRaw);
      } else {
        taxable = derivedTaxable;
      }
      tax = round2(lt - taxable);
    }

    const totalTaxRounded = round2(tax);
    let cg = 0;
    let sg = 0;
    let ig = 0;
    if (taxType === 'igst') {
      ig = totalTaxRounded;
    } else if (totalTaxRounded > 0.005) {
      cg = round2(totalTaxRounded / 2);
      sg = round2(totalTaxRounded - cg);
    }

    bump(r <= 0 ? 0 : r, taxable, cg, sg, ig);
  }

  if (buckets.size === 0) return;

  const rates = [...buckets.keys()].sort((a, b) => a - b);
  const rows: GstSummarySlabRow[] = [];

  for (const gst_rate of rates) {
    const acc = buckets.get(gst_rate)!;
    const { taxable: taxable_value, cgst: cgTot, sgst: sgTot, igst: igTot } = acc;

    if (gst_rate <= 0) {
      rows.push({
        gst_rate: 0,
        taxable_value: round2(taxable_value),
        cgst: 0,
        sgst: 0,
        igst: 0,
        total_tax: 0,
      });
      continue;
    }

    rows.push({
      gst_rate,
      taxable_value: round2(taxable_value),
      cgst: round2(cgTot),
      sgst: round2(sgTot),
      igst: round2(igTot),
      total_tax: round2(cgTot + sgTot + igTot),
    });
  }

  e.gst_summary = rows;

  let sub = 0;
  let c = 0;
  let s = 0;
  let igsum = 0;
  for (const row of rows) {
    sub = round2(sub + row.taxable_value);
    c = round2(c + row.cgst);
    s = round2(s + row.sgst);
    igsum = round2(igsum + row.igst);
  }
  e.subtotal = sub;
  e.total_cgst = c;
  e.total_sgst = s;
  e.total_igst = igsum;
}

export function transformExtractToPurchaseReviewFormat(
  extraction: IndianGstInvoiceExtract
): PurchaseReviewExtractPayload {
  const headerTaxSum =
    (extraction.total_cgst ?? 0) + (extraction.total_sgst ?? 0) + (extraction.total_igst ?? 0);

  const headerPriceMode = extraction.price_mode ?? 'exclusive';

  const items = (extraction.items || []).map((item) => {
    const unitPriceRaw = item.rate ?? 0;
    const discount = item.discount_amount ?? 0;
    const qRaw = item.qty;
    const qParsed = typeof qRaw === 'number' && Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 1;
    const quantity = Math.max(0.0001, roundRetailQty(qParsed));
    const taxRate = item.gst_rate ?? 0;
    const amountRaw =
      typeof item.line_total === 'number' && Number.isFinite(item.line_total)
        ? item.line_total
        : 0;

    if (amountRaw < 0 && taxRate === 0) {
      const up = roundExclusiveUnitPrice(amountRaw / quantity);
      return {
        item_name: item.description,
        hsn_sac: item.hsn_code,
        quantity,
        unit_price: up,
        amount: round2(amountRaw),
        unit: item.unit || 'PCS',
        discount_percent: 0,
        discount_amount: 0,
        discount_on_tax_inclusive: false,
        tax_rate: 0,
        tax_mode: item.tax_mode ?? headerPriceMode,
        taxable_value: item.taxable_value,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
      };
    }

    const grossAmount = unitPriceRaw * quantity;
    const discountPercentForMath =
      grossAmount > 0 && discount > 0
        ? Math.round((discount / grossAmount) * 100 * 100) / 100
        : 0;
    const discountAmountRounded = discount > 0 ? round2(discount) : 0;

    /**
     * E‑commerce / MRP lines: list price is **exclusive**; printed **Gross** is list×(1+GST);
     * rupee discount comes off that inclusive gross so `grossInc − discount ≈ line_total`.
     * If `discount_on_tax_inclusive` was not set in normalize (model omission), infer here so
     * we do not recompute `amount` as `(exclusive − discount)×(1+GST)` (too low).
     */
    let discOffInc = item.discount_on_tax_inclusive === true;
    if (
      !discOffInc &&
      headerPriceMode === 'exclusive' &&
      discountAmountRounded > 0 &&
      taxRate > 0 &&
      amountRaw > 0 &&
      unitPriceRaw > 0
    ) {
      const grossInc = quantity * unitPriceRaw * (1 + taxRate / 100);
      const errOffInclusiveGross = Math.abs(grossInc - discountAmountRounded - amountRaw);
      const netExclAfterDisc = quantity * unitPriceRaw - discountAmountRounded;
      const errOffExclusive = Math.abs(netExclAfterDisc * (1 + taxRate / 100) - amountRaw);
      const tol = Math.max(2, Math.abs(amountRaw) * 0.02);
      /** Prefer MRP-style only when it fits better than discount-off-exclusive (avoids 2% tol false positives). */
      if (errOffInclusiveGross <= tol && errOffInclusiveGross < errOffExclusive) {
        discOffInc = true;
      }
    }

    let unit_price = unitPriceRaw;
    if (
      discOffInc &&
      discountAmountRounded > 0 &&
      amountRaw > 0 &&
      taxRate > 0 &&
      quantity > 0
    ) {
      unit_price = roundExclusiveUnitPrice(
        (amountRaw + discountAmountRounded) / quantity / (1 + taxRate / 100),
      );
    } else if (amountRaw > 0 && quantity > 0) {
      const derived = deriveUnitPriceFromInvoiceLine(
        amountRaw,
        quantity,
        discountPercentForMath,
        taxRate,
        unitPriceRaw
      );
      if (derived > 0) unit_price = roundExclusiveUnitPrice(derived);
    }

    const amount =
      unit_price > 0
        ? discountAmountRounded > 0
          ? round2(
              inclusiveLineTotalWithDiscountAmount(
                quantity,
                unit_price,
                discountAmountRounded,
                taxRate,
                discOffInc
              )
            )
          : round2(inclusiveLineTotal(quantity, unit_price, discountPercentForMath, taxRate))
        : 0;

    return {
      item_name: item.description,
      hsn_sac: item.hsn_code,
      quantity,
      unit_price,
      amount,
      unit: item.unit || 'PCS',
      discount_percent: discountAmountRounded > 0 ? 0 : discountPercentForMath,
      discount_amount: discountAmountRounded,
      discount_on_tax_inclusive: Boolean(discOffInc && discountAmountRounded > 0 && taxRate > 0),
      tax_rate: taxRate,
      tax_mode:
        taxRate > 0 && amountRaw > 0
          ? 'exclusive'
          : item.tax_mode === 'inclusive' || item.tax_mode === 'exclusive'
            ? item.tax_mode
            : headerPriceMode,
      taxable_value: item.taxable_value,
      cgst_amount: item.cgst_amount,
      sgst_amount: item.sgst_amount,
      igst_amount: item.igst_amount,
    };
  });

  const sumLineTaxable = items.reduce((s, it) => {
    const tr = it.tax_rate ?? 0;
    const a = it.amount ?? 0;
    if (Math.abs(a) < 1e-9) return s;
    if (tr === 0) return s + a;
    return s + a / (1 + tr / 100);
  }, 0);

  const sumLineInclusive = items.reduce((s, it) => s + (it.amount ?? 0), 0);

  const subtotalDisplay =
    extraction.subtotal != null && extraction.subtotal > 0
      ? extraction.subtotal
      : sumLineTaxable !== 0
        ? round2(sumLineTaxable)
        : null;

  const grandTotal =
    extraction.grand_total != null && extraction.grand_total > 0
      ? extraction.grand_total
      : sumLineInclusive > 0
        ? round2(sumLineInclusive)
        : null;

  const posRaw = (extraction.place_of_supply || '').trim();
  let place_of_supply_state_code: string | null = null;
  if (/^\d{2}$/.test(posRaw)) {
    place_of_supply_state_code = posRaw;
  } else if (posRaw) {
    const fromName = getStateCode(posRaw);
    place_of_supply_state_code = fromName || null;
  }

  return {
    supplier: {
      name: extraction.supplier_name,
      gstin: extraction.supplier_gstin,
      address: null,
    },
    invoice: {
      bill_number: extraction.invoice_number,
      bill_date: extraction.invoice_date,
      document_type: 'tax_invoice',
      place_of_supply: extraction.place_of_supply,
      place_of_supply_state_code,
      tax_type: extraction.tax_type,
      price_mode: extraction.price_mode,
      buyer_gstin: extraction.buyer_gstin,
    },
    items,
    totals: {
      subtotal: subtotalDisplay,
      grand_total: grandTotal,
      round_off:
        extraction.round_off != null && Number.isFinite(extraction.round_off)
          ? round2(extraction.round_off)
          : null,
      tax_amount: headerTaxSum > 0 ? headerTaxSum : null,
      cgst: extraction.total_cgst ?? null,
      sgst: extraction.total_sgst ?? null,
      igst: extraction.total_igst ?? null,
      gst_summary: extraction.gst_summary ?? [],
    },
  };
}
