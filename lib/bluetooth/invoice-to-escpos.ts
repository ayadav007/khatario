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
  paymentMode?: string;
  notes?: string | null;
  /** Optional UPI / URL / invoice link encoded as QR at the footer. */
  footerQr?: string | null;
  /** Free-text footer (thank-you message, return policy, etc.). */
  footerText?: string | null;
}

export interface BuildReceiptOptions {
  paperWidthMm?: 58 | 80;
  /** When true, do not emit a paper-cut command at the end. */
  skipCut?: boolean;
  /** Free/trial businesses — append “Powered by Khatario” before cut. */
  showKhatarioFooter?: boolean;
}

/**
 * Main entry point.
 */
export function buildInvoiceReceiptEscPos(
  data: ReceiptData,
  opts: BuildReceiptOptions = {}
): Uint8Array {
  const paper = opts.paperWidthMm ?? 58;
  const b = new EscPosBuilder({ paperWidthMm: paper });
  b.init();

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
  b.align('left').bold(true).line(`Invoice: ${data.invoiceNumber}`).bold(false);
  b.line(`Date: ${fmtDateTime(data.invoiceDate)}`);

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
    b.line(
      pad(first, nameWidth) +
        padLeft(fmtQty(item.quantity, item.unit), 4) +
        padLeft(fmtAmount(item.amount), 9)
    );
    for (const extra of nameLines) {
      b.line(pad(extra, nameWidth));
    }
    if (item.unitPrice && item.quantity && Math.abs(item.unitPrice * item.quantity - item.amount) > 0.01) {
      // Show unit price line when it differs from amount/qty (e.g. after discount).
      b.line(padLeft(`@ ${fmtAmount(item.unitPrice)}`, b.colsFontA));
    }
  }

  // ------------------------ Totals
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

  // ------------------------ Payment
  if (data.paymentMode || data.paidAmount != null || data.balance != null) {
    b.separator();
    if (data.paymentMode) b.line(`Paid by: ${data.paymentMode}`);
    if (data.paidAmount != null) {
      b.line(`Paid amount: ${fmtAmount(data.paidAmount)}`);
    }
    if (data.balance != null && data.balance > 0.0001) {
      b.bold(true).line(`Balance due: ${fmtAmount(data.balance)}`).bold(false);
    }
  }

  // ------------------------ Footer
  if (data.footerQr) {
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
  return b.build();
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
