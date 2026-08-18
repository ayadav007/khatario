/**
 * Classify printed Gemini line fields and map them to exclusive purchase-form unit_price.
 * Never treats qty × rate ≈ line_total alone as proof that rate is GST-inclusive
 * (that identity is also exclusive taxable vs a copied line_total).
 */

import type { ExtractedInvoiceLine, InvoicePriceMode } from '@/lib/indian-gst-invoice-extract';
import {
  deriveUnitPriceFromInvoiceLine,
  inclusiveLineTotal,
  inclusiveLineTotalWithDiscountAmount,
} from '@/lib/invoice-line-math';
import { round2, roundExclusiveUnitPrice, roundRetailQty } from '@/lib/numeric-precision';

export type LineMappingRule =
  | 'exclusive_rate'
  | 'exclusive_from_taxable'
  | 'inclusive_rate'
  | 'marketplace_mrp'
  | 'zero_gst'
  | 'exchange';

export type LineValidationStatus = 'ok' | 'discrepancy' | 'incomplete';

export type LineDiscrepancyCode =
  | 'LINE_TOTAL_EQUALS_TAXABLE'
  | 'LINE_TOTAL_VS_COMPUTED'
  | 'QTY_MISSING'
  | 'RATE_MISSING'
  | 'INCOMPLETE';

export interface MappedPurchaseExtractLine {
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
  tax_mode: InvoicePriceMode | null;
  taxable_value: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  printed_rate: number | null;
  printed_taxable: number | null;
  printed_line_total: number | null;
  printed_gst_rate: number | null;
  printed_tax_mode: InvoicePriceMode | null;
  mapping_rule: LineMappingRule;
  validation_status: LineValidationStatus;
  discrepancy_codes: LineDiscrepancyCode[];
}

export interface MapExtractedLineContext {
  headerPriceMode: InvoicePriceMode | null;
}

function finiteNum(n: unknown): number | null {
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  return null;
}

/** Relative/absolute nearness used for printed-column identities (same order as old derive tol). */
export function amountsNear(a: number, b: number, ref?: number): boolean {
  const scale = Math.max(Math.abs(ref ?? b), Math.abs(a), 1);
  return Math.abs(a - b) <= Math.max(0.5, scale * 0.015);
}

function pushCode(codes: LineDiscrepancyCode[], code: LineDiscrepancyCode): void {
  if (!codes.includes(code)) codes.push(code);
}

function statusFrom(codes: LineDiscrepancyCode[]): LineValidationStatus {
  if (codes.includes('QTY_MISSING') || codes.includes('RATE_MISSING') || codes.includes('INCOMPLETE')) {
    if (codes.some((c) => c === 'LINE_TOTAL_EQUALS_TAXABLE' || c === 'LINE_TOTAL_VS_COMPUTED')) {
      return 'discrepancy';
    }
    return codes.length ? 'incomplete' : 'ok';
  }
  if (codes.length) return 'discrepancy';
  return 'ok';
}

/**
 * True when this review line was produced by the mapper (new extracts).
 * Historical extraction_data rows lack these fields.
 */
export function extractionLineHasProvenance(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const r = item as Record<string, unknown>;
  if (typeof r.mapping_rule === 'string' && r.mapping_rule.length > 0) return true;
  return r.printed_rate != null && Number.isFinite(Number(r.printed_rate));
}

/**
 * Old jobs stored unit_price = taxable / (1+GST) / qty. Restore exclusive unit price.
 * Does not apply when qty × unit_price already matches taxable (correct exclusive).
 */
export function maybeRestoreExclusiveUnitPriceFromLegacyExtract(item: {
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_mode?: InvoicePriceMode | null;
  taxable_value?: number | null;
}): number {
  const qty = item.quantity;
  const up = item.unit_price;
  const t = item.tax_rate;
  const taxable = item.taxable_value;
  if (!(qty > 0) || !(up > 0) || !(t > 0) || taxable == null || !(taxable > 0)) return up;
  if (item.tax_mode === 'inclusive') return up;
  const qtyTimesUp = qty * up;
  const qtyTimesUpIncl = qtyTimesUp * (1 + t / 100);
  if (amountsNear(qtyTimesUpIncl, taxable) && !amountsNear(qtyTimesUp, taxable)) {
    return roundExclusiveUnitPrice(taxable / qty);
  }
  return up;
}

export function mapExtractedLineToPurchaseLine(
  item: ExtractedInvoiceLine,
  ctx: MapExtractedLineContext,
): MappedPurchaseExtractLine {
  const codes: LineDiscrepancyCode[] = [];
  const headerMode = ctx.headerPriceMode ?? 'exclusive';
  const printedRate = finiteNum(item.rate);
  const printedTaxable = finiteNum(item.taxable_value);
  const printedLineTotal = finiteNum(item.line_total);
  const printedGst = finiteNum(item.gst_rate);
  const printedTaxMode: InvoicePriceMode | null =
    item.tax_mode === 'inclusive' || item.tax_mode === 'exclusive' ? item.tax_mode : null;

  const qRaw = finiteNum(item.qty);
  if (qRaw == null || qRaw <= 0) pushCode(codes, 'QTY_MISSING');
  const quantity = Math.max(0.0001, roundRetailQty(qRaw != null && qRaw > 0 ? qRaw : 1));

  const taxRate = printedGst != null && printedGst > 0 ? printedGst : 0;
  const t = taxRate / 100;
  const discountRaw = finiteNum(item.discount_amount);
  const discountAmount = discountRaw != null && discountRaw > 0 ? round2(Math.abs(discountRaw)) : 0;

  const unit = item.unit && String(item.unit).trim() ? String(item.unit).trim() : 'PCS';

  const base = (): Omit<
    MappedPurchaseExtractLine,
    | 'quantity'
    | 'unit_price'
    | 'amount'
    | 'discount_percent'
    | 'discount_amount'
    | 'discount_on_tax_inclusive'
    | 'tax_rate'
    | 'tax_mode'
    | 'mapping_rule'
    | 'validation_status'
    | 'discrepancy_codes'
  > => ({
    item_name: item.description,
    hsn_sac: item.hsn_code,
    unit,
    taxable_value: printedTaxable,
    cgst_amount: item.cgst_amount,
    sgst_amount: item.sgst_amount,
    igst_amount: item.igst_amount,
    printed_rate: printedRate,
    printed_taxable: printedTaxable,
    printed_line_total: printedLineTotal,
    printed_gst_rate: printedGst,
    printed_tax_mode: printedTaxMode,
  });

  const finish = (opts: {
    unit_price: number;
    amount: number;
    mapping_rule: LineMappingRule;
    tax_mode: InvoicePriceMode | null;
    discount_on_tax_inclusive?: boolean;
    discount_amount?: number;
    discount_percent?: number;
  }): MappedPurchaseExtractLine => {
    const validation_status = statusFrom(codes);
    return {
      ...base(),
      quantity,
      unit_price: roundExclusiveUnitPrice(opts.unit_price),
      amount: round2(opts.amount),
      discount_percent: opts.discount_percent ?? 0,
      discount_amount: opts.discount_amount ?? 0,
      discount_on_tax_inclusive: opts.discount_on_tax_inclusive === true,
      tax_rate: taxRate,
      tax_mode: opts.tax_mode,
      mapping_rule: opts.mapping_rule,
      validation_status,
      discrepancy_codes: [...codes],
    };
  };

  // --- Exchange / credit rows ---
  if (printedLineTotal != null && printedLineTotal < 0 && taxRate === 0) {
    return finish({
      unit_price: printedLineTotal / quantity,
      amount: printedLineTotal,
      mapping_rule: 'exchange',
      tax_mode: printedTaxMode ?? headerMode,
    });
  }

  const rate = printedRate != null && printedRate > 0 ? printedRate : 0;
  const lineTotal = printedLineTotal ?? 0;
  const grossExcl = rate * quantity;

  // --- Marketplace / MRP: rupee discount off tax-inclusive gross ---
  let discOffInc = item.discount_on_tax_inclusive === true;
  if (
    !discOffInc &&
    discountAmount > 0 &&
    rate > 0 &&
    taxRate > 0 &&
    lineTotal > 0 &&
    quantity > 0
  ) {
    const grossInc = quantity * rate * (1 + t);
    const errOffInclusiveGross = Math.abs(grossInc - discountAmount - lineTotal);
    const netExclAfterDisc = quantity * rate - discountAmount;
    const errOffExclusive = Math.abs(netExclAfterDisc * (1 + t) - lineTotal);
    const tol = Math.max(2, Math.abs(lineTotal) * 0.02);
    if (errOffInclusiveGross <= tol && errOffInclusiveGross < errOffExclusive) {
      discOffInc = true;
    }
  }

  if (discOffInc && discountAmount > 0 && rate > 0 && taxRate > 0) {
    const computedIncl = inclusiveLineTotalWithDiscountAmount(
      quantity,
      rate,
      discountAmount,
      taxRate,
      true,
    );
    if (lineTotal > 0 && !amountsNear(computedIncl, lineTotal, lineTotal)) {
      pushCode(codes, 'LINE_TOTAL_VS_COMPUTED');
    }
    const amount = lineTotal > 0 ? lineTotal : computedIncl;
    return finish({
      unit_price: rate,
      amount,
      mapping_rule: 'marketplace_mrp',
      tax_mode: 'exclusive',
      discount_on_tax_inclusive: true,
      discount_amount: discountAmount,
    });
  }

  // --- Zero GST ---
  if (taxRate <= 0) {
    if (rate <= 0 && (printedTaxable == null || printedTaxable <= 0) && !(lineTotal > 0)) {
      pushCode(codes, 'INCOMPLETE');
    }
    if (rate <= 0) pushCode(codes, 'RATE_MISSING');
    let unit_price = rate;
    let mapping_rule: LineMappingRule = 'zero_gst';
    if (!(unit_price > 0) && printedTaxable != null && printedTaxable > 0) {
      unit_price = printedTaxable / quantity;
      mapping_rule = 'exclusive_from_taxable';
    } else if (!(unit_price > 0) && lineTotal !== 0) {
      unit_price = lineTotal / quantity;
    }
    const computed = unit_price * quantity - discountAmount;
    const amount = lineTotal !== 0 ? lineTotal : computed;
    return finish({
      unit_price,
      amount,
      mapping_rule,
      tax_mode: printedTaxMode ?? 'exclusive',
      discount_amount: discountAmount,
    });
  }

  const qtyTimesRate = grossExcl;
  const taxableFromRate = qtyTimesRate - (discountAmount > 0 && !discOffInc ? discountAmount : 0);

  const exclusiveRateVsTaxable =
    rate > 0 &&
    printedTaxable != null &&
    printedTaxable > 0 &&
    amountsNear(taxableFromRate, printedTaxable, printedTaxable);

  const inclusiveRateVsLine =
    rate > 0 &&
    lineTotal > 0 &&
    taxRate > 0 &&
    amountsNear(qtyTimesRate, lineTotal, lineTotal);

  const taxableMatchesInclusiveBackout =
    printedTaxable != null &&
    printedTaxable > 0 &&
    lineTotal > 0 &&
    taxRate > 0 &&
    amountsNear(printedTaxable, lineTotal / (1 + t), printedTaxable);

  const taxableNotExclusiveIdentity =
    printedTaxable == null ||
    printedTaxable <= 0 ||
    rate <= 0 ||
    !amountsNear(printedTaxable, qtyTimesRate, printedTaxable);

  const declaredInclusive = printedTaxMode === 'inclusive';
  const inferredInclusive =
    !declaredInclusive &&
    !exclusiveRateVsTaxable &&
    inclusiveRateVsLine &&
    taxableMatchesInclusiveBackout &&
    taxableNotExclusiveIdentity;

  // Inclusive only when declared/inferred AND taxable is not the exclusive identity qty×rate.
  const useInclusive = (declaredInclusive || inferredInclusive) && !exclusiveRateVsTaxable;

  // --- Inclusive rate (printed or identities; never if qty×rate ≈ taxable) ---
  if (useInclusive) {
    if (rate <= 0) pushCode(codes, 'RATE_MISSING');
    let unit_price =
      printedTaxable != null && printedTaxable > 0
        ? printedTaxable / quantity
        : rate > 0
          ? rate / (1 + t)
          : 0;
    if (!(unit_price > 0) && lineTotal > 0) {
      unit_price = lineTotal / quantity / (1 + t);
    }
    const computedIncl =
      discountAmount > 0
        ? inclusiveLineTotalWithDiscountAmount(quantity, unit_price, discountAmount, taxRate, false)
        : inclusiveLineTotal(quantity, unit_price, 0, taxRate);
    const lineEqualsTaxable =
      printedTaxable != null &&
      printedTaxable > 0 &&
      lineTotal > 0 &&
      taxRate > 0 &&
      amountsNear(lineTotal, printedTaxable, printedTaxable) &&
      !amountsNear(lineTotal, computedIncl, computedIncl);
    if (lineEqualsTaxable) {
      pushCode(codes, 'LINE_TOTAL_EQUALS_TAXABLE');
    } else if (lineTotal > 0 && !amountsNear(computedIncl, lineTotal, lineTotal)) {
      pushCode(codes, 'LINE_TOTAL_VS_COMPUTED');
    }
    const amount = lineEqualsTaxable
      ? computedIncl
      : lineTotal > 0
        ? lineTotal
        : computedIncl;
    return finish({
      unit_price,
      amount,
      mapping_rule: 'inclusive_rate',
      tax_mode: 'exclusive',
      discount_amount: discountAmount,
    });
  }

  // --- Exclusive (default) ---
  if (rate <= 0) pushCode(codes, 'RATE_MISSING');

  let unit_price = rate;
  let mapping_rule: LineMappingRule = 'exclusive_rate';
  if (!(unit_price > 0) && printedTaxable != null && printedTaxable > 0) {
    unit_price = printedTaxable / quantity;
    mapping_rule = 'exclusive_from_taxable';
  } else if (!(unit_price > 0) && lineTotal > 0) {
    unit_price = lineTotal / (quantity * (1 + t));
    mapping_rule = 'exclusive_from_taxable';
    pushCode(codes, 'INCOMPLETE');
  }

  const computedFromMapped =
    discountAmount > 0
      ? inclusiveLineTotalWithDiscountAmount(quantity, unit_price, discountAmount, taxRate, false)
      : inclusiveLineTotal(quantity, unit_price, 0, taxRate);

  const lineEqualsTaxable =
    printedTaxable != null &&
    printedTaxable > 0 &&
    lineTotal > 0 &&
    taxRate > 0 &&
    amountsNear(lineTotal, printedTaxable, printedTaxable) &&
    !amountsNear(lineTotal, computedFromMapped, computedFromMapped);

  if (lineEqualsTaxable) {
    pushCode(codes, 'LINE_TOTAL_EQUALS_TAXABLE');
  } else if (lineTotal > 0 && rate > 0 && !amountsNear(computedFromMapped, lineTotal, lineTotal)) {
    pushCode(codes, 'LINE_TOTAL_VS_COMPUTED');
  }

  // Do not feed a copied taxable-as-total into the form as inclusive amount.
  const amount = lineEqualsTaxable
    ? computedFromMapped
    : lineTotal > 0
      ? lineTotal
      : computedFromMapped;

  return finish({
    unit_price,
    amount,
    mapping_rule,
    tax_mode: 'exclusive',
    discount_amount: discountAmount,
  });
}

/**
 * Purchase-form fill from a review line. New extracts (mapping_rule / printed_rate) keep the
 * mapper's exclusive unit_price. Legacy extraction_data may still be rewritten by derive, then
 * restored when stored unit_price was GST-backed-out of printed taxable.
 */
export function resolvePurchaseFormLineFromExtractItem(
  item: Record<string, unknown>,
  ctx: {
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountPercentForDerive: number;
    amount: number;
  },
): {
  unitPrice: number;
  taxMode: InvoicePriceMode | undefined;
  invoiceInclusiveLineTotal: number | undefined;
} {
  const qty = ctx.quantity;
  const tr = ctx.taxRate;
  const amt = ctx.amount;
  const itemTaxMode =
    item.tax_mode === 'inclusive' || item.tax_mode === 'exclusive' ? item.tax_mode : undefined;

  if (extractionLineHasProvenance(item)) {
    return {
      unitPrice: ctx.unitPrice,
      taxMode: itemTaxMode,
      invoiceInclusiveLineTotal:
        item.validation_status === 'ok' && amt !== 0 && Number.isFinite(amt) ? round2(amt) : undefined,
    };
  }

  let unitPrice = ctx.unitPrice;
  let derivedPreGstApplied = false;
  if (amt > 0 && qty > 0) {
    const derived = deriveUnitPriceFromInvoiceLine(
      amt,
      qty,
      ctx.discountPercentForDerive,
      tr,
      ctx.unitPrice,
    );
    if (derived > 0) {
      unitPrice = roundExclusiveUnitPrice(derived);
      derivedPreGstApplied = true;
    }
  }

  const taxableRaw = item.taxable_value;
  const taxable =
    typeof taxableRaw === 'number' && Number.isFinite(taxableRaw) ? taxableRaw : null;
  unitPrice = maybeRestoreExclusiveUnitPriceFromLegacyExtract({
    quantity: qty,
    unit_price: unitPrice,
    tax_rate: tr,
    tax_mode: itemTaxMode,
    taxable_value: taxable,
  });

  const taxMode: InvoicePriceMode | undefined =
    derivedPreGstApplied && tr > 0 ? 'exclusive' : itemTaxMode;

  return {
    unitPrice,
    taxMode,
    invoiceInclusiveLineTotal: amt !== 0 && Number.isFinite(amt) ? round2(amt) : undefined,
  };
}
