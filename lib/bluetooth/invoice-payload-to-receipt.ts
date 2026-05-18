/**
 * INVOICE PAYLOAD -> RECEIPT
 *
 * Adapter that converts a raw invoice payload (as returned by
 * GET /api/invoices/[id]) into the narrow ReceiptData shape consumed by
 * invoice-to-escpos.ts. Lives in /lib so multiple pages (invoice detail,
 * POS quick-print, draft preview) can share the mapping logic.
 *
 * The caller is expected to also pass the `business` object from
 * AuthContext because the invoice payload doesn't include business
 * branding / FSSAI / phone details.
 */

import type { ReceiptData } from './invoice-to-escpos';

export interface InvoicePayloadLike {
  invoice_number: string;
  invoice_date: string | Date;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_gstin?: string | null;
  subtotal?: number | string;
  discount_total?: number | string;
  tax_total?: number | string;
  cgst_total?: number | string;
  sgst_total?: number | string;
  igst_total?: number | string;
  round_off?: number | string;
  grand_total?: number | string;
  paid_amount?: number | string;
  balance_amount?: number | string;
  notes?: string | null;
  items?: Array<{
    item_name?: string | null;
    item_code?: string | null;
    variant_name?: string | null;
    hsn?: string | null;
    quantity?: number | string | null;
    unit?: string | null;
    unit_price?: number | string | null;
    price?: number | string | null;
    amount?: number | string | null;
    line_total?: number | string | null;
  }>;
  payments?: Array<{
    payment_mode?: string | null;
    method?: string | null;
    amount?: number | string | null;
  }>;
}

export interface BusinessPayloadLike {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssai_licence_no?: string | null;
  fssai?: string | null;
}

export interface PayloadToReceiptOptions {
  /** Optional UPI / invoice link encoded as QR in the footer. */
  footerQr?: string | null;
  /** Optional custom footer text shown above the cut line. */
  footerText?: string | null;
}

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function invoicePayloadToReceipt(
  invoice: InvoicePayloadLike,
  business: BusinessPayloadLike,
  opts: PayloadToReceiptOptions = {}
): ReceiptData {
  const items = (invoice.items || []).map((it) => {
    const qty = num(it.quantity);
    const unitPrice = num(it.unit_price ?? it.price);
    const amount = num(it.amount ?? it.line_total ?? unitPrice * qty);
    return {
      name: [it.item_name, it.variant_name].filter(Boolean).join(' - ') || 'Item',
      hsn: it.hsn || null,
      quantity: qty,
      unit: it.unit || null,
      unitPrice,
      amount,
    };
  });

  // Pick the most common payment mode if the invoice has payments.
  let paymentMode: string | undefined;
  const paidSum = (invoice.payments || []).reduce(
    (s, p) => s + num(p.amount),
    0
  );
  if (invoice.payments && invoice.payments.length > 0) {
    const modes = invoice.payments
      .map((p) => (p.payment_mode || p.method || '').toString().trim())
      .filter(Boolean);
    if (modes.length) paymentMode = modes[0];
  }

  const paid = num(invoice.paid_amount) || paidSum;
  const balance = num(invoice.balance_amount);

  return {
    business: {
      name: business.name || 'Store',
      address: business.address || null,
      phone: business.phone || null,
      gstin: business.gstin || null,
      fssai: business.fssai_licence_no || business.fssai || null,
    },
    customer:
      invoice.customer_name || invoice.customer_phone
        ? {
            name: invoice.customer_name || null,
            phone: invoice.customer_phone || null,
            gstin: invoice.customer_gstin || null,
          }
        : null,
    invoiceNumber: invoice.invoice_number,
    invoiceDate:
      invoice.invoice_date instanceof Date
        ? invoice.invoice_date
        : new Date(invoice.invoice_date),
    items,
    subtotal: num(invoice.subtotal),
    discountTotal: num(invoice.discount_total),
    taxTotal: num(invoice.tax_total),
    cgstTotal: num(invoice.cgst_total),
    sgstTotal: num(invoice.sgst_total),
    igstTotal: num(invoice.igst_total),
    roundOff: num(invoice.round_off),
    grandTotal: num(invoice.grand_total),
    paidAmount: paid,
    balance,
    paymentMode,
    notes: invoice.notes || null,
    footerQr: opts.footerQr || null,
    footerText: opts.footerText || null,
  };
}
