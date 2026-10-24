/**
 * Compensation cess on a purchase line, entered as an amount from the supplier's bill.
 * Cess is levied on top of GST (not part of tax_total) but is part of the bill total and ITC.
 */
export function purchaseLineCess(item: { cess_amount?: unknown }): number {
  const v = Number(item.cess_amount);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
}

export function purchaseCessTotal(items: Array<{ cess_amount?: unknown }>): number {
  return Math.round(items.reduce((s, i) => s + purchaseLineCess(i), 0) * 100) / 100;
}
