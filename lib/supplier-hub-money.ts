/**
 * Money between connected businesses (migration 428).
 *
 * A buyer's payment or debit note against a purchase made from a connected supplier's bill
 * becomes a notice for that supplier. The supplier records the matching receipt in one tap
 * (through the normal payments API, so ledgers and GST are the same as a hand-made receipt) or
 * opens a credit note pre-filled for the bill. Notices are best effort: they never block the
 * buyer's own payment or return, which is already saved when they are written.
 */

import { query, queryOne, queryRows } from './db';
import { execFor } from './supplier-hub-links';
import { queueHubWhatsApp } from './supplier-hub-whatsapp';

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

type HubSource = {
  invoice_id: string;
  vendor_business_id: string;
  invoice_number: string | null;
  buyer_name: string;
};

/** The connected supplier's bill behind a buyer's purchase, while the link is live. */
async function hubSourceOf(buyerBusinessId: string, purchaseId: string): Promise<HubSource | null> {
  return queryOne<HubSource>(
    `SELECT p.source_invoice_id AS invoice_id, p.source_business_id AS vendor_business_id,
            inv.invoice_number, b.name AS buyer_name
       FROM purchases p
       JOIN invoices inv ON inv.id = p.source_invoice_id AND inv.business_id = p.source_business_id
       JOIN businesses b ON b.id = p.business_id
       JOIN suppliers s ON s.business_id = p.business_id AND s.linked_business_id = p.source_business_id
                       AND s.approval_status = 'approved' AND s.deleted_at IS NULL
      WHERE p.id = $1 AND p.business_id = $2 AND p.source_invoice_id IS NOT NULL
      LIMIT 1`,
    [purchaseId, buyerBusinessId]
  );
}

async function tellSupplier(vendorId: string, title: string, detail: string, noticeId: string) {
  const exec = execFor();
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, 'supplier_hub_money', $4, CURRENT_TIMESTAMP)`,
    [vendorId, title, detail, noticeId]
  );
  await queueHubWhatsApp(exec, vendorId, { title, detail, path: '/suppliers/hub' });
}

/** After the buyer saved a payment against a purchase. */
export async function noticeBuyerPayment(p: {
  buyerBusinessId: string;
  purchaseId: string;
  paymentId: string;
  amount: number;
  paymentMode: string | null;
  paymentDate: string | null;
  note: string | null;
}): Promise<void> {
  try {
    const src = await hubSourceOf(p.buyerBusinessId, p.purchaseId);
    if (!src || !(p.amount > 0)) return;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO supplier_hub_money_notices (
         kind, buyer_business_id, vendor_business_id, invoice_id, purchase_id, source_id, amount, happened_on, payment_mode, note
       )
       VALUES ('payment', $1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9)
       ON CONFLICT (kind, source_id) DO NOTHING
       RETURNING id`,
      [p.buyerBusinessId, src.vendor_business_id, src.invoice_id, p.purchaseId, p.paymentId, p.amount, p.paymentDate, p.paymentMode, p.note?.slice(0, 300) || null]
    );
    if (!row) return;
    await tellSupplier(
      src.vendor_business_id,
      `${src.buyer_name} paid ${inr(p.amount)}`,
      `For bill ${src.invoice_number || ''}${p.paymentMode ? ` by ${p.paymentMode}` : ''}. Record the receipt in one tap.`,
      row.id
    );
  } catch (error) {
    console.error('[hub-money] payment notice failed', error);
  }
}

/** After the buyer saved a debit note (purchase return) against a purchase. */
export async function noticeBuyerDebitNote(p: {
  buyerBusinessId: string;
  purchaseId: string;
  returnId: string;
  amount: number;
  returnDate: string | null;
  reason: string | null;
}): Promise<void> {
  try {
    const src = await hubSourceOf(p.buyerBusinessId, p.purchaseId);
    if (!src) return;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO supplier_hub_money_notices (
         kind, buyer_business_id, vendor_business_id, invoice_id, purchase_id, source_id, amount, happened_on, note
       )
       VALUES ('debit_note', $1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8)
       ON CONFLICT (kind, source_id) DO NOTHING
       RETURNING id`,
      [p.buyerBusinessId, src.vendor_business_id, src.invoice_id, p.purchaseId, p.returnId, p.amount, p.returnDate, p.reason?.slice(0, 300) || null]
    );
    if (!row) return;
    await tellSupplier(
      src.vendor_business_id,
      `${src.buyer_name} raised a debit note of ${inr(p.amount)}`,
      `Against bill ${src.invoice_number || ''}${p.reason ? `: ${p.reason}` : ''}. Issue the matching credit note.`,
      row.id
    );
  } catch (error) {
    console.error('[hub-money] debit note notice failed', error);
  }
}

export type MoneyNotice = {
  id: string;
  kind: 'payment' | 'debit_note';
  amount: number;
  happened_on: string;
  payment_mode: string | null;
  note: string | null;
  created_at: string;
  invoice_id: string;
  invoice_number: string | null;
  buyer_name: string;
  customer_id: string | null;
};

/**
 * The supplier's open notices. A debit-note notice closes by itself once a credit note on the
 * same bill has been made after it.
 */
export async function listMoneyNotices(vendorBusinessId: string): Promise<MoneyNotice[]> {
  const rows = await queryRows<any>(
    `SELECT n.id, n.kind, n.amount, n.happened_on, n.payment_mode, n.note, n.created_at, n.invoice_id,
            inv.invoice_number, b.name AS buyer_name, inv.customer_id
       FROM supplier_hub_money_notices n
       JOIN invoices inv ON inv.id = n.invoice_id
       JOIN businesses b ON b.id = n.buyer_business_id
      WHERE n.vendor_business_id = $1 AND n.status = 'pending'
        AND NOT (n.kind = 'debit_note' AND EXISTS (
          SELECT 1 FROM credit_notes cn
           WHERE cn.invoice_id = n.invoice_id AND cn.business_id = n.vendor_business_id AND cn.created_at >= n.created_at
        ))
      ORDER BY n.created_at DESC
      LIMIT 50`,
    [vendorBusinessId]
  );
  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    happened_on: String(r.happened_on instanceof Date ? r.happened_on.toISOString() : r.happened_on).slice(0, 10),
    created_at: new Date(r.created_at).toISOString(),
  }));
}

/** A pending notice of the supplier's, or null. */
export async function pendingNotice(noticeId: string, vendorBusinessId: string) {
  return queryOne<{
    id: string;
    kind: string;
    amount: string;
    happened_on: string;
    payment_mode: string | null;
    note: string | null;
    invoice_id: string;
    customer_id: string | null;
    buyer_name: string;
  }>(
    `SELECT n.id, n.kind, n.amount, to_char(n.happened_on, 'YYYY-MM-DD') AS happened_on, n.payment_mode, n.note,
            n.invoice_id, inv.customer_id, b.name AS buyer_name
       FROM supplier_hub_money_notices n
       JOIN invoices inv ON inv.id = n.invoice_id
       JOIN businesses b ON b.id = n.buyer_business_id
      WHERE n.id = $1 AND n.vendor_business_id = $2 AND n.status = 'pending'`,
    [noticeId, vendorBusinessId]
  );
}

export async function resolveNotice(noticeId: string, vendorBusinessId: string, status: 'recorded' | 'dismissed', docId?: string | null) {
  await query(
    `UPDATE supplier_hub_money_notices SET status = $3, recorded_doc_id = $4, resolved_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND vendor_business_id = $2 AND status = 'pending'`,
    [noticeId, vendorBusinessId, status, docId ?? null]
  );
}

/** The supplier's default UPI ID, for the buyer's "Pay by UPI" button. */
export async function supplierUpiId(vendorBusinessId: string): Promise<string | null> {
  const row = await queryOne<{ upi_id: string }>(
    `SELECT upi_id FROM payment_methods
      WHERE business_id = $1 AND method_type = 'upi' AND upi_id IS NOT NULL AND COALESCE(is_active, true) = true
      ORDER BY COALESCE(is_default, false) DESC, COALESCE(priority, 0) ASC, created_at ASC
      LIMIT 1`,
    [vendorBusinessId]
  ).catch(() => null);
  return row?.upi_id ?? null;
}

/** upi:// link that opens any UPI app with the payee, amount and bill number filled in. */
export function upiPayLink(p: { upiId: string; payeeName: string; amount: number; billNumber: string | null }) {
  const q = new URLSearchParams({
    pa: p.upiId,
    pn: p.payeeName.slice(0, 50),
    am: (Math.round(p.amount * 100) / 100).toFixed(2),
    cu: 'INR',
    tn: `Bill ${p.billNumber || ''}`.trim().slice(0, 50),
  });
  return `upi://pay?${q.toString()}`;
}
