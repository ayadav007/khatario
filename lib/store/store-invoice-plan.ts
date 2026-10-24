import { authoritativeInvoiceTotals, type InvoiceChargeInput } from '@/lib/invoices/invoice-charges';
import { round2 } from '@/lib/invoices/line-gst';

/**
 * How a store order becomes a normal tax invoice, shared by the checkout quote and the invoice
 * so the price the shopper paid and the GST on the bill agree to the paisa.
 *
 * - A coupon is a discount at the time of sale, so it lowers the taxable value: one percentage
 *   off every line (Section 15(3)(a) CGST Act).
 * - The delivery fee is part of the goods supply and the shopper paid it GST-inclusive, so its
 *   pre-tax amount is a charge that follows the goods, at their (weighted) rate.
 * - A cart mixing GST-inclusive and GST-exclusive prices is billed exclusive: inclusive unit
 *   prices are converted to their pre-tax value.
 * - Whatever paise that conversion leaves over is round-off, never more than ₹1.
 */
export type StorePlanLine = {
  unit_price: number;
  quantity: number;
  tax_rate: number;
  gst_included: boolean;
};

export type StoreInvoicePlan = {
  pricesIncludeGst: boolean;
  discountPercent: number;
  /** Per input line, in the invoice's price basis. */
  unitPrices: number[];
  charges: InvoiceChargeInput[];
  roundOff: number;
  taxTotal: number;
  grandTotal: number;
};

export class StoreInvoicePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreInvoicePlanError';
  }
}

/** The price a shopper pays for one line, before any coupon. */
export function storeLineCustomerTotal(line: StorePlanLine): number {
  const gross = round2(line.unit_price * line.quantity);
  if (line.gst_included) return gross;
  return round2(gross + round2((gross * Math.max(0, line.tax_rate)) / 100));
}

export function buildStoreInvoicePlan(input: {
  lines: StorePlanLine[];
  discount: number;
  delivery: number;
  /** What the shopper pays: goods − discount + delivery. */
  grandTotal: number;
}): StoreInvoicePlan {
  const { lines } = input;
  const allInclusive = lines.length > 0 && lines.every((l) => l.gst_included);
  const pricesIncludeGst = allInclusive;
  const unitPrices = lines.map((l) =>
    l.gst_included && !pricesIncludeGst ? round2((l.unit_price * 100) / (100 + Math.max(0, l.tax_rate))) : l.unit_price,
  );
  const goods = round2(lines.reduce((s, l) => s + storeLineCustomerTotal(l), 0));
  const discount = Math.min(Math.max(0, input.discount), goods);
  const discountPercent = goods > 0 ? (discount / goods) * 100 : 0;

  const items = lines.map((l, i) => ({
    quantity: l.quantity,
    unit_price: unitPrices[i],
    discount_percent: discountPercent,
    tax_rate: l.tax_rate,
  }));

  const charges: InvoiceChargeInput[] = [];
  const delivery = Math.max(0, input.delivery);
  if (delivery > 0.004) {
    const base = authoritativeInvoiceTotals({ items, intraState: true, zeroRated: false, pricesIncludeGst });
    const weight = base.lines.reduce((s, l) => s + l.taxable, 0);
    if (weight <= 0) {
      throw new StoreInvoicePlanError('A delivery fee needs at least one goods line with a value to attach to');
    }
    const rate = base.lines.reduce((s, l) => s + l.taxable * l.taxRate, 0) / weight;
    charges.push({
      purpose: 'Delivery',
      amount: round2((delivery * 100) / (100 + rate)),
      classification: 'follows_goods',
    });
  }

  const raw = authoritativeInvoiceTotals({ items, charges, intraState: true, zeroRated: false, pricesIncludeGst });
  const roundOff = round2(input.grandTotal - raw.grandTotal);
  if (Math.abs(roundOff) > 1) {
    throw new StoreInvoicePlanError(
      `Store order total ₹${input.grandTotal} cannot be billed (invoice works out to ₹${raw.grandTotal})`,
    );
  }
  return {
    pricesIncludeGst,
    discountPercent,
    unitPrices,
    charges,
    roundOff,
    taxTotal: raw.taxTotal,
    grandTotal: round2(raw.grandTotal + roundOff),
  };
}
