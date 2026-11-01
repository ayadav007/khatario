import {
  inclusiveLineTotal,
  inclusiveLineTotalWithDiscountAmount,
} from '@/lib/invoice-line-math';
import { round2, roundExclusiveUnitPrice, roundRetailQty } from '@/lib/numeric-precision';
import { computePurchaseDocument, type PurchaseDocumentTotals } from '@/lib/purchase-gst-calculator';
import { amountsNear, resolvePurchaseFormLineFromExtractItem } from '@/lib/purchases/map-extracted-line';

export type PurchaseFormPriceMode = 'exclusive' | 'inclusive' | 'unknown';

export interface PurchaseFormScanLine {
  id: string;
  item_id: string;
  item_name: string;
  hsn_sac: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  discount_on_tax_inclusive: boolean;
  tax_rate: number;
  tax_mode?: 'exclusive' | 'inclusive';
  invoice_inclusive_line_total?: number;
  /** Printed unit rate. Edits do not change this. */
  printed_rate: number | null;
  /** Printed item amount. Edits do not change this. */
  printed_line_total: number | null;
  fromBillExtract: true;
}

export function scanDocumentPriceMode(mode: unknown): PurchaseFormPriceMode {
  return mode === 'inclusive' || mode === 'exclusive' ? mode : 'unknown';
}

export function purchaseFormCanFinalize(
  priceMode: PurchaseFormPriceMode,
): priceMode is 'exclusive' | 'inclusive' {
  return priceMode === 'inclusive' || priceMode === 'exclusive';
}

/**
 * The same line the New Purchase form stores after a scan.
 * A null tax mode stays null. The printed amount is kept beside the working rate.
 */
export function purchaseFormLinesFromScan(
  items: Record<string, unknown>[],
  options?: {
    itemIds?: string[];
    idFor?: (index: number) => string;
  },
): PurchaseFormScanLine[] {
  return items.map((item, index) => {
    let qty = roundRetailQty(Number(item.quantity));
    if (!(qty > 0)) qty = 1;
    const discAmt = round2(Number(item.discount_amount) || 0);
    const discPct = round2(Number(item.discount_percent) || 0);
    const rawUp = roundExclusiveUnitPrice(Number(item.unit_price) || 0);
    const tr = round2(Number(item.tax_rate) || 0);
    const gross = qty * rawUp;
    const discForDerive =
      discAmt > 0 && gross > 0 ? Math.min(100, round2((discAmt / gross) * 100)) : discPct;
    const offInc = item.discount_on_tax_inclusive === true;
    const amt =
      typeof item.amount === 'number' && item.amount !== 0
        ? round2(item.amount)
        : discAmt > 0
          ? round2(inclusiveLineTotalWithDiscountAmount(qty, rawUp, discAmt, tr, offInc))
          : round2(inclusiveLineTotal(qty, rawUp, discPct, tr));
    const resolved = resolvePurchaseFormLineFromExtractItem(item, {
      quantity: qty,
      unitPrice: rawUp,
      taxRate: tr,
      discountPercentForDerive: discForDerive,
      amount: amt,
    });
    return {
      id: options?.idFor?.(index) ?? `scan-${index + 1}`,
      item_id: options?.itemIds?.[index] ?? '',
      item_name: typeof item.item_name === 'string' ? item.item_name : '',
      hsn_sac: typeof item.hsn_sac === 'string' ? item.hsn_sac : '',
      quantity: qty,
      unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit : 'PCS',
      unit_price: roundExclusiveUnitPrice(Number(resolved.unitPrice) || 0),
      discount_percent: discAmt > 0 ? 0 : discPct,
      discount_amount: discAmt,
      discount_on_tax_inclusive: offInc,
      tax_rate: tr,
      tax_mode: resolved.taxMode,
      invoice_inclusive_line_total: resolved.invoiceInclusiveLineTotal,
      printed_rate: resolved.printedRate,
      printed_line_total: resolved.printedLineTotal,
      fromBillExtract: true,
    };
  });
}

const editClearsAnchor = new Set([
  'quantity',
  'unit_price',
  'discount_percent',
  'discount_amount',
  'discount_on_tax_inclusive',
  'tax_rate',
  'tax_mode',
]);

/** Recalculate from the edited field. The printed rate and printed amount stay. */
export function editPurchaseFormLine<T extends PurchaseFormScanLine>(
  item: T,
  field: keyof T,
  value: T[keyof T],
): T {
  const next = { ...item, [field]: value };
  if (editClearsAnchor.has(String(field))) {
    delete next.invoice_inclusive_line_total;
  }
  next.printed_rate = item.printed_rate;
  next.printed_line_total = item.printed_line_total;
  return next;
}

export function purchaseFormLinesAfterRemove<T extends { id: string }>(lines: T[], id: string): T[] {
  return lines.filter((line) => line.id !== id);
}

export function purchaseFormLinesAfterAdd<T>(lines: T[], line: T): T[] {
  return [...lines, line];
}

/**
 * Unknown bills are not run through the exclusive GST calculator.
 * The printed amount stays the line total and tax is left uncalculated.
 */
export function previewPurchaseFormDocument(
  items: Array<{
    quantity: number;
    unit_price: number;
    discount_percent: number;
    discount_amount?: number;
    discount_on_tax_inclusive?: boolean;
    tax_rate: number;
    tax_mode?: 'exclusive' | 'inclusive';
    invoice_inclusive_line_total?: number;
    manual_cgst?: number | null;
    manual_sgst?: number | null;
    manual_igst?: number | null;
  }>,
  priceMode: PurchaseFormPriceMode,
  states: { supplierStateCode: string; companyStateCode: string },
): PurchaseDocumentTotals & { priceBasisUnresolved: boolean } {
  if (!purchaseFormCanFinalize(priceMode)) {
    const lineComputeds = items.map((item) => {
      const gross = item.quantity * item.unit_price;
      const discount = Math.max(0, item.discount_amount || 0);
      const lineTotal = round2(gross - discount);
      return {
        quantity: item.quantity,
        unitPrice: item.unit_price,
        discountPercent: item.discount_percent,
        discountAmount: discount,
        gstRate: item.tax_rate,
        taxMode: 'exclusive' as const,
        taxableValue: lineTotal,
        taxAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        lineTotal,
      };
    });
    const subtotal = round2(lineComputeds.reduce((sum, line) => sum + line.lineTotal, 0));
    return {
      intraState: true,
      lineComputeds,
      slabSummary: [],
      subtotal,
      taxTotal: 0,
      cgstTotal: 0,
      sgstTotal: 0,
      igstTotal: 0,
      grandTotalLines: subtotal,
      priceBasisUnresolved: true,
    };
  }
  const doc = computePurchaseDocument(
    items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_percent: item.discount_percent,
      discount_amount: item.discount_amount,
      discount_on_tax_inclusive: item.discount_on_tax_inclusive,
      tax_rate: item.tax_rate,
      tax_mode: item.tax_mode,
      manual_cgst: item.manual_cgst,
      manual_sgst: item.manual_sgst,
      manual_igst: item.manual_igst,
      invoice_inclusive_line_total: item.invoice_inclusive_line_total,
    })),
    {
      supplierStateCode: states.supplierStateCode,
      companyStateCode: states.companyStateCode,
      headerPriceMode: priceMode,
    },
  );
  return { ...doc, priceBasisUnresolved: false };
}

/** Gap allowed between the form's grand total and the bill's printed total (paise rounding). */
export const BILL_TOTAL_GAP_TOLERANCE = 1;

/**
 * The bill's own payable figure from a scan review. `printed_grand_total` is null when the
 * bill printed none; `grand_total` is then filled from the lines, so it is only trusted on
 * old reviews saved before `printed_grand_total` existed.
 */
export function scanPrintedGrandTotal(totals: unknown): number | null {
  if (!totals || typeof totals !== 'object') return null;
  const t = totals as Record<string, unknown>;
  const value = 'printed_grand_total' in t ? t.printed_grand_total : t.grand_total;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? round2(value) : null;
}

/** Form total minus the bill's printed total, or null when there is no bill total or they agree. */
export function billTotalGap(printedGrandTotal: number | null | undefined, formGrandTotal: number): number | null {
  if (printedGrandTotal == null || !Number.isFinite(printedGrandTotal) || printedGrandTotal <= 0) return null;
  const gap = round2(formGrandTotal - printedGrandTotal);
  return Math.abs(gap) > BILL_TOTAL_GAP_TOLERANCE ? gap : null;
}

/**
 * True when the bill printed an amount for this line and the form's line is neither that
 * amount with GST (inclusive bills) nor before GST (exclusive bills).
 */
export function scanLineDisagreesWithBill(
  printedLineTotal: number | null | undefined,
  computed: { lineTotal: number; taxableValue: number } | null | undefined,
): boolean {
  if (printedLineTotal == null || !Number.isFinite(printedLineTotal) || !computed) return false;
  return (
    !amountsNear(computed.lineTotal, printedLineTotal, printedLineTotal) &&
    !amountsNear(computed.taxableValue, printedLineTotal, printedLineTotal)
  );
}

export function purchaseSaveModes(priceMode: PurchaseFormPriceMode, lineTaxMode: 'exclusive' | 'inclusive' | null | undefined): {
  price_mode: 'exclusive' | 'inclusive' | null;
  tax_mode: 'exclusive' | 'inclusive' | null;
} {
  const header = priceMode === 'inclusive' || priceMode === 'exclusive' ? priceMode : null;
  const line = lineTaxMode === 'inclusive' || lineTaxMode === 'exclusive' ? lineTaxMode : header;
  return { price_mode: header, tax_mode: line };
}
