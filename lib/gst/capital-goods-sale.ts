/**
 * s.18(6) CGST Act with Rule 40(2): on supply of capital goods on which ITC was taken, the
 * registered person pays the higher of
 *   (a) ITC taken reduced by 5 percentage points for every quarter or part thereof from the
 *       date of the invoice, and
 *   (b) tax on the transaction value.
 * (Refractory bricks, moulds and dies, jigs and fixtures sold as scrap: tax on transaction value.)
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

function dayNumber(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;
}

/** Quarters (or part) elapsed from the purchase invoice date to the sale date. */
export function quartersOrPartElapsed(invoiceDate: string, saleDate: string): number {
  const [y1, m1, d1] = invoiceDate.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = saleDate.slice(0, 10).split('-').map(Number);
  if (dayNumber(saleDate) <= dayNumber(invoiceDate)) return 0;
  const months = (y2 - y1) * 12 + (m2 - m1) + (d2 > d1 ? 1 : 0);
  return Math.max(1, Math.ceil(months / 3));
}

export interface CapitalGoodsSaleTax {
  quarters: number;
  itcBased: number;
  transactionBased: number;
  /** Output tax payable on the sale */
  payable: number;
  basis: 'itc_reduced' | 'transaction_value';
}

export function capitalGoodsSaleTax(p: {
  itcTaken: number;
  purchaseInvoiceDate: string;
  saleDate: string;
  transactionValue: number;
  taxRate: number;
}): CapitalGoodsSaleTax {
  const quarters = quartersOrPartElapsed(p.purchaseInvoiceDate, p.saleDate);
  const itcBased = r2(Math.max(0, p.itcTaken * (1 - 0.05 * quarters)));
  const transactionBased = r2(Math.max(0, (p.transactionValue * p.taxRate) / 100));
  return itcBased > transactionBased
    ? { quarters, itcBased, transactionBased, payable: itcBased, basis: 'itc_reduced' }
    : { quarters, itcBased, transactionBased, payable: transactionBased, basis: 'transaction_value' };
}
