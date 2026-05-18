import { roundExclusiveUnitPrice as roundExclusiveUnitPx } from '@/lib/numeric-precision';

/**
 * Indian GST purchase line calculations.
 * Internal math uses full float; round to cents only when producing stored/display amounts.
 */

export type PurchaseTaxMode = 'exclusive' | 'inclusive';

export interface PurchaseLineInput {
  quantity: number;
  /** Rate per unit as entered (exclusive pre-tax, or inclusive gross per unit depending on taxMode). */
  unitPrice: number;
  discountPercent: number;
  /** If > 0, takes precedence over discountPercent for the line discount. */
  discountAmount: number;
  /**
   * When taxMode is exclusive: if true, discountAmount is subtracted from the tax-inclusive
   * line value (qty × unitPrice × (1+GST%)) before backing out GST — matches many B2C tax
   * invoices (MRP column is incl. GST, discount column applies to that).
   */
  discountOnTaxInclusive?: boolean;
  gstRate: number;
  taxMode: PurchaseTaxMode;
  /** When set, these amounts are used instead of auto-split (advanced override). */
  manualCgst?: number;
  manualSgst?: number;
  manualIgst?: number;
  /**
   * Tax-inclusive line total from the invoice (OCR / review). When set, taxable + tax are
   * derived from this amount and `gstRate` instead of qty×unit_price (so GST slabs match
   * printed line totals when unit price × qty drifts).
   */
  anchorInclusiveLineTotal?: number;
}

export interface PurchaseLineComputed {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  gstRate: number;
  taxMode: PurchaseTaxMode;
  taxableValue: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTotal: number;
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp0(n: number): number {
  return n < 0 ? 0 : n;
}

/**
 * True = intra-state (CGST+SGST), false = inter-state (IGST).
 * Caller supplies result of supplier_state vs company_state rule (or POS-based fallback).
 */
export function calculatePurchaseLine(
  input: PurchaseLineInput,
  intraState: boolean
): PurchaseLineComputed {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const rate = Number(input.unitPrice) || 0;
  const gstRate = Math.max(0, Number(input.gstRate) || 0);
  const taxMode: PurchaseTaxMode = input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive';

  const gross = qty * rate;
  let discountAmt = Math.max(0, Number(input.discountAmount) || 0);
  if (discountAmt <= 0 && input.discountPercent > 0) {
    discountAmt = roundMoney2((gross * Math.max(0, Number(input.discountPercent) || 0)) / 100);
  }
  discountAmt = clamp0(discountAmt);
  const discPct =
    gross > 0 ? roundMoney2((discountAmt / gross) * 10000) / 100 : Math.max(0, Number(input.discountPercent) || 0);

  const hasManual =
    (input.manualCgst != null && Number.isFinite(input.manualCgst)) ||
    (input.manualSgst != null && Number.isFinite(input.manualSgst)) ||
    (input.manualIgst != null && Number.isFinite(input.manualIgst));

  let taxable = 0;
  let taxTotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let lineTotal = 0;

  const anchorRaw = input.anchorInclusiveLineTotal;
  const anchor =
    anchorRaw != null && Number.isFinite(anchorRaw) && Math.abs(anchorRaw) > 1e-9
      ? roundMoney2(anchorRaw)
      : null;

  if (hasManual) {
    cgst = roundMoney2(Number(input.manualCgst) || 0);
    sgst = roundMoney2(Number(input.manualSgst) || 0);
    igst = roundMoney2(Number(input.manualIgst) || 0);
    taxTotal = roundMoney2(cgst + sgst + igst);
    const netGross = gross - discountAmt;
    if (gstRate === 0 && netGross < 0) {
      taxable = roundMoney2(netGross);
    } else {
      taxable = roundMoney2(clamp0(netGross));
    }
    lineTotal = roundMoney2(taxable + taxTotal);
  } else if (anchor != null) {
    /** Invoice-anchored line: back out GST from printed inclusive total (discount already in amount). */
    if (gstRate <= 0) {
      taxable = anchor;
      taxTotal = 0;
      cgst = 0;
      sgst = 0;
      igst = 0;
      lineTotal = anchor;
    } else {
      taxable = roundMoney2((anchor * 100) / (100 + gstRate));
      taxTotal = roundMoney2(anchor - taxable);
      if (intraState) {
        cgst = roundMoney2(taxTotal / 2);
        sgst = roundMoney2(taxTotal - cgst);
        igst = 0;
      } else {
        igst = taxTotal;
        cgst = 0;
        sgst = 0;
      }
      lineTotal = anchor;
    }
  } else if (taxMode === 'exclusive') {
    if (
      input.discountOnTaxInclusive &&
      discountAmt > 0 &&
      gstRate > 0 &&
      !hasManual
    ) {
      const inclusiveList = roundMoney2(gross * (1 + gstRate / 100));
      const inclusiveAfterDisc = roundMoney2(inclusiveList - discountAmt);
      const div = 100 + gstRate;
      taxable = div > 0 ? roundMoney2((inclusiveAfterDisc * 100) / div) : inclusiveAfterDisc;
      taxTotal = roundMoney2(inclusiveAfterDisc - taxable);
      if (intraState && gstRate > 0) {
        cgst = roundMoney2(taxTotal / 2);
        sgst = roundMoney2(taxTotal - cgst);
        igst = 0;
      } else {
        igst = taxTotal;
        cgst = 0;
        sgst = 0;
      }
      lineTotal = roundMoney2(taxable + taxTotal);
    } else {
      const netGross = gross - discountAmt;
      if (gstRate === 0 && netGross < 0) {
        taxable = roundMoney2(netGross);
        taxTotal = 0;
        cgst = 0;
        sgst = 0;
        igst = 0;
        lineTotal = taxable;
      } else {
        taxable = roundMoney2(clamp0(netGross));
        taxTotal = roundMoney2((taxable * gstRate) / 100);
        if (intraState && gstRate > 0) {
          cgst = roundMoney2(taxTotal / 2);
          sgst = roundMoney2(taxTotal - cgst);
          igst = 0;
        } else {
          igst = taxTotal;
          cgst = 0;
          sgst = 0;
        }
        lineTotal = roundMoney2(taxable + taxTotal);
      }
    }
  } else {
    const rawNet = gross - discountAmt;
    const enteredTotal =
      gstRate === 0 && rawNet < 0
        ? roundMoney2(rawNet)
        : roundMoney2(clamp0(rawNet));
    const div = 100 + gstRate;
    taxable = div > 0 ? roundMoney2((enteredTotal * 100) / div) : enteredTotal;
    taxTotal = roundMoney2(enteredTotal - taxable);
    if (intraState && gstRate > 0) {
      cgst = roundMoney2(taxTotal / 2);
      sgst = roundMoney2(taxTotal - cgst);
      igst = 0;
    } else {
      igst = taxTotal;
      cgst = 0;
      sgst = 0;
    }
    lineTotal = enteredTotal;
  }

  return {
    quantity: qty,
    unitPrice: rate,
    discountPercent: discPct,
    discountAmount: discountAmt,
    gstRate,
    taxMode,
    taxableValue: taxable,
    taxAmount: taxTotal,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    lineTotal,
  };
}

/**
 * Invert the **exclusive** `taxMode` forward math so `unit_price` matches a printed
 * tax-inclusive line total (`anchor`) for the same qty / discount / GST%.
 *
 * Used when the user edits **Line total** to match the bill; keeps `invoice_inclusive_line_total`
 * as source of truth and backs out pre-tax unit rate.
 */
export function deriveExclusiveUnitPriceFromInvoiceAnchor(params: {
  anchorInclusiveLineTotal: number;
  quantity: number;
  discountAmount: number;
  discountPercent: number;
  discountOnTaxInclusive: boolean;
  gstRate: number;
}): number {
  const qty = Math.max(0, Number(params.quantity) || 0);
  if (qty <= 0) return 0;
  const anchor = roundMoney2(Number(params.anchorInclusiveLineTotal) || 0);
  if (!Number.isFinite(anchor) || Math.abs(anchor) < 1e-9) return 0;

  const gst = Math.max(0, Number(params.gstRate) || 0);
  const t = gst / 100;
  const discPct = Math.max(0, Number(params.discountPercent) || 0);
  let discAmt = Math.max(0, Number(params.discountAmount) || 0);
  if (discAmt <= 0 && discPct > 0) {
    const f = (1 - discPct / 100) * (1 + t);
    if (f <= 1e-9) return 0;
    return roundExclusiveUnitPx(anchor / (qty * f));
  }

  if (params.discountOnTaxInclusive && discAmt > 0 && gst > 0) {
    const denom = qty * (1 + t);
    if (denom <= 1e-9) return 0;
    return roundExclusiveUnitPx((anchor + discAmt) / denom);
  }

  if (discAmt > 0 && gst > 0) {
    const div = 1 + t;
    if (div <= 1e-9) return 0;
    const netTaxable = roundMoney2(anchor / div);
    return roundExclusiveUnitPx((netTaxable + discAmt) / qty);
  }

  if (gst > 0) {
    const denom = qty * (1 + t);
    if (denom <= 1e-9) return 0;
    return roundExclusiveUnitPx(anchor / denom);
  }

  /** gst 0 */
  if (discAmt > 0) {
    return roundExclusiveUnitPx((anchor + discAmt) / qty);
  }
  const f = 1 - discPct / 100;
  if (f <= 1e-9) return 0;
  return roundExclusiveUnitPx(anchor / (qty * f));
}

export interface GstSlabSummaryRow {
  gst_rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_tax: number;
}

export function buildGstSlabSummary(
  lines: PurchaseLineComputed[],
  opts?: { rebalanceIntraStateHalves?: boolean }
): GstSlabSummaryRow[] {
  const map = new Map<number, GstSlabSummaryRow>();
  for (const ln of lines) {
    const key = roundMoney2(ln.gstRate);
    const cur =
      map.get(key) ||
      {
        gst_rate: key,
        taxable_value: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total_tax: 0,
      };
    cur.taxable_value = roundMoney2(cur.taxable_value + ln.taxableValue);
    cur.cgst = roundMoney2(cur.cgst + ln.cgstAmount);
    cur.sgst = roundMoney2(cur.sgst + ln.sgstAmount);
    cur.igst = roundMoney2(cur.igst + ln.igstAmount);
    cur.total_tax = roundMoney2(cur.cgst + cur.sgst + cur.igst);
    map.set(key, cur);
  }
  const rows = Array.from(map.values()).sort((a, b) => a.gst_rate - b.gst_rate);
  /** One 50/50 split per slab avoids CGST≠SGST from per-line half rounding (thermal bills). */
  if (opts?.rebalanceIntraStateHalves !== false) {
    for (const row of rows) {
      if (row.gst_rate > 0 && row.igst < 0.005 && row.total_tax > 0.005) {
        row.cgst = roundMoney2(row.total_tax / 2);
        row.sgst = roundMoney2(row.total_tax - row.cgst);
        row.total_tax = roundMoney2(row.cgst + row.sgst + row.igst);
      }
    }
  }
  return rows;
}

export function stateCodeFromGstin(gstin: string | null | undefined): string {
  if (!gstin || gstin.length < 2) return '';
  const d = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(d) ? d : '';
}

function padState(code: string): string {
  const s = (code || '').replace(/\s/g, '').slice(0, 2);
  if (!s) return '';
  return s.length === 1 ? `0${s}` : s;
}

export interface PurchaseLineInputRow {
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount?: number;
  /**
   * When true with exclusive tax mode: line discount rupees apply to tax-inclusive value
   * (MRP-style bills) before GST is backed out.
   */
  discount_on_tax_inclusive?: boolean;
  tax_rate: number;
  tax_mode?: PurchaseTaxMode | string | null;
  manual_cgst?: number | null;
  manual_sgst?: number | null;
  manual_igst?: number | null;
  /** Tax-inclusive total from invoice fill — drives slab math when present. */
  invoice_inclusive_line_total?: number | null;
}

export interface PurchaseDocumentTotals {
  intraState: boolean;
  lineComputeds: PurchaseLineComputed[];
  slabSummary: GstSlabSummaryRow[];
  subtotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  grandTotalLines: number;
}

/** Supplier state vs company state determines CGST+SGST vs IGST (per Indian B2B convention requested). */
export function computePurchaseDocument(
  items: PurchaseLineInputRow[],
  options: {
    supplierStateCode: string;
    companyStateCode: string;
    headerPriceMode: PurchaseTaxMode;
  }
): PurchaseDocumentTotals {
  const sup = padState(options.supplierStateCode);
  const comp = padState(options.companyStateCode);
  const intraState = sup.length === 2 && comp.length === 2 && sup === comp;
  const headerMode: PurchaseTaxMode =
    options.headerPriceMode === 'inclusive' ? 'inclusive' : 'exclusive';

  const lineComputeds = items.map((row) => {
    const tm =
      row.tax_mode === 'inclusive' || row.tax_mode === 'exclusive'
        ? row.tax_mode
        : headerMode;
    return calculatePurchaseLine(
      {
        quantity: row.quantity,
        unitPrice: row.unit_price,
        discountPercent: row.discount_percent,
        discountAmount: row.discount_amount ?? 0,
        discountOnTaxInclusive: row.discount_on_tax_inclusive === true,
        gstRate: row.tax_rate,
        taxMode: tm,
        manualCgst: row.manual_cgst ?? undefined,
        manualSgst: row.manual_sgst ?? undefined,
        manualIgst: row.manual_igst ?? undefined,
        anchorInclusiveLineTotal:
          row.invoice_inclusive_line_total != null &&
          Number.isFinite(row.invoice_inclusive_line_total) &&
          Math.abs(Number(row.invoice_inclusive_line_total)) > 1e-9
            ? Number(row.invoice_inclusive_line_total)
            : undefined,
      },
      intraState
    );
  });

  const subtotal = roundMoney2(
    lineComputeds.reduce((s, l) => s + l.taxableValue, 0)
  );
  const cgstTotal = roundMoney2(lineComputeds.reduce((s, l) => s + l.cgstAmount, 0));
  const sgstTotal = roundMoney2(lineComputeds.reduce((s, l) => s + l.sgstAmount, 0));
  const igstTotal = roundMoney2(lineComputeds.reduce((s, l) => s + l.igstAmount, 0));
  const taxTotal = roundMoney2(cgstTotal + sgstTotal + igstTotal);
  const grandTotalLines = roundMoney2(
    lineComputeds.reduce((s, l) => s + l.lineTotal, 0)
  );

  return {
    intraState,
    lineComputeds,
    slabSummary: buildGstSlabSummary(lineComputeds, { rebalanceIntraStateHalves: true }),
    subtotal,
    taxTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    grandTotalLines,
  };
}
