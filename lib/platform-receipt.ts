/**
 * The receipt (or tax invoice / refund receipt / credit note) for one of Khatario's own subscription
 * payments: loaded from the stored row, never recomputed from today's settings, and rendered as HTML
 * with every value escaped (business names and addresses are typed by users).
 */

import { queryOne } from '@/lib/db';
import {
  DOCUMENT_TITLES,
  documentKind,
  formatBuyerAddress,
  type DocumentKind,
  type GstMode,
} from '@/lib/platform-tax';
import { GST_STATE_NAMES } from '@/lib/tax/gstin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type ReceiptRow = {
  id: string;
  business_id: string;
  type: string;
  status: string;
  amount: string;
  discount_amount: string | null;
  total_amount: string;
  tax_amount: string | null;
  taxable_amount: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
  gst_rate: string | null;
  gst_mode: string | null;
  invoice_number: string | null;
  description: string | null;
  billing_cycle: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  metadata: Record<string, any> | null;
  period_start: string | null;
  period_end: string | null;
  issued_on: string;
  plan_name: string | null;
  business_name: string | null;
  business_gstin: string | null;
  business_state: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  original_invoice_number: string | null;
  original_date: string | null;
};

export type ReceiptData = {
  kind: DocumentKind;
  title: string;
  mode: GstMode;
  isRefund: boolean;
  number: string | null;
  issuedOn: string;
  seller: { name: string; address: string | null; gstin: string | null; sac: string | null };
  buyer: { name: string; gstin: string | null; address: string | null; placeOfSupply: string | null };
  description: string;
  planName: string | null;
  period: { start: string; end: string } | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  originalNumber: string | null;
  originalDate: string | null;
  /** Rupees, all positive; the title says which way the money goes. */
  lines: {
    listPrice: number | null;
    discount: number;
    credit: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    tax: number;
    total: number;
    rate: number;
  };
};

/** The same row shape as the live query, read from the archive copy (no live business, so no address). */
async function loadArchivedReceiptRow(paymentId: string): Promise<ReceiptRow | null> {
  return queryOne<ReceiptRow>(
    `SELECT bt.id::text AS id, bt.business_id::text AS business_id, bt.type, bt.status,
            bt.amount::text AS amount, bt.discount_amount::text AS discount_amount, bt.total_amount::text AS total_amount,
            bt.tax_amount::text AS tax_amount, bt.taxable_amount::text AS taxable_amount,
            bt.cgst_amount::text AS cgst_amount, bt.sgst_amount::text AS sgst_amount, bt.igst_amount::text AS igst_amount,
            bt.gst_rate::text AS gst_rate, bt.gst_mode, bt.invoice_number, bt.description, bt.billing_cycle,
            bt.payment_method, bt.payment_reference, bt.metadata,
            bt.period_start::text AS period_start, bt.period_end::text AS period_end,
            to_char(CASE WHEN bt.type = 'refund' THEN bt.updated_at
                         ELSE COALESCE((bt.metadata->>'paid_at')::timestamptz, bt.created_at) END
                    AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS issued_on,
            sp.display_name AS plan_name,
            bt.business_name AS business_name, bt.business_gstin AS business_gstin, NULL::text AS business_state,
            NULL::text AS address_line1, NULL::text AS address_line2, NULL::text AS city, NULL::text AS pincode,
            orig.invoice_number AS original_invoice_number,
            to_char(COALESCE((orig.metadata->>'paid_at')::timestamptz, orig.created_at) AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS original_date
     FROM billing_transactions_archive bt
     LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
     LEFT JOIN billing_transactions_archive orig
       ON bt.type = 'refund' AND orig.id::text = bt.metadata->>'refund_of' AND orig.business_id = bt.business_id
     WHERE bt.id = $1::uuid
       AND ((bt.type = 'payment' AND bt.status IN ('completed', 'refunded')) OR (bt.type = 'refund' AND bt.status = 'completed'))`,
    [paymentId],
  );
}

const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

/**
 * The document for `paymentId` (a completed payment, a refunded one, or a completed refund).
 * `businessId` restricts it to that business (the customer's own); null is for a platform admin.
 * Anything else, including another business's id, is null (the route answers 404).
 */
export async function loadReceipt(
  paymentId: string,
  businessId: string | null,
  opts: { includeArchived?: boolean } = {},
): Promise<ReceiptData | null> {
  if (!UUID.test(paymentId)) return null;
  if (businessId !== null && !UUID.test(businessId)) return null;
  let r = await queryOne<ReceiptRow>(
    `SELECT bt.id::text AS id, bt.business_id::text AS business_id, bt.type, bt.status,
            bt.amount::text AS amount, bt.discount_amount::text AS discount_amount, bt.total_amount::text AS total_amount,
            bt.tax_amount::text AS tax_amount, bt.taxable_amount::text AS taxable_amount,
            bt.cgst_amount::text AS cgst_amount, bt.sgst_amount::text AS sgst_amount, bt.igst_amount::text AS igst_amount,
            bt.gst_rate::text AS gst_rate, bt.gst_mode, bt.invoice_number, bt.description, bt.billing_cycle,
            bt.payment_method, bt.payment_reference, bt.metadata,
            bt.period_start::text AS period_start, bt.period_end::text AS period_end,
            to_char(CASE WHEN bt.type = 'refund' THEN bt.updated_at
                         ELSE COALESCE((bt.metadata->>'paid_at')::timestamptz, bt.created_at) END
                    AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS issued_on,
            sp.display_name AS plan_name,
            b.name AS business_name, b.gstin AS business_gstin, b.state AS business_state,
            b.address_line1, b.address_line2, b.city, b.pincode,
            orig.invoice_number AS original_invoice_number,
            to_char(COALESCE((orig.metadata->>'paid_at')::timestamptz, orig.created_at) AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS original_date
     FROM billing_transactions bt
     JOIN businesses b ON b.id = bt.business_id
     LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
     LEFT JOIN billing_transactions orig
       ON bt.type = 'refund' AND orig.id::text = bt.metadata->>'refund_of' AND orig.business_id = bt.business_id
     WHERE bt.id = $1::uuid
       AND ($2::uuid IS NULL OR bt.business_id = $2::uuid)
       AND ((bt.type = 'payment' AND bt.status IN ('completed', 'refunded')) OR (bt.type = 'refund' AND bt.status = 'completed'))`,
    [paymentId, businessId],
  );
  // Payments of a deleted business live in billing_transactions_archive. Only a platform admin
  // (businessId null) may ask for them; a customer lookup never reaches the archive.
  if (!r && opts.includeArchived === true && businessId === null) {
    r = await loadArchivedReceiptRow(paymentId);
  }
  if (!r) return null;

  const isRefund = r.type === 'refund';
  const meta = r.metadata ?? {};
  // The snapshot of seller and buyer taken when the checkout was priced. A refund's own row carries
  // only its tax split, so it reads the seller from the payment it undoes via its own column mode.
  const stored = (meta.tax ?? null) as Record<string, any> | null;
  const mode: GstMode =
    r.gst_mode === 'inclusive' || r.gst_mode === 'exclusive' ? r.gst_mode : 'none';
  const taxed = mode !== 'none';
  const kind = documentKind(r.type, mode);

  const total = n(r.total_amount);
  const tax = taxed ? n(r.tax_amount) : 0;
  const taxable = taxed && r.taxable_amount !== null ? n(r.taxable_amount) : total - tax;
  const credit = isRefund ? 0 : n(meta.upgrade_credit?.amount);
  const buyerStored = stored?.buyer ?? null;
  const placeCode: string | null = taxed ? (buyerStored?.state_code ?? stored?.place_of_supply_code ?? null) : null;

  return {
    kind,
    title: DOCUMENT_TITLES[kind],
    mode,
    isRefund,
    number: r.invoice_number,
    issuedOn: r.issued_on,
    seller: {
      name: stored?.seller?.legal_name || 'Khatario',
      address: stored?.seller?.address ?? null,
      gstin: taxed ? (stored?.seller?.gstin ?? null) : null,
      sac: taxed ? (stored?.sac_code ?? null) : null,
    },
    buyer: {
      name: buyerStored?.name || r.business_name || 'Customer',
      // A row priced with GST shows the GSTIN it was priced with; only a row with no snapshot reads the live one.
      gstin: taxed ? (buyerStored ? (buyerStored.gstin ?? null) : (r.business_gstin ?? null)) : null,
      address:
        buyerStored?.address ??
        formatBuyerAddress({
          address_line1: r.address_line1,
          address_line2: r.address_line2,
          city: r.city,
          state: r.business_state,
          pincode: r.pincode,
        }),
      placeOfSupply: placeCode ? `${GST_STATE_NAMES[placeCode] ?? placeCode} (${placeCode})` : null,
    },
    description: isRefund
      ? `Refund of your ${r.plan_name ?? 'plan'} payment`
      : r.description || r.plan_name || 'Khatario subscription',
    planName: r.plan_name,
    period: !isRefund && r.period_start && r.period_end ? { start: r.period_start, end: r.period_end } : null,
    paymentMethod: r.payment_method,
    paymentReference: r.payment_reference,
    originalNumber: r.original_invoice_number,
    originalDate: r.original_date,
    lines: {
      listPrice: isRefund ? null : n(r.amount),
      discount: isRefund ? 0 : n(r.discount_amount),
      credit,
      taxable,
      cgst: taxed ? n(r.cgst_amount) : 0,
      sgst: taxed ? n(r.sgst_amount) : 0,
      igst: taxed ? n(r.igst_amount) : 0,
      tax,
      total,
      rate: taxed ? n(r.gst_rate) : 0,
    },
  };
}

const inr = (v: number) =>
  `&#8377;${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderReceiptHtml(d: ReceiptData): string {
  const taxed = d.mode !== 'none';
  const l = d.lines;
  const row = (label: string, amount: string, strong = false) =>
    `<tr${strong ? ' class="total"' : ''}><td>${escapeHtml(label)}</td><td class="num">${amount}</td></tr>`;
  const rows: string[] = [];
  if (!d.isRefund && l.listPrice !== null) {
    rows.push(row(d.mode === 'inclusive' ? 'Plan price (includes GST)' : 'Plan price', inr(l.listPrice)));
    if (l.discount > 0) rows.push(row('Coupon discount', `&minus;${inr(l.discount)}`));
    if (l.credit > 0) rows.push(row('Credit for unused time on your earlier plan', `&minus;${inr(l.credit)}`));
  }
  if (taxed) {
    rows.push(row('Taxable value', inr(l.taxable)));
    if (l.igst > 0) rows.push(row(`IGST @ ${l.rate}%`, inr(l.igst)));
    if (l.cgst > 0) rows.push(row(`CGST @ ${l.rate / 2}%`, inr(l.cgst)));
    if (l.sgst > 0) rows.push(row(`SGST @ ${l.rate / 2}%`, inr(l.sgst)));
    if (l.tax === 0) rows.push(row(`GST @ ${l.rate}%`, inr(0)));
  }
  rows.push(row(d.isRefund ? 'Total refunded' : taxed ? 'Total' : 'Total paid', inr(l.total), true));

  const meta: string[] = [];
  if (d.number) meta.push(`<div><span>${escapeHtml(d.title)} no.</span> ${escapeHtml(d.number)}</div>`);
  meta.push(`<div><span>Date</span> ${escapeHtml(d.issuedOn)}</div>`);
  if (d.isRefund && (d.originalNumber || d.originalDate)) {
    meta.push(
      `<div><span>For the payment</span> ${escapeHtml(d.originalNumber ?? '')}${d.originalNumber && d.originalDate ? ' of ' : ''}${escapeHtml(d.originalDate ?? '')}</div>`,
    );
  }
  if (d.period) meta.push(`<div><span>Period</span> ${escapeHtml(d.period.start)} to ${escapeHtml(d.period.end)}</div>`);
  if (d.paymentMethod) meta.push(`<div><span>Paid by</span> ${escapeHtml(d.paymentMethod)}</div>`);
  if (d.paymentReference) meta.push(`<div><span>Reference</span> ${escapeHtml(d.paymentReference)}</div>`);
  if (taxed && d.seller.sac) meta.push(`<div><span>SAC</span> ${escapeHtml(d.seller.sac)}</div>`);
  if (taxed && d.buyer.placeOfSupply) {
    meta.push(`<div><span>Place of supply</span> ${escapeHtml(d.buyer.placeOfSupply)}</div>`);
  }

  const party = (heading: string, name: string, address: string | null, gstin: string | null) =>
    `<div class="party"><h2>${escapeHtml(heading)}</h2><strong>${escapeHtml(name)}</strong>` +
    (address ? `<div>${escapeHtml(address)}</div>` : '') +
    (gstin ? `<div>GSTIN ${escapeHtml(gstin)}</div>` : '') +
    `</div>`;

  const note = d.isRefund
    ? 'This amount was returned to the payment method you used.'
    : taxed
      ? 'This is a computer-generated tax invoice.'
      : 'This is a receipt for your payment.';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(d.title)}${d.number ? ' ' + escapeHtml(d.number) : ''}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:24px}
main{max-width:720px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}
.meta{margin:12px 0 20px;color:#444}.meta span{display:inline-block;min-width:140px;color:#777}
.parties{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px}.party{flex:1 1 260px}.party h2{font-size:12px;text-transform:uppercase;color:#777;margin:0 0 4px}
table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #e5e5e5}td.num{text-align:right;white-space:nowrap}
tr.total td{font-weight:700;border-bottom:2px solid #1a1a1a}
.note{margin-top:20px;color:#666;font-size:13px}
@media print{body{padding:0}}
</style></head><body><main>
<h1>${escapeHtml(d.title)}</h1>
<div>${escapeHtml(d.description)}</div>
<div class="meta">${meta.join('')}</div>
<div class="parties">${party('From', d.seller.name, d.seller.address, d.seller.gstin)}${party('To', d.buyer.name, d.buyer.address, d.buyer.gstin)}</div>
<table>${rows.join('')}</table>
<p class="note">${note}</p>
</main></body></html>`;
}

/** Headers for the HTML response: private, never cached, no scripts and nothing loaded from elsewhere. */
export const RECEIPT_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
};
