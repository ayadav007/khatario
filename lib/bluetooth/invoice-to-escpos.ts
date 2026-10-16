/**
 * INVOICE / RECEIPT -> ESC/POS
 *
 * Formats a finalized invoice (or a draft POS order) as a printable receipt
 * for a 58mm / 80mm thermal Bluetooth printer.
 *
 * The input shape is intentionally narrower than the database `Invoice`
 * model so this file has no server dependencies and can be unit-tested in
 * isolation. The caller is responsible for extracting the fields it wants
 * shown.
 *
 * Layout
 * ------
 *    ===============================
 *            BUSINESS NAME
 *          Address line (optional)
 *         Phone | GSTIN (optional)
 *    -------------------------------
 *        INVOICE #INV-00123
 *        Date: 18/04/2026 14:32
 *    -------------------------------
 *    Bill To:
 *      Customer Name
 *      Phone / GSTIN
 *    -------------------------------
 *    Item                Qty    Amt
 *    Parle-G 80g          2   40.00
 *    Maggi 70g            1   14.00
 *    -------------------------------
 *                Subtotal   54.00
 *                 Tax 5%     2.70
 *                    TOTAL  56.70
 *    -------------------------------
 *    Paid: Cash      Balance: 0
 *    -------------------------------
 *       Thank you for your business!
 *       [QR code: upi://...]  (optional)
 *    ===============================
 */

import type { TextRasterizer } from '@/lib/print/bitmap';
import type { DocumentLanguage } from '@/lib/print-language/codes';
import { amountInWords } from '@/lib/print-language/amount';
import { EscPosBuilder } from './escpos';

export interface ReceiptBusiness {
  name: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssai?: string | null;
}

export interface ReceiptCustomer {
  name?: string | null;
  phone?: string | null;
  gstin?: string | null;
}

export interface ReceiptLineItem {
  name: string;
  hsn?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  amount: number;
  /** GST rate in percent; with taxableValue this feeds the HSN-wise tax summary. */
  taxRate?: number | null;
  /** Value before tax, after discount. */
  taxableValue?: number | null;
  taxAmount?: number | null;
}

export interface ReceiptData {
  business: ReceiptBusiness;
  customer?: ReceiptCustomer | null;
  invoiceNumber: string;
  invoiceDate: Date;
  items: ReceiptLineItem[];
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  roundOff?: number;
  grandTotal: number;
  paidAmount?: number;
  balance?: number;
  cashTendered?: number;
  changeGiven?: number;
  paymentMode?: string;
  notes?: string | null;
  /** Optional UPI / URL / invoice link encoded as QR at the footer. */
  footerQr?: string | null;
  /** Free-text footer (thank-you message, return policy, etc.). */
  footerText?: string | null;
  /** 'bill_of_supply' for composition dealers / exempt sales; anything else prints as a tax invoice. */
  documentType?: string | null;
  /** Two-digit GST state code of the place of supply. */
  placeOfSupplyStateCode?: string | null;
  placeOfSupplyName?: string | null;
  isReverseCharge?: boolean;
  /** e-Invoice details, printed when the bill has an IRN. */
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
  signedQr?: string | null;
}

export interface BuildReceiptOptions {
  paperWidthMm?: 58 | 80;
  /** When true, do not emit a paper-cut command at the end. */
  skipCut?: boolean;
  /** Free/trial businesses — append “Powered by Khatario” before cut. */
  showKhatarioFooter?: boolean;
  /** Draws Hindi / Gujarati / ₹… as images (lib/print/text-raster-browser.ts). */
  rasterize?: TextRasterizer;
  /** Copies in one job; copy 2 onward is marked DUPLICATE. Default 1. */
  copies?: number;
  /** Pulse the cash drawer before printing. */
  openDrawer?: boolean;
  /** Language for "amount in words" (Hindi etc. print as images when a rasterizer is set). Default English. */
  language?: DocumentLanguage;
  /** Print the HSN/SAC-wise tax summary when items carry tax rates. Default true. */
  showHsnSummary?: boolean;
  /** Print the total in words. Default true. */
  showAmountInWords?: boolean;
}

/** One row of the HSN/SAC-wise tax summary. */
export type HsnSummaryRow = { hsn: string; rate: number; taxable: number; tax: number };

/** Groups items by HSN/SAC and rate (items without HSN are grouped under "-"). */
export function hsnSummary(items: ReceiptLineItem[]): HsnSummaryRow[] {
  const rows = new Map<string, HsnSummaryRow>();
  for (const item of items) {
    if (item.taxRate == null || item.taxableValue == null) continue;
    const hsn = (item.hsn || '').trim() || '-';
    const rate = Number(item.taxRate) || 0;
    const key = `${hsn}|${rate}`;
    const row = rows.get(key) ?? { hsn, rate, taxable: 0, tax: 0 };
    row.taxable += Number(item.taxableValue) || 0;
    row.tax += item.taxAmount != null ? Number(item.taxAmount) || 0 : ((Number(item.taxableValue) || 0) * rate) / 100;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

/** Total quantity across items, for "Items: 4  Qty: 7". */
function totalQuantity(items: ReceiptLineItem[]): number {
  return Math.round(items.reduce((s, i) => s + (Number(i.quantity) || 0), 0) * 1000) / 1000;
}

/**
 * Main entry point.
 */
export function buildInvoiceReceiptEscPos(
  data: ReceiptData,
  opts: BuildReceiptOptions = {}
): Uint8Array {
  const paper = opts.paperWidthMm ?? 58;
  const b = new EscPosBuilder({ paperWidthMm: paper, rasterize: opts.rasterize });
  const copies = Math.min(5, Math.max(1, Math.floor(opts.copies ?? 1)));
  b.init();
  if (opts.openDrawer) b.openDrawer();
  for (let copy = 1; copy <= copies; copy++) {
    if (copy > 1) b.init();
    writeReceipt(b, data, opts, copy > 1);
  }
  return b.build();
}

function writeReceipt(b: EscPosBuilder, data: ReceiptData, opts: BuildReceiptOptions, duplicate: boolean): void {
  const billOfSupply = data.documentType === 'bill_of_supply';
  const registered = !!data.business.gstin;

  // ------------------------ Header
  b.align('center').bold(true).sizeBig().line(trunc(data.business.name, Math.floor(b.colsFontA / 2)));
  b.sizeNormal().bold(false);
  if (data.business.address) {
    for (const seg of wrap(data.business.address, b.colsFontA)) b.line(seg);
  }
  const headerMeta: string[] = [];
  if (data.business.phone) headerMeta.push(data.business.phone);
  if (data.business.gstin) headerMeta.push(`GSTIN ${data.business.gstin}`);
  if (headerMeta.length) b.line(trunc(headerMeta.join(' | '), b.colsFontA));
  if (data.business.fssai) b.line(`FSSAI ${data.business.fssai}`);

  // ------------------------ Invoice meta
  b.separator();
  if (registered || duplicate) {
    const title = billOfSupply ? 'BILL OF SUPPLY' : registered ? 'TAX INVOICE' : 'INVOICE';
    b.align('center').bold(true).line(duplicate ? `${title} - DUPLICATE` : title).bold(false);
  }
  b.align('left').bold(true).line(`Invoice: ${data.invoiceNumber}`).bold(false);
  b.line(`Date: ${fmtDateTime(data.invoiceDate)}`);
  if (registered && (data.placeOfSupplyName || data.placeOfSupplyStateCode)) {
    const pos = [data.placeOfSupplyName, data.placeOfSupplyStateCode ? `(${data.placeOfSupplyStateCode})` : '']
      .filter(Boolean)
      .join(' ');
    for (const seg of wrap(`Place of supply: ${pos}`, b.colsFontA)) b.line(seg);
  }
  if (data.isReverseCharge) b.line('Tax payable on reverse charge: Yes');

  // ------------------------ Customer
  if (data.customer && (data.customer.name || data.customer.phone)) {
    b.separator();
    b.line('Bill To:');
    if (data.customer.name) b.line(`  ${trunc(data.customer.name, b.colsFontA - 2)}`);
    const meta: string[] = [];
    if (data.customer.phone) meta.push(data.customer.phone);
    if (data.customer.gstin) meta.push(`GSTIN ${data.customer.gstin}`);
    if (meta.length) b.line(`  ${trunc(meta.join(' | '), b.colsFontA - 2)}`);
  }

  // ------------------------ Items table
  b.separator();
  b.align('left').bold(true);
  const nameWidth = Math.max(10, b.colsFontA - 13);
  b.line(pad('Item', nameWidth) + padLeft('Qty', 4) + padLeft('Amt', 9));
  b.bold(false);
  b.separator('.');

  for (const item of data.items) {
    // Name may wrap to second line; qty+amount print on the FIRST line only.
    const nameLines = wrap(item.name, nameWidth);
    const first = nameLines.shift() ?? '';
    b.columns([
      { text: first, width: nameWidth },
      { text: fmtQty(item.quantity, item.unit), width: 4, align: 'right' },
      { text: fmtAmount(item.amount), width: 9, align: 'right' },
    ]);
    for (const extra of nameLines) {
      b.line(pad(extra, nameWidth));
    }
    if (item.unitPrice && item.quantity && Math.abs(item.unitPrice * item.quantity - item.amount) > 0.01) {
      // Show unit price line when it differs from amount/qty (e.g. after discount).
      b.line(padLeft(`@ ${fmtAmount(item.unitPrice)}`, b.colsFontA));
    }
  }

  // ------------------------ Totals
  b.separator('.');
  b.line(`Items: ${data.items.length}  Qty: ${totalQuantity(data.items)}`);
  b.separator();
  const leftPad = b.colsFontA - 12; // 12 chars reserved for the right-aligned value
  if (data.discountTotal && data.discountTotal > 0) {
    b.line(padLeft('Discount', leftPad) + padLeft(`- ${fmtAmount(data.discountTotal)}`, 12));
  }
  b.line(padLeft('Subtotal', leftPad) + padLeft(fmtAmount(data.subtotal), 12));
  if (data.cgstTotal) b.line(padLeft('CGST', leftPad) + padLeft(fmtAmount(data.cgstTotal), 12));
  if (data.sgstTotal) b.line(padLeft('SGST', leftPad) + padLeft(fmtAmount(data.sgstTotal), 12));
  if (data.igstTotal) b.line(padLeft('IGST', leftPad) + padLeft(fmtAmount(data.igstTotal), 12));
  if (data.taxTotal && !data.cgstTotal && !data.sgstTotal && !data.igstTotal) {
    b.line(padLeft('Tax', leftPad) + padLeft(fmtAmount(data.taxTotal), 12));
  }
  if (data.roundOff) {
    b.line(padLeft('Round off', leftPad) + padLeft(fmtAmount(data.roundOff), 12));
  }

  b.bold(true).sizeTall();
  b.line(padLeft('TOTAL', Math.max(1, leftPad - 6)) + padLeft(fmtAmount(data.grandTotal), 18));
  b.sizeNormal().bold(false);
  if (opts.showAmountInWords !== false && data.grandTotal > 0) {
    const words = amountInWords(data.grandTotal, opts.language ?? 'en');
    b.align('left');
    for (const seg of wrap(words, b.colsFontA)) b.line(seg);
  }

  // ------------------------ HSN-wise tax summary (GST bills)
  const summary = registered && !billOfSupply && opts.showHsnSummary !== false ? hsnSummary(data.items) : [];
  if (summary.length > 0 && summary.some((r) => r.tax > 0)) {
    const w = b.colsFontA;
    const rateW = 5;
    const amtW = Math.floor((w - rateW) / 3);
    const hsnW = w - rateW - amtW * 2;
    b.separator('.');
    b.bold(true).line(pad('HSN/SAC', hsnW) + padLeft('Taxable', amtW) + padLeft('GST%', rateW) + padLeft('Tax', amtW)).bold(false);
    for (const r of summary) {
      b.line(pad(r.hsn, hsnW) + padLeft(fmtAmount(r.taxable), amtW) + padLeft(fmtRate(r.rate), rateW) + padLeft(fmtAmount(r.tax), amtW));
    }
  }
  if (billOfSupply) {
    b.separator('.');
    for (const seg of wrap('Composition taxable person, not eligible to collect tax on supplies.', b.colsFontA)) b.line(seg);
  }

  // ------------------------ Payment
  if (data.paymentMode || data.paidAmount != null || data.balance != null) {
    b.separator();
    if (data.paymentMode) b.line(`Paid by: ${data.paymentMode}`);
    if (data.paidAmount != null) {
      b.line(`Paid amount: ${fmtAmount(data.paidAmount)}`);
    }
    if (data.changeGiven != null && data.changeGiven > 0.0001) {
      if (data.cashTendered != null) {
        b.line(`Tendered: ${fmtAmount(data.cashTendered)}`);
      }
      b.line(`Change: ${fmtAmount(data.changeGiven)}`);
    }
    if (data.balance != null && data.balance > 0.0001) {
      b.bold(true).line(`Balance due: ${fmtAmount(data.balance)}`).bold(false);
    }
  }

  // ------------------------ e-Invoice
  if (data.irn) {
    b.separator();
    b.align('left');
    for (const seg of wrap(`IRN: ${data.irn}`, b.colsFontA)) b.line(seg);
    if (data.ackNo) b.line(trunc(`Ack No: ${data.ackNo}`, b.colsFontA));
    if (data.ackDate) b.line(trunc(`Ack Date: ${data.ackDate}`, b.colsFontA));
    if (data.signedQr) {
      b.align('center');
      b.qrcode(data.signedQr, { size: 3, ecLevel: 'L' });
    }
  }

  // ------------------------ Footer
  if (data.footerQr && !duplicate) {
    b.separator();
    b.align('center').line('Scan to pay');
    b.qrcode(data.footerQr, { size: 6, ecLevel: 'M' });
  }
  if (data.footerText) {
    b.align('center');
    for (const seg of wrap(data.footerText, b.colsFontA)) b.line(seg);
  } else {
    b.align('center').line('Thank you for your business!');
  }
  if (data.notes) {
    b.separator('.');
    b.align('left');
    for (const seg of wrap(data.notes, b.colsFontA)) b.line(seg);
  }

  if (opts.showKhatarioFooter) {
    b.feed(1);
    b.align('right').line('Powered by Khatario');
  }

  if (!opts.skipCut) {
    b.cut();
  } else {
    b.feed(4);
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function pad(s: string, width: number): string {
  const t = (s || '').slice(0, width);
  return t + ' '.repeat(Math.max(0, width - t.length));
}
function padLeft(s: string, width: number): string {
  const t = (s || '').slice(0, width);
  return ' '.repeat(Math.max(0, width - t.length)) + t;
}
function trunc(s: string, width: number): string {
  if (!s) return '';
  return s.length > width ? s.slice(0, Math.max(0, width - 1)) + '…' : s;
}
function wrap(text: string, width: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur.length) {
      cur = w;
    } else if (cur.length + 1 + w.length <= width) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
    // Hard-break very long single words.
    while (cur.length > width) {
      lines.push(cur.slice(0, width));
      cur = cur.slice(width);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function fmtAmount(v: number): string {
  if (v == null || !Number.isFinite(v)) return '0.00';
  return v.toFixed(2);
}
function fmtRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}
function fmtQty(qty: number, unit?: string | null): string {
  const s = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
  return unit ? `${s}${unit.slice(0, 2)}` : s;
}
function fmtDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
