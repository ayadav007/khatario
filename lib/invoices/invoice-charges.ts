import type { PoolClient } from 'pg';
import { gstRateError } from '@/lib/gst/rates';
import { computeLineGst, round2 } from '@/lib/invoices/line-gst';

export type ChargeClassification = 'follows_goods' | 'separate_supply';

export class InvoiceChargeError extends Error {
  constructor(
    message: string,
    public code:
      | 'CHARGE_UNCLASSIFIED'
      | 'CHARGE_SEPARATE_INCOMPLETE'
      | 'CHARGE_NOT_APPORTIONABLE'
      | 'CHARGE_AMOUNT_MISMATCH'
      | 'INVALID_GST_RATE'
  ) {
    super(message);
    this.name = 'InvoiceChargeError';
  }
}

export interface InvoiceChargeInput {
  purpose?: string | null;
  amount?: unknown;
  classification?: unknown;
  hsn_sac?: string | null;
  tax_rate?: unknown;
}

export interface AuthoritativeLine {
  itemDiscount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxAmount: number;
  lineTotal: number;
  taxRate: number;
}

export interface SeparateSupplyLine extends AuthoritativeLine {
  purpose: string;
  hsnSac: string;
}

export interface StoredCharge {
  purpose: string;
  amount: number;
  classification: ChargeClassification;
  hsnSac: string | null;
  taxRate: number | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface AuthoritativeInvoiceTotals {
  itemSubtotal: number;
  goodsTaxable: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  additionalCharges: number;
  chargesIncluded: boolean;
  roundOff: number;
  grandTotal: number;
  lines: AuthoritativeLine[];
  separateLines: SeparateSupplyLine[];
  charges: StoredCharge[];
}

type PricedItem = {
  quantity?: unknown;
  unit_price?: unknown;
  discount_percent?: unknown;
  tax_rate?: unknown;
};

function asClassification(value: unknown): ChargeClassification | null {
  if (value === 'follows_goods' || value === 'separate_supply') return value;
  return null;
}

/**
 * Heading 9987 is maintenance, repair and installation (except construction).
 * Notification 11/2017-Central Tax (Rate), residual entry, as amended by
 * Notification 15/2025-Central Tax (Rate): ordinary installation is 18%.
 * The 5% entries are only notified concessions (housekeeping through an
 * unregistered e-commerce supplier, and aircraft or ship maintenance).
 * A charge does not evidence those concessions, so 5% is rejected.
 * Other headings are slab-checked only. This does not invent a rate for them.
 */
function unsupportedServiceRate(hsnSac: string, taxRate: unknown): string | null {
  const code = hsnSac.replace(/\s/g, '');
  const rate = Number(taxRate);
  if (code.startsWith('9987') && Number.isFinite(rate) && Math.abs(rate - 5) < 0.001) {
    return 'Heading 9987 is 18% for an ordinary installation. 5% applies only to the notified concessions (housekeeping through an unregistered e-commerce supplier, and aircraft or ship maintenance), which this charge does not evidence.';
  }
  return null;
}

/** One header charge from a sales order or estimate. A bare amount is rejected. */
export function chargeFromSourceHeader(row: {
  additional_charges?: unknown;
  additional_charges_label?: unknown;
  charge_classification?: unknown;
  charge_hsn_sac?: unknown;
  charge_tax_rate?: unknown;
}): InvoiceChargeInput[] {
  const amount = round2(Number(row.additional_charges) || 0);
  if (amount <= 0.004) return [];
  const classification = asClassification(row.charge_classification);
  if (!classification) {
    throw new InvoiceChargeError(
      'This additional charge has no GST classification. Mark it as part of the goods, or as its own supply with an HSN/SAC and a rate.',
      'CHARGE_UNCLASSIFIED'
    );
  }
  return [
    {
      purpose: String(row.additional_charges_label || 'Additional charge'),
      amount,
      classification,
      hsn_sac: row.charge_hsn_sac == null ? null : String(row.charge_hsn_sac),
      tax_rate: row.charge_tax_rate,
    },
  ];
}

export function storedChargeFields(body: {
  charge_classification?: unknown;
  charge_hsn_sac?: unknown;
  charge_tax_rate?: unknown;
}): { classification: ChargeClassification | null; hsnSac: string | null; taxRate: number | null } {
  const classification = asClassification(body.charge_classification);
  const rate = Number(body.charge_tax_rate);
  return {
    classification,
    hsnSac: body.charge_hsn_sac == null || String(body.charge_hsn_sac).trim() === '' ? null : String(body.charge_hsn_sac).trim(),
    taxRate: Number.isFinite(rate) ? rate : null,
  };
}

function apportion(total: number, weights: number[]): number[] {
  const parts = weights.map(() => 0);
  const weightTotal = round2(weights.reduce((sum, weight) => sum + weight, 0));
  if (total <= 0 || weightTotal <= 0) return parts;
  let used = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
  }
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0 || i === last) continue;
    const share = round2((total * weights[i]) / weightTotal);
    parts[i] = share;
    used = round2(used + share);
  }
  if (last >= 0) parts[last] = round2(total - used);
  return parts;
}

/**
 * One sales-invoice total. A positive charge with no classification is rejected.
 * A charge that follows the goods is split across those lines by taxable value.
 * A separate supply keeps the HSN/SAC and rate on that charge.
 */
export function authoritativeInvoiceTotals(input: {
  items: PricedItem[];
  charges?: InvoiceChargeInput[] | null;
  additionalCharges?: unknown;
  intraState: boolean;
  zeroRated: boolean;
  collectTax?: boolean;
  pricesIncludeGst?: boolean;
  documentDate?: string | null;
  roundOff?: unknown;
  enableRoundOff?: boolean;
}): AuthoritativeInvoiceTotals {
  const collectTax = input.collectTax !== false;
  const zeroRated = input.zeroRated || !collectTax;
  const pricesIncludeGst = input.pricesIncludeGst === true;

  const lines: AuthoritativeLine[] = input.items.map((item) => {
    const taxRate = collectTax && !input.zeroRated ? Number(item.tax_rate) || 0 : 0;
    const line = computeLineGst(
      {
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: taxRate,
      },
      input.intraState,
      zeroRated,
      pricesIncludeGst
    );
    return { ...line, taxRate };
  });

  const itemSubtotal = round2(
    input.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0)
  );
  const rawCharges = Array.isArray(input.charges) ? input.charges : [];
  const positive = rawCharges
    .map((charge) => ({
      purpose: String(charge.purpose || '').trim(),
      amount: round2(Number(charge.amount) || 0),
      classification: asClassification(charge.classification),
      hsnSac: String(charge.hsn_sac || '').trim(),
      taxRate: charge.tax_rate,
    }))
    .filter((charge) => charge.amount > 0);
  const bareProvided =
    input.additionalCharges !== undefined &&
    input.additionalCharges !== null &&
    input.additionalCharges !== '';
  const bare = round2(Number(input.additionalCharges) || 0);

  if (positive.length === 0) {
    if (bare > 0.004) {
      throw new InvoiceChargeError(
        'This additional charge has no GST classification. Mark it as part of the goods, or as its own supply with an HSN/SAC and a rate.',
        'CHARGE_UNCLASSIFIED'
      );
    }
  } else if (bareProvided && Math.abs(bare - round2(positive.reduce((sum, charge) => sum + charge.amount, 0))) > 0.05) {
    throw new InvoiceChargeError(
      'The additional-charge total does not match the classified charges.',
      'CHARGE_AMOUNT_MISMATCH'
    );
  }

  const follows: typeof positive = [];
  const separate: typeof positive = [];
  for (const charge of positive) {
    if (!charge.classification) {
      throw new InvoiceChargeError(
        'This additional charge has no GST classification. Mark it as part of the goods, or as its own supply with an HSN/SAC and a rate.',
        'CHARGE_UNCLASSIFIED'
      );
    }
    if (charge.classification === 'separate_supply') {
      if (!charge.hsnSac || charge.taxRate === undefined || charge.taxRate === null || charge.taxRate === '') {
        throw new InvoiceChargeError(
          'A separate supply needs its own HSN/SAC and GST rate.',
          'CHARGE_SEPARATE_INCOMPLETE'
        );
      }
      const concession = unsupportedServiceRate(charge.hsnSac, charge.taxRate);
      if (concession) throw new InvoiceChargeError(concession, 'INVALID_GST_RATE');
      const rateError = gstRateError(charge.taxRate, input.documentDate);
      if (rateError) throw new InvoiceChargeError(rateError, 'INVALID_GST_RATE');
      separate.push(charge);
    } else {
      follows.push(charge);
    }
  }

  const followsTotal = round2(follows.reduce((sum, charge) => sum + charge.amount, 0));
  const weights = lines.map((line) => line.taxable);
  if (followsTotal > 0 && weights.every((weight) => weight <= 0)) {
    throw new InvoiceChargeError(
      'Freight that follows the goods needs at least one taxable goods line to attach to.',
      'CHARGE_NOT_APPORTIONABLE'
    );
  }

  const stored: StoredCharge[] = [];
  for (const charge of follows) {
    const shares = apportion(charge.amount, weights);
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    shares.forEach((share, index) => {
      if (share <= 0) return;
      const tax = computeLineGst(
        { quantity: 1, unit_price: share, tax_rate: lines[index].taxRate },
        input.intraState,
        zeroRated,
        false
      );
      lines[index] = {
        ...lines[index],
        taxable: round2(lines[index].taxable + share),
        cgst: round2(lines[index].cgst + tax.cgst),
        sgst: round2(lines[index].sgst + tax.sgst),
        igst: round2(lines[index].igst + tax.igst),
        taxAmount: round2(lines[index].taxAmount + tax.taxAmount),
        lineTotal: round2(lines[index].lineTotal + share + tax.taxAmount),
      };
      cgst = round2(cgst + tax.cgst);
      sgst = round2(sgst + tax.sgst);
      igst = round2(igst + tax.igst);
    });
    stored.push({
      purpose: charge.purpose || 'Additional charge',
      amount: charge.amount,
      classification: 'follows_goods',
      hsnSac: null,
      taxRate: null,
      taxable: charge.amount,
      cgst,
      sgst,
      igst,
    });
  }

  const separateLines: SeparateSupplyLine[] = separate.map((charge) => {
    const rate = zeroRated ? 0 : Number(charge.taxRate) || 0;
    const line = computeLineGst(
      { quantity: 1, unit_price: charge.amount, tax_rate: rate },
      input.intraState,
      zeroRated,
      false
    );
    stored.push({
      purpose: charge.purpose || 'Additional charge',
      amount: charge.amount,
      classification: 'separate_supply',
      hsnSac: charge.hsnSac,
      taxRate: rate,
      taxable: line.taxable,
      cgst: line.cgst,
      sgst: line.sgst,
      igst: line.igst,
    });
    return {
      ...line,
      taxRate: rate,
      purpose: charge.purpose || 'Additional charge',
      hsnSac: charge.hsnSac,
    };
  });

  const goodsTaxable = round2(
    input.items.reduce((sum, item, index) => {
      const base = computeLineGst(
        {
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percent: item.discount_percent,
          tax_rate: lines[index].taxRate,
        },
        input.intraState,
        zeroRated,
        pricesIncludeGst
      );
      return sum + base.taxable;
    }, 0)
  );
  const discountTotal = round2(lines.reduce((sum, line) => sum + line.itemDiscount, 0));
  const allLines = [...lines, ...separateLines];
  const subtotal = round2(allLines.reduce((sum, line) => sum + line.taxable, 0));
  const cgstTotal = round2(allLines.reduce((sum, line) => sum + line.cgst, 0));
  const sgstTotal = round2(allLines.reduce((sum, line) => sum + line.sgst, 0));
  const igstTotal = round2(allLines.reduce((sum, line) => sum + line.igst, 0));
  const taxTotal = round2(cgstTotal + sgstTotal + igstTotal);
  const additionalCharges = round2(stored.reduce((sum, charge) => sum + charge.amount, 0));
  const grandTotalRaw = round2(subtotal + taxTotal);
  let roundOff = round2(Number(input.roundOff) || 0);
  if (input.enableRoundOff && !input.roundOff) {
    roundOff = round2(Math.round(grandTotalRaw) - grandTotalRaw);
  }

  return {
    itemSubtotal,
    goodsTaxable,
    subtotal,
    discountTotal,
    taxTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    additionalCharges,
    chargesIncluded: additionalCharges > 0,
    roundOff,
    grandTotal: round2(grandTotalRaw + roundOff),
    lines,
    separateLines,
    charges: stored,
  };
}

export async function persistInvoiceCharges(
  client: PoolClient,
  args: {
    invoiceId: string;
    businessId: string;
    totals: AuthoritativeInvoiceTotals;
    goodsLineCount: number;
  }
): Promise<void> {
  await client.query(`DELETE FROM invoice_charges WHERE invoice_id = $1`, [args.invoiceId]);
  await client.query(
    `UPDATE invoices SET charges_included = $2 WHERE id = $1 AND business_id = $3`,
    [args.invoiceId, args.totals.chargesIncluded, args.businessId]
  );
  for (let i = 0; i < args.totals.charges.length; i++) {
    const charge = args.totals.charges[i];
    await client.query(
      `INSERT INTO invoice_charges (
         invoice_id, business_id, purpose, amount, classification, hsn_sac, tax_rate,
         taxable_value, cgst_amount, sgst_amount, igst_amount, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        args.invoiceId,
        args.businessId,
        charge.purpose,
        charge.amount,
        charge.classification,
        charge.hsnSac,
        charge.taxRate,
        charge.taxable,
        charge.cgst,
        charge.sgst,
        charge.igst,
        i,
      ]
    );
  }
  for (let i = 0; i < args.totals.separateLines.length; i++) {
    const line = args.totals.separateLines[i];
    await client.query(
      `INSERT INTO invoice_items (
         invoice_id, item_name, hsn_sac, quantity, unit, unit_price, discount_percent, discount_amount,
         tax_rate, tax_amount, taxable_value, cgst_amount, sgst_amount, igst_amount, line_total, sort_order,
         charge_line
       ) VALUES ($1,$2,$3,1,'NOS',$4,0,0,$5,$6,$7,$8,$9,$10,$11,$12,true)`,
      [
        args.invoiceId,
        line.purpose,
        line.hsnSac,
        line.taxable,
        line.taxRate,
        line.taxAmount,
        line.taxable,
        line.cgst,
        line.sgst,
        line.igst,
        line.lineTotal,
        args.goodsLineCount + i,
      ]
    );
  }
}
