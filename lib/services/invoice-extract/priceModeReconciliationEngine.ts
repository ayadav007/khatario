/**
 * Evidence-driven price_mode reconciliation (exclusive vs inclusive).
 *
 * Invariant: printed tax > inferred tax. Never reverse-calculate GST when the
 * document already prints rupee CGST/SGST/IGST at line or footer level.
 */

import type {
  ExtractedInvoiceLine,
  IndianGstInvoiceExtract,
  InvoicePriceMode,
} from '@/lib/indian-gst-invoice-extract';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function tolMoney(base: number): number {
  return Math.max(0.05, Math.min(2.5, Math.abs(base) * 0.015));
}

export type ClassifiedPriceBasis = 'inclusive' | 'exclusive' | 'unknown';

export interface PriceModeReconciliationResult {
  /** Null when the printed columns do not decide a mode. Never a silent exclusive. */
  priceMode: InvoicePriceMode | null;
  exclusiveScore: number;
  inclusiveScore: number;
  /** Lower residual = better fit (₹). */
  exclusiveResidual: number;
  inclusiveResidual: number;
  signals: string[];
}

export function lineHasPrintedTax(it: ExtractedInvoiceLine): boolean {
  return (
    Math.abs(it.cgst_amount ?? 0) > 0.005 ||
    Math.abs(it.sgst_amount ?? 0) > 0.005 ||
    Math.abs(it.igst_amount ?? 0) > 0.005
  );
}

export function extractHasPrintedTax(e: IndianGstInvoiceExtract): boolean {
  const headerTax =
    (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
  if (headerTax > 0.01) return true;
  for (const row of e.gst_summary ?? []) {
    if (Math.abs(row.cgst) + Math.abs(row.sgst) + Math.abs(row.igst) > 0.01) {
      return true;
    }
  }
  return (e.items ?? []).some(lineHasPrintedTax);
}

function sumPositiveLineTotals(items: ExtractedInvoiceLine[]): number {
  let s = 0;
  for (const it of items) {
    const lt = it.line_total;
    if (lt != null && Number.isFinite(lt) && lt > 0) s = round2(s + lt);
  }
  return s;
}

function nearMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= tolMoney(b);
}

/** Printed item-column amount. A missing or zero amount is not evidence. */
function originalItemAmount(it: ExtractedInvoiceLine): number | null {
  const raw = it.source_line_total !== undefined ? it.source_line_total : it.line_total;
  if (raw == null || !Number.isFinite(raw) || raw === 0) return null;
  return raw;
}

function originalTaxableAmount(it: ExtractedInvoiceLine): number | null {
  const raw = it.source_taxable_value !== undefined ? it.source_taxable_value : it.taxable_value;
  if (raw == null || !Number.isFinite(raw) || raw === 0) return null;
  return raw;
}

function qtyTimesRate(it: ExtractedInvoiceLine): number | null {
  return qtyRateBase(it);
}

/**
 * Slab labels such as "3) CGST @ 9%, SGST @ 9%" are not products.
 * A real item whose name mentions GST and which has a printed amount stays.
 */
export function isGstBandHeadingLine(it: ExtractedInvoiceLine): boolean {
  const name = (it.description ?? '').trim();
  if (!name) return false;
  const amount = originalItemAmount(it);
  if (amount != null && Math.abs(amount) > 0.5) return false;
  if (!/\b(cgst|sgst|igst|utgst)\b/i.test(name)) return false;
  if (!/[@%]|\bgst\b/i.test(name)) return false;
  const leftover = name
    .replace(/^\s*\d+\s*[).:-]?\s*/, '')
    .replace(/\b(cgst|sgst|igst|utgst|gst|total)\b/gi, '')
    .replace(/@/g, '')
    .replace(/%/g, '')
    .replace(/[\d.,]+/g, '')
    .replace(/[^a-z]+/gi, '');
  return leftover.length <= 2;
}

export function omitGstBandHeadingLines(items: ExtractedInvoiceLine[]): ExtractedInvoiceLine[] {
  return items.filter((it) => !isGstBandHeadingLine(it));
}

function productLines(items: ExtractedInvoiceLine[]): ExtractedInvoiceLine[] {
  return omitGstBandHeadingLines(items);
}

function sumItemColumn(items: ExtractedInvoiceLine[]): { sum: number; counted: number } {
  let sum = 0;
  let counted = 0;
  for (const it of items) {
    const amount = originalItemAmount(it);
    if (amount == null || amount < 0) continue;
    sum = round2(sum + amount);
    counted += 1;
  }
  return { sum, counted };
}

function footerTaxable(e: IndianGstInvoiceExtract): number | null {
  const raw = e.printed_subtotal !== undefined ? e.printed_subtotal : e.subtotal;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function footerPayable(e: IndianGstInvoiceExtract): number | null {
  const raw = e.printed_grand_total !== undefined ? e.printed_grand_total : e.grand_total;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function slabRows(e: IndianGstInvoiceExtract) {
  return e.printed_gst_summary !== undefined ? (e.printed_gst_summary ?? []) : (e.gst_summary ?? []);
}

type BandVote = 'inclusive' | 'exclusive' | 'neutral';

function voteGstBand(e: IndianGstInvoiceExtract, lines: ExtractedInvoiceLine[]): BandVote[] {
  const votes: BandVote[] = [];
  for (const row of slabRows(e)) {
    const rate = row.gst_rate;
    if (rate == null || !Number.isFinite(rate)) continue;
    const members = lines.filter((it) => Math.abs((it.gst_rate ?? 0) - rate) <= 0.2);
    const { sum, counted } = sumItemColumn(members);
    if (counted === 0) continue;
    const taxable = row.taxable_value > 0.01 ? row.taxable_value : null;
    if (taxable == null) continue;
    const tax = round2((row.cgst ?? 0) + (row.sgst ?? 0) + (row.igst ?? 0));
    const payable = round2(taxable + tax);
    const matchPay = nearMoney(sum, payable);
    const matchTax = nearMoney(sum, taxable);
    if (tax <= 0.01 && matchPay && matchTax) {
      votes.push('neutral');
      continue;
    }
    if (matchPay && !matchTax) votes.push('inclusive');
    else if (matchTax && !matchPay) votes.push('exclusive');
    else votes.push('neutral');
  }
  return votes;
}

function lineIsPrintedCharge(it: ExtractedInvoiceLine): boolean {
  const item = originalItemAmount(it);
  const base = qtyTimesRate(it);
  if (item == null || base == null) return false;
  return nearMoney(base, item);
}

function lineIsExclusiveGross(it: ExtractedInvoiceLine): boolean {
  const item = originalItemAmount(it);
  const base = qtyTimesRate(it);
  const taxable = originalTaxableAmount(it);
  const gst = it.gst_rate ?? 0;
  if (item == null || !(gst > 0)) return false;
  if (base != null && nearMoney(base, item)) return false;
  if (base != null && nearMoney(base * (1 + gst / 100), item)) return true;
  if (taxable != null && !nearMoney(taxable, item) && nearMoney(taxable * (1 + gst / 100), item)) {
    return true;
  }
  return false;
}

/**
 * Decide from the original item column, the printed taxable total, and the payable.
 * taxable + GST = payable is true of both bill types and is not a vote.
 * A missing total is not a match.
 */
export function classifyPrintedPriceBasis(e: IndianGstInvoiceExtract): ClassifiedPriceBasis {
  const lines = productLines(e.items ?? []);
  const { sum, counted } = sumItemColumn(lines);
  if (counted === 0) return 'unknown';

  const taxable = footerTaxable(e);
  const payable = footerPayable(e);
  const tax = bestPrintedTaxTotal(e);
  const ro = e.round_off ?? 0;
  const matchPay = payable != null && nearMoney(round2(sum + ro), payable);
  const matchTax = taxable != null && nearMoney(sum, taxable);
  const matchAdditive =
    payable != null &&
    tax > 0.01 &&
    !matchPay &&
    nearMoney(round2(sum + tax + ro), payable);

  if (matchPay && !matchTax) {
    const grossLines = lines.filter(lineIsExclusiveGross);
    const chargeLines = lines.filter(lineIsPrintedCharge);
    if (grossLines.length > 0 && chargeLines.length === 0) return 'exclusive';
    if (grossLines.length > 0 && chargeLines.length > 0) return 'unknown';
    return 'inclusive';
  }
  if ((matchTax && !matchPay) || matchAdditive) return 'exclusive';
  if (matchPay && matchTax) {
    return tax <= 0.01 ? 'exclusive' : 'unknown';
  }

  const votes = voteGstBand(e, lines).filter((v) => v !== 'neutral');
  if (votes.length > 0 && votes.every((v) => v === 'inclusive')) return 'inclusive';
  if (votes.length > 0 && votes.every((v) => v === 'exclusive')) return 'exclusive';
  if (votes.some((v) => v === 'inclusive') && votes.some((v) => v === 'exclusive')) return 'unknown';

  let taxed = 0;
  let taxableColumn = 0;
  for (const it of lines) {
    if (!((it.gst_rate ?? 0) > 0)) continue;
    taxed += 1;
    const item = originalItemAmount(it);
    const tv = originalTaxableAmount(it);
    const base = qtyTimesRate(it);
    if (
      item != null &&
      tv != null &&
      base != null &&
      nearMoney(base, item) &&
      nearMoney(item, tv)
    ) {
      taxableColumn += 1;
    }
  }
  if (taxed > 0 && taxableColumn === taxed) return 'exclusive';
  return 'unknown';
}

function sumPrintedLineTax(items: ExtractedInvoiceLine[]): number {
  let s = 0;
  for (const it of items) {
    s = round2(s + (it.cgst_amount ?? 0) + (it.sgst_amount ?? 0) + (it.igst_amount ?? 0));
  }
  return s;
}

function headerPrintedTax(e: IndianGstInvoiceExtract): number {
  return round2((e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0));
}

function gstSummaryTax(e: IndianGstInvoiceExtract): number {
  let s = 0;
  for (const row of e.gst_summary ?? []) {
    s = round2(s + (row.cgst ?? 0) + (row.sgst ?? 0) + (row.igst ?? 0));
  }
  return s;
}

/** Best available printed tax total (footer header > gst_summary > line sums). */
export function bestPrintedTaxTotal(e: IndianGstInvoiceExtract): number {
  const header = headerPrintedTax(e);
  if (header > 0.01) return header;
  const slab = gstSummaryTax(e);
  if (slab > 0.01) return slab;
  const line = sumPrintedLineTax(e.items ?? []);
  return line > 0.01 ? line : 0;
}

function qtyRateBase(it: ExtractedInvoiceLine): number | null {
  const qty = it.qty;
  const rate = it.rate;
  if (qty == null || rate == null || !Number.isFinite(qty) || !Number.isFinite(rate)) {
    return null;
  }
  if (!(qty > 0) || !(rate > 0)) return null;
  return round2(qty * rate);
}

/**
 * POS / restaurant pattern: Amount column = taxable, footer tax is additive.
 */
export function matchesExclusivePosPattern(e: IndianGstInvoiceExtract): boolean {
  const grand = e.printed_grand_total !== undefined ? e.printed_grand_total : e.grand_total;
  if (grand == null || !Number.isFinite(grand) || grand <= 0) return false;

  const printedTax = bestPrintedTaxTotal(e);
  if (printedTax < 0.01) return false;

  const lineSum = sumItemColumn(productLines(e.items ?? [])).sum;
  if (lineSum <= 0) return false;

  const ro = e.round_off ?? 0;

  // The item column already is the payable. Footer taxable + GST = payable is not exclusive.
  const taxable = footerTaxable(e);
  if (nearMoney(round2(lineSum + ro), grand) && (taxable == null || !nearMoney(lineSum, taxable))) {
    return false;
  }

  /** Item column is the taxable amount, and printed tax is added to reach the payable. */
  if (nearMoney(round2(lineSum + printedTax + ro), grand)) return true;

  return false;
}

function scoreExclusive(e: IndianGstInvoiceExtract): {
  score: number;
  residual: number;
  signals: string[];
} {
  const signals: string[] = [];
  let score = 0;
  const grand = e.grand_total ?? 0;
  const ro = e.round_off ?? 0;
  const printedTax = bestPrintedTaxTotal(e);
  const lineSum = sumPositiveLineTotals(e.items ?? []);
  const sub = e.subtotal ?? 0;

  if (printedTax > 0.01) {
    score += 12;
    signals.push('footer_or_line_printed_tax');
  }

  if (grand > 0 && lineSum > 0 && grand > lineSum + 0.05) {
    score += 8;
    signals.push('grand_total_exceeds_line_sum');
  }

  if (grand > 0 && printedTax > 0.01) {
    const storyA = lineSum > 0 ? lineSum + printedTax + ro : 0;
    const storyB = sub > 0 ? sub + printedTax + ro : 0;
    const tol = tolMoney(grand);
    const fitA = storyA > 0 ? Math.abs(storyA - grand) : Infinity;
    const fitB = storyB > 0 ? Math.abs(storyB - grand) : Infinity;
    const bestFit = Math.min(fitA, fitB);
    if (bestFit <= tol) {
      score += 15;
      signals.push('taxable_plus_printed_tax_matches_grand');
    }
  }

  for (const it of e.items ?? []) {
    if (lineHasPrintedTax(it)) {
      score += 4;
      signals.push('printed_line_tax_column');
      break;
    }
  }

  let qtyRateHits = 0;
  for (const it of e.items ?? []) {
    const base = qtyRateBase(it);
    const lt = it.line_total;
    if (base == null || lt == null) continue;
    if (Math.abs(base - lt) <= tolMoney(lt)) qtyRateHits++;
  }
  if (qtyRateHits > 0 && (e.items?.length ?? 0) > 0) {
    score += 3 * Math.min(qtyRateHits, 3);
    signals.push('qty_times_rate_equals_line_amount');
  }

  /** Residual: how far exclusive story is from grand total. */
  let residual = Infinity;
  if (grand > 0 && printedTax > 0.01) {
    const taxableGuess =
      sub > 0.01 && Math.abs(sub + printedTax + ro - grand) <= tolMoney(grand)
        ? sub
        : lineSum;
    if (taxableGuess > 0) {
      residual = Math.abs(taxableGuess + printedTax + ro - grand);
    }
  }

  return { score, residual, signals };
}

function scoreInclusive(e: IndianGstInvoiceExtract): {
  score: number;
  residual: number;
  signals: string[];
} {
  const signals: string[] = [];
  let score = 0;
  const grand = e.grand_total ?? 0;
  const ro = e.round_off ?? 0;
  const lineSum = sumPositiveLineTotals(e.items ?? []);
  const printedTax = bestPrintedTaxTotal(e);

  if (grand > 0 && lineSum > 0 && Math.abs(lineSum + ro - grand) <= tolMoney(grand)) {
    score += 10;
    signals.push('line_sum_equals_grand');
  }

  if (printedTax < 0.01 && grand > 0 && lineSum > 0) {
    score += 4;
    signals.push('no_separate_printed_tax');
  }

  /** Penalize inclusive when footer tax clearly adds on top of line amounts. */
  if (printedTax > 0.01 && grand > lineSum + 0.05) {
    score -= 10;
    signals.push('printed_tax_additive_penalty');
  }

  let reverseHits = 0;
  for (const it of e.items ?? []) {
    const lt = it.line_total;
    const r = it.gst_rate ?? 0;
    if (lt == null || !(lt > 0) || !(r > 0)) continue;
    const derived = round2(lt / (1 + r / 100));
    const tax = round2(lt - derived);
    const cg = it.cgst_amount ?? 0;
    const sg = it.sgst_amount ?? 0;
    const ig = it.igst_amount ?? 0;
    const printed = cg + sg + ig;
    if (printed > 0.01 && Math.abs(tax - printed) > 0.15) {
      score -= 6;
      signals.push('reverse_tax_conflicts_with_printed_line_tax');
      break;
    }
    if (printed < 0.01 && Math.abs(derived * (r / 100) - tax) < 0.15) {
      reverseHits++;
    }
  }
  if (reverseHits > 0) {
    score += 3;
    signals.push('reverse_gst_fits_line');
  }

  let residual = Infinity;
  if (grand > 0 && lineSum > 0) {
    residual = Math.abs(lineSum + ro - grand);
  }

  return { score, residual, signals };
}

/**
 * Choose exclusive vs inclusive by evidence scoring; tie-break on lower ₹ residual.
 */
export function reconcilePriceModeFromEvidence(
  e: IndianGstInvoiceExtract,
): PriceModeReconciliationResult {
  const ex = scoreExclusive(e);
  const inc = scoreInclusive(e);
  const signals = [...ex.signals, ...inc.signals.filter((s) => !ex.signals.includes(s))];

  const basis = classifyPrintedPriceBasis(e);
  let priceMode: InvoicePriceMode | null = null;

  if (basis === 'inclusive') {
    priceMode = 'inclusive';
    signals.push('item_column_matches_payable');
  } else if (basis === 'exclusive' || matchesExclusivePosPattern(e)) {
    priceMode = 'exclusive';
    signals.push(basis === 'exclusive' ? 'item_column_matches_taxable' : 'exclusive_pos_hard_rule');
  } else {
    signals.push('price_basis_unknown');
  }

  return {
    priceMode,
    exclusiveScore: ex.score,
    inclusiveScore: inc.score,
    exclusiveResidual: ex.residual,
    inclusiveResidual: inc.residual,
    signals,
  };
}

/**
 * When exclusive evidence wins, align line totals with printed taxable + printed tax.
 * Mutates `e` in place. Does not reverse-calculate GST when printed splits exist.
 */
export function applyExclusiveSemanticsFromPrintedEvidence(e: IndianGstInvoiceExtract): void {
  if (!extractHasPrintedTax(e)) return;

  const grand = e.grand_total;
  const printedTax = bestPrintedTaxTotal(e);

  for (const it of e.items ?? []) {
    const cg = Math.abs(it.cgst_amount ?? 0) > 0.005 ? round2(it.cgst_amount!) : 0;
    const sg = Math.abs(it.sgst_amount ?? 0) > 0.005 ? round2(it.sgst_amount!) : 0;
    const ig = Math.abs(it.igst_amount ?? 0) > 0.005 ? round2(it.igst_amount!) : 0;
    const lineTax = round2(cg + sg + ig);

    let taxable: number | null = null;
    if (it.taxable_value != null && it.taxable_value > 0.01) {
      taxable = round2(it.taxable_value);
    } else {
      const base = qtyRateBase(it);
      const lt = it.line_total;
      if (base != null && lt != null && Math.abs(base - lt) <= tolMoney(lt)) {
        taxable = round2(lt);
      } else if (lt != null && lineTax > 0.01 && grand != null && grand > lt + 0.02) {
        taxable = round2(lt);
      }
    }

    if (taxable == null) continue;

    it.taxable_value = taxable;

    if (lineTax > 0.01) {
      it.line_total = round2(taxable + lineTax);
      continue;
    }

    const r = it.gst_rate ?? 0;
    if (r > 0 && e.price_mode === 'exclusive') {
      const taxFromRate = round2((taxable * r) / 100);
      it.line_total = round2(taxable + taxFromRate);
    }
  }

  /** Prefer footer printed tax for header totals when present. */
  const headerTax = headerPrintedTax(e);
  const lineTaxSum = sumPrintedLineTax(e.items ?? []);
  const taxForHeader = headerTax > 0.01 ? headerTax : lineTaxSum;

  if (taxForHeader > 0.01) {
    if ((e.total_cgst ?? 0) < 0.01 && (e.total_sgst ?? 0) < 0.01 && (e.total_igst ?? 0) < 0.01) {
      const lineC = round2(
        (e.items ?? []).reduce((s, it) => s + (it.cgst_amount ?? 0), 0),
      );
      const lineS = round2(
        (e.items ?? []).reduce((s, it) => s + (it.sgst_amount ?? 0), 0),
      );
      const lineI = round2(
        (e.items ?? []).reduce((s, it) => s + (it.igst_amount ?? 0), 0),
      );
      if (lineC + lineS + lineI > 0.01) {
        e.total_cgst = lineC > 0.01 ? lineC : e.total_cgst;
        e.total_sgst = lineS > 0.01 ? lineS : e.total_sgst;
        e.total_igst = lineI > 0.01 ? lineI : e.total_igst;
      }
    }
  }

  let sub = 0;
  for (const it of e.items ?? []) {
    const tv = it.taxable_value;
    if (tv != null && tv > 0.01) sub = round2(sub + tv);
    else if (it.line_total != null && lineHasPrintedTax(it)) {
      const lt = it.line_total!;
      const ltTax =
        (it.cgst_amount ?? 0) + (it.sgst_amount ?? 0) + (it.igst_amount ?? 0);
      sub = round2(sub + (lt - ltTax));
    }
  }
  if (sub > 0.01) {
    const ro = e.round_off ?? 0;
    const tax = bestPrintedTaxTotal(e);
    const grand = e.grand_total;
    const storyOk =
      grand != null &&
      grand > 0 &&
      tax > 0.01 &&
      Math.abs(sub + tax + ro - grand) <= tolMoney(grand);
    const allLinesCovered = (e.items ?? []).every((it) => {
      const lt = it.line_total;
      if (lt == null || lt <= 0) return true;
      return (
        (it.taxable_value != null && it.taxable_value > 0.01) || lineHasPrintedTax(it)
      );
    });
    if (storyOk || allLinesCovered) {
      e.subtotal = sub;
    }
  } else if (e.subtotal == null || e.subtotal <= 0) {
    const lineSum = sumPositiveLineTotals(e.items ?? []);
    if (lineSum > 0 && printedTax > 0.01 && grand != null && Math.abs(lineSum + printedTax - grand) <= tolMoney(grand)) {
      e.subtotal = lineSum;
    }
  }
}
