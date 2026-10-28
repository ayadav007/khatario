import type { PoolClient } from 'pg';
import { round2 } from '@/lib/accounting/voucher-posting';
import { createCreditNoteInTransaction, CreditNoteCreateError, nextCreditNoteNumber } from '@/lib/credit-notes/create-credit-note';
import { refundCreditNote, refundableOnCreditNote, CreditNoteRefundError } from '@/lib/credit-notes/refund';
import { transitionFulfilment } from '@/lib/fulfilment/service';
import type { FulfilmentStatus } from '@/lib/fulfilment/rules';

/**
 * Order returns (RMA) for every channel: online store, WhatsApp, sales orders and manual bills.
 *
 *   requested -> approved | rejected        (buyer-initiated returns wait for the shop)
 *   approved  -> received                    (goods inspected; credit note posted; stock back for "restock")
 *   received  -> closed                      (refund paid, or kept as store credit)
 *   requested | approved -> cancelled
 *
 * Money and stock go through the credit-note service, so GST, ledger and customer balance follow
 * the same rules as a credit note made by hand.
 */

export {
  RETURN_REASONS,
  RETURN_REASON_LABELS,
  type ReturnCondition,
  type ReturnReason,
  type ReturnRefundMethod,
  type ReturnStatus,
} from './labels';
import {
  RETURN_REASONS,
  RETURN_REASON_LABELS,
  type ReturnCondition,
  type ReturnReason,
  type ReturnRefundMethod,
  type ReturnStatus,
} from './labels';

const OPEN_STATUSES: ReturnStatus[] = ['requested', 'approved', 'received', 'closed'];

export class ReturnError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnError';
  }
}

export function isReturnReason(v: unknown): v is ReturnReason {
  return typeof v === 'string' && (RETURN_REASONS as readonly string[]).includes(v);
}

export function isRefundMethod(v: unknown): v is ReturnRefundMethod {
  return v === 'store_credit' || v === 'cash' || v === 'upi' || v === 'bank';
}

function today(): string {
  // Business dates are Indian calendar days.
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export type ReturnableLine = {
  invoice_item_id: string;
  item_id: string | null;
  variant_id: string | null;
  item_name: string;
  unit: string | null;
  /** Base units in one `unit`, as sold. Return quantities stay in the sold unit. */
  unit_factor: number;
  sold_qty: number;
  returnable_qty: number;
  unit_price: number;
  tax_rate: number;
};

/** Bill lines with how much can still be returned (sold minus quantities already in open returns). */
export async function returnableLines(
  client: Pick<PoolClient, 'query'>,
  businessId: string,
  invoiceId: string,
  excludeReturnId?: string | null,
): Promise<ReturnableLine[]> {
  const res = await client.query<{
    id: string;
    item_id: string | null;
    variant_id: string | null;
    item_name: string | null;
    description: string | null;
    unit: string | null;
    unit_factor: string | null;
    quantity: string;
    taxable_value: string | null;
    unit_price: string | null;
    discount_amount: string | null;
    tax_rate: string | null;
    in_returns: string;
  }>(
    `SELECT ii.id, ii.item_id, ii.variant_id, ii.item_name, ii.description, ii.unit, ii.unit_factor::text,
            ii.quantity::text, ii.taxable_value::text, ii.unit_price::text, ii.discount_amount::text, ii.tax_rate::text,
            COALESCE((
              SELECT SUM(COALESCE(ri.received_qty, ri.quantity))
                FROM order_return_items ri
                JOIN order_returns r ON r.id = ri.return_id
               WHERE ri.invoice_item_id = ii.id
                 AND r.business_id = $1
                 AND r.status = ANY($3::varchar[])
                 AND ($4::uuid IS NULL OR r.id <> $4::uuid)
            ), 0)::text AS in_returns
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.business_id = $1 AND ii.invoice_id = $2
      ORDER BY ii.sort_order, ii.id`,
    [businessId, invoiceId, OPEN_STATUSES, excludeReturnId ?? null],
  );
  return res.rows.map((r) => {
    const qty = Number(r.quantity) || 0;
    const taxable =
      r.taxable_value != null
        ? Number(r.taxable_value)
        : (Number(r.unit_price) || 0) * qty - (Number(r.discount_amount) || 0);
    return {
      invoice_item_id: r.id,
      item_id: r.item_id,
      variant_id: r.variant_id,
      item_name: r.item_name || r.description || 'Item',
      unit: r.unit,
      unit_factor: Number(r.unit_factor) || 1,
      sold_qty: qty,
      returnable_qty: Math.max(0, qty - (Number(r.in_returns) || 0)),
      unit_price: qty > 0 ? Math.round((taxable / qty) * 10000) / 10000 : 0,
      tax_rate: Number(r.tax_rate) || 0,
    };
  });
}

async function nextReturnNumber(client: PoolClient, businessId: string): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`order-return-number:${businessId}`]);
  const res = await client.query<{ n: string | null }>(
    `SELECT MAX(SUBSTRING(return_number FROM '[0-9]+$')::int)::text AS n
       FROM order_returns WHERE business_id = $1`,
    [businessId],
  );
  return `RET-${String(Number(res.rows[0]?.n || 0) + 1).padStart(4, '0')}`;
}

type InvoiceLinks = {
  invoiceId: string;
  branchId: string | null;
  customerId: string | null;
  invoiceNumber: string;
  storeOrderId: string | null;
  salesOrderId: string | null;
  fulfilmentId: string | null;
};

async function loadInvoiceLinks(client: PoolClient, businessId: string, invoiceId: string): Promise<InvoiceLinks> {
  const inv = await client.query<{
    id: string;
    branch_id: string | null;
    customer_id: string | null;
    invoice_number: string;
    status: string;
    store_order_id: string | null;
    sales_order_id: string | null;
  }>(
    `SELECT i.id, i.branch_id, i.customer_id, i.invoice_number, i.status,
            (SELECT so.id FROM store_orders so WHERE so.invoice_id = i.id AND so.business_id = i.business_id LIMIT 1) AS store_order_id,
            (SELECT s.id FROM sales_orders s WHERE s.converted_invoice_id = i.id AND s.business_id = i.business_id LIMIT 1) AS sales_order_id
       FROM invoices i
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL
      FOR UPDATE OF i`,
    [invoiceId, businessId],
  );
  const row = inv.rows[0];
  if (!row) throw new ReturnError(404, 'INVOICE_NOT_FOUND', 'Bill not found');
  if (row.status !== 'final') {
    throw new ReturnError(409, 'INVOICE_NOT_FINAL', 'Only a final bill can have a return');
  }
  const f = await client.query<{ id: string }>(
    `SELECT id FROM order_fulfilments
      WHERE business_id = $1
        AND (invoice_id = $2
             OR ($3::uuid IS NOT NULL AND store_order_id = $3::uuid)
             OR ($4::uuid IS NOT NULL AND sales_order_id = $4::uuid))
      ORDER BY seq DESC, created_at DESC
      LIMIT 1`,
    [businessId, invoiceId, row.store_order_id, row.sales_order_id],
  );
  return {
    invoiceId: row.id,
    branchId: row.branch_id,
    customerId: row.customer_id,
    invoiceNumber: row.invoice_number,
    storeOrderId: row.store_order_id,
    salesOrderId: row.sales_order_id,
    fulfilmentId: f.rows[0]?.id ?? null,
  };
}

export type CreateReturnInput = {
  businessId: string;
  invoiceId: string;
  /** Lines and quantities to return; omitted = everything still returnable. */
  lines?: { invoice_item_id: string; quantity: number }[] | null;
  reason: ReturnReason;
  reasonNote?: string | null;
  initiatedBy: 'merchant' | 'customer' | 'courier';
  userId?: string | null;
  fulfilmentId?: string | null;
};

/**
 * Opens a return. Merchant and courier returns start approved (the shop already agreed);
 * buyer requests start as requested.
 */
export async function createReturn(client: PoolClient, input: CreateReturnInput): Promise<string> {
  const links = await loadInvoiceLinks(client, input.businessId, input.invoiceId);
  if (!links.customerId) {
    throw new ReturnError(409, 'CUSTOMER_REQUIRED', 'This bill has no customer. Add the customer to the bill before a return.');
  }
  const available = await returnableLines(client, input.businessId, input.invoiceId);
  const byId = new Map(available.map((l) => [l.invoice_item_id, l]));

  const wanted: { line: ReturnableLine; qty: number }[] = [];
  if (input.lines && input.lines.length > 0) {
    const merged = new Map<string, number>();
    for (const l of input.lines) {
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      merged.set(l.invoice_item_id, (merged.get(l.invoice_item_id) ?? 0) + qty);
    }
    for (const [id, qty] of merged) {
      const line = byId.get(id);
      if (!line) throw new ReturnError(400, 'LINE_NOT_ON_BILL', 'A returned line is not on this bill');
      if (qty > line.returnable_qty + 1e-9) {
        throw new ReturnError(
          400,
          'EXCEEDS_RETURNABLE',
          `${line.item_name}: only ${line.returnable_qty} can be returned`,
        );
      }
      wanted.push({ line, qty });
    }
  } else {
    for (const line of available) if (line.returnable_qty > 0) wanted.push({ line, qty: line.returnable_qty });
  }
  if (wanted.length === 0) {
    throw new ReturnError(409, 'NOTHING_TO_RETURN', 'Everything on this bill is already returned');
  }

  const status: ReturnStatus = input.initiatedBy === 'customer' ? 'requested' : 'approved';
  const number = await nextReturnNumber(client, input.businessId);
  const created = await client.query<{ id: string }>(
    `INSERT INTO order_returns
       (business_id, branch_id, return_number, invoice_id, customer_id, fulfilment_id, store_order_id, sales_order_id,
        status, initiated_by, reason, reason_note, approved_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::varchar,$10,$11,$12, CASE WHEN $9::varchar = 'approved' THEN NOW() END, $13)
     RETURNING id`,
    [
      input.businessId,
      links.branchId,
      number,
      links.invoiceId,
      links.customerId,
      input.fulfilmentId ?? links.fulfilmentId,
      links.storeOrderId,
      links.salesOrderId,
      status,
      input.initiatedBy,
      input.reason,
      input.reasonNote?.trim().slice(0, 1000) || null,
      input.userId ?? null,
    ],
  );
  const returnId = created.rows[0].id;
  let i = 0;
  for (const { line, qty } of wanted) {
    await client.query(
      `INSERT INTO order_return_items
         (return_id, invoice_item_id, item_id, variant_id, item_name, unit, quantity, unit_price, tax_rate, sort_order, unit_factor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [returnId, line.invoice_item_id, line.item_id, line.variant_id, line.item_name, line.unit, qty, line.unit_price, line.tax_rate, i++, line.unit_factor],
    );
  }
  return returnId;
}

type ReturnRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  return_number: string;
  invoice_id: string;
  customer_id: string | null;
  fulfilment_id: string | null;
  status: ReturnStatus;
  reason: ReturnReason;
  credit_note_id: string | null;
};

async function lockReturn(client: PoolClient, businessId: string, returnId: string): Promise<ReturnRow> {
  const r = await client.query<ReturnRow>(
    `SELECT id, business_id, branch_id, return_number, invoice_id, customer_id, fulfilment_id, status, reason, credit_note_id
       FROM order_returns WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [returnId, businessId],
  );
  if (!r.rows[0]) throw new ReturnError(404, 'RETURN_NOT_FOUND', 'Return not found');
  return r.rows[0];
}

export async function approveReturn(client: PoolClient, p: { businessId: string; returnId: string }): Promise<void> {
  const row = await lockReturn(client, p.businessId, p.returnId);
  if (row.status !== 'requested') throw new ReturnError(409, 'INVALID_STATUS', `This return is already ${row.status}`);
  await client.query(
    `UPDATE order_returns SET status = 'approved', approved_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [row.id],
  );
}

export async function rejectReturn(
  client: PoolClient,
  p: { businessId: string; returnId: string; reason?: string | null },
): Promise<void> {
  const row = await lockReturn(client, p.businessId, p.returnId);
  if (row.status !== 'requested' && row.status !== 'approved') {
    throw new ReturnError(409, 'INVALID_STATUS', `A ${row.status} return cannot be rejected`);
  }
  await client.query(
    `UPDATE order_returns SET status = 'rejected', rejected_reason = $2, closed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [row.id, p.reason?.trim().slice(0, 500) || null],
  );
}

export async function cancelReturn(client: PoolClient, p: { businessId: string; returnId: string }): Promise<void> {
  const row = await lockReturn(client, p.businessId, p.returnId);
  if (row.status !== 'requested' && row.status !== 'approved') {
    throw new ReturnError(409, 'INVALID_STATUS', 'Only a return that has not been received can be cancelled');
  }
  await client.query(`UPDATE order_returns SET status = 'cancelled', closed_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
}

export type RefundChoice = {
  method: ReturnRefundMethod;
  amount?: number | null;
  paymentAccountId?: string | null;
  reference?: string | null;
};

export type ReceiveReturnInput = {
  businessId: string;
  returnId: string;
  userId: string;
  /** Per line: what actually came back and its condition. Omitted lines come back in full, restocked. */
  lines?: { id: string; received_qty?: number | null; condition?: ReturnCondition | null }[] | null;
  date?: string | null;
  /** Settle the money in the same step. */
  refund?: RefundChoice | null;
};

export type ReceiveReturnResult = {
  creditNoteId: string;
  creditNoteNumber: string;
  creditAmount: number;
  refundable: number;
  status: ReturnStatus;
};

/** Goods are back: posts the credit note (stock in for restocked lines) and optionally settles the money. */
export async function receiveReturn(client: PoolClient, input: ReceiveReturnInput): Promise<ReceiveReturnResult> {
  const row = await lockReturn(client, input.businessId, input.returnId);
  if (row.status === 'requested') throw new ReturnError(409, 'NOT_APPROVED', 'Approve the return before receiving the goods');
  if (row.status !== 'approved') throw new ReturnError(409, 'INVALID_STATUS', `This return is already ${row.status}`);
  if (!row.customer_id) throw new ReturnError(409, 'CUSTOMER_REQUIRED', 'This return has no customer');

  const items = await client.query<{
    id: string;
    item_id: string | null;
    item_name: string;
    unit: string | null;
    quantity: string;
    unit_price: string;
    tax_rate: string;
  }>(
    `SELECT id, item_id, item_name, unit, quantity::text, unit_price::text, tax_rate::text
       FROM order_return_items WHERE return_id = $1 ORDER BY sort_order, id`,
    [row.id],
  );
  const given = new Map((input.lines ?? []).map((l) => [l.id, l]));
  const creditLines: Parameters<typeof createCreditNoteInTransaction>[1]['items'] = [];
  for (const it of items.rows) {
    const g = given.get(it.id);
    const asked = Number(it.quantity) || 0;
    const got = g?.received_qty == null ? asked : Number(g.received_qty);
    if (!Number.isFinite(got) || got < 0 || got > asked + 1e-9) {
      throw new ReturnError(400, 'INVALID_RECEIVED_QTY', `${it.item_name}: received quantity must be between 0 and ${asked}`);
    }
    const condition: ReturnCondition = g?.condition === 'damaged' ? 'damaged' : 'restock';
    await client.query(`UPDATE order_return_items SET received_qty = $2, condition = $3 WHERE id = $1`, [it.id, got, condition]);
    if (got <= 0) continue;
    creditLines.push({
      item_id: it.item_id,
      item_name: it.item_name,
      description: it.item_name,
      qty: got,
      unit: it.unit || 'PCS',
      unit_price: Number(it.unit_price) || 0,
      tax_rate: Number(it.tax_rate) || 0,
      restock: condition === 'restock',
    });
  }
  if (creditLines.length === 0) throw new ReturnError(400, 'NOTHING_RECEIVED', 'Enter at least one item that came back');

  const date = input.date || today();
  const branchId = row.branch_id;
  const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
  const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
  try {
    await assertGstPeriodNotFiledForDocumentDate(input.businessId, branchId, date, 'save credit note');
    await assertPeriodNotLocked(input.businessId, branchId, date, 'credit note');
  } catch (e) {
    throw new ReturnError(403, 'PERIOD_LOCKED', e instanceof Error ? e.message : 'This period is locked');
  }

  let resolvedBranch = branchId;
  if (!resolvedBranch) {
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    resolvedBranch = await resolveBranchId({ businessId: input.businessId, branchId: null });
  }

  const creditNoteNumber = await (async () => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`credit-note-number:${input.businessId}`]);
    return nextCreditNoteNumber(client, input.businessId);
  })();

  let creditNote: { id: string; grand_total: string };
  try {
    creditNote = await createCreditNoteInTransaction(client, {
      businessId: input.businessId,
      branchId: resolvedBranch!,
      userId: input.userId,
      customerId: row.customer_id,
      invoiceId: row.invoice_id,
      creditNoteNumber,
      creditNoteDate: date,
      reason: `Return ${row.return_number}: ${RETURN_REASON_LABELS[row.reason] ?? row.reason}`,
      items: creditLines,
      notes: `Order return ${row.return_number}`,
    });
  } catch (e) {
    if (e instanceof CreditNoteCreateError) throw new ReturnError(e.status, e.code, e.message);
    throw e;
  }

  const creditAmount = round2(Number(creditNote.grand_total) || 0);
  await client.query(
    `UPDATE order_returns
        SET status = 'received', received_at = NOW(), credit_note_id = $2, credit_amount = $3, updated_at = NOW()
      WHERE id = $1`,
    [row.id, creditNote.id, creditAmount],
  );

  // A return on a bill that was not fully paid first reduces what is due; only the rest is owed back.
  const room = await refundableOnCreditNote(client, input.businessId, creditNote.id);
  const refundable = room?.refundable ?? 0;
  let status: ReturnStatus = 'received';
  if (refundable <= 0.004) {
    await client.query(`UPDATE order_returns SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
    status = 'closed';
  } else if (input.refund) {
    status = await settleReturn(client, {
      businessId: input.businessId,
      returnId: row.id,
      userId: input.userId,
      date,
      ...input.refund,
    });
  }

  await markFulfilmentReturnedIfComplete(client, input.businessId, row, input.userId);

  return { creditNoteId: creditNote.id, creditNoteNumber, creditAmount, refundable, status };
}

/** Pays back (cash / UPI / bank) or keeps the credit for the next bill, then closes the return. */
export async function settleReturn(
  client: PoolClient,
  p: RefundChoice & { businessId: string; returnId: string; userId: string; date?: string | null },
): Promise<ReturnStatus> {
  const row = await lockReturn(client, p.businessId, p.returnId);
  if (row.status !== 'received') throw new ReturnError(409, 'INVALID_STATUS', 'Receive the goods before settling the refund');
  if (!row.credit_note_id) throw new ReturnError(409, 'NO_CREDIT_NOTE', 'This return has no credit note');

  if (p.method === 'store_credit') {
    await client.query(
      `UPDATE order_returns SET refund_method = 'store_credit', status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    return 'closed';
  }

  try {
    const paid = await refundCreditNote(client, {
      businessId: p.businessId,
      userId: p.userId,
      creditNoteId: row.credit_note_id,
      amount: p.amount ?? null,
      mode: p.method,
      paymentAccountId: p.paymentAccountId ?? null,
      date: p.date || today(),
      reference: p.reference ?? null,
      orderReturnId: row.id,
    });
    await client.query(
      `UPDATE order_returns
          SET refund_method = $2,
              refunded_amount = refunded_amount + $3,
              status = CASE WHEN $4::boolean THEN 'closed' ELSE status END,
              closed_at = CASE WHEN $4::boolean THEN NOW() ELSE closed_at END,
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, p.method, paid.amount, paid.fullyRefunded],
    );
    return paid.fullyRefunded ? 'closed' : 'received';
  } catch (e) {
    if (e instanceof CreditNoteRefundError) throw new ReturnError(e.status, e.code, e.message);
    throw e;
  }
}

/** When everything on the bill has come back, the delivery record shows "Returned". */
async function markFulfilmentReturnedIfComplete(
  client: PoolClient,
  businessId: string,
  row: ReturnRow,
  userId: string,
): Promise<void> {
  if (!row.fulfilment_id) return;
  const left = await returnableLines(client, businessId, row.invoice_id);
  if (left.some((l) => l.returnable_qty > 1e-9)) return;
  const f = await client.query<{ status: FulfilmentStatus }>(
    `SELECT status FROM order_fulfilments WHERE id = $1 AND business_id = $2`,
    [row.fulfilment_id, businessId],
  );
  const status = f.rows[0]?.status;
  if (!status || status === 'returned' || status === 'cancelled') return;
  if (status !== 'delivered' && status !== 'shipped' && status !== 'out_for_delivery' && status !== 'delivery_failed') return;
  await transitionFulfilment(client, {
    businessId,
    fulfilmentId: row.fulfilment_id,
    to: 'returned',
    actorType: 'staff',
    actorUserId: userId,
    note: `Return ${row.return_number} received`,
    skipPaymentGate: true,
  });
}

/**
 * A delivery marked "returned" (by staff or the courier) opens a return for whatever is still on
 * the bill, so stock and money are sorted out in the return. No-op when the bill is not final
 * (e.g. a store order whose bill was cancelled) or a return is already open for the parcel.
 */
export async function ensureReturnForReturnedFulfilment(
  client: PoolClient,
  p: { businessId: string; fulfilmentId: string; userId?: string | null; wasDelivered: boolean },
): Promise<string | null> {
  const f = await client.query<{ invoice_id: string | null }>(
    `SELECT COALESCE(
              f.invoice_id,
              (SELECT so.invoice_id FROM store_orders so WHERE so.id = f.store_order_id),
              (SELECT s.converted_invoice_id FROM sales_orders s WHERE s.id = f.sales_order_id)
            ) AS invoice_id
       FROM order_fulfilments f WHERE f.id = $1 AND f.business_id = $2`,
    [p.fulfilmentId, p.businessId],
  );
  const invoiceId = f.rows[0]?.invoice_id;
  if (!invoiceId) return null;
  const inv = await client.query<{ status: string; customer_id: string | null }>(
    `SELECT status, customer_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [invoiceId, p.businessId],
  );
  if (inv.rows[0]?.status !== 'final' || !inv.rows[0]?.customer_id) return null;
  const open = await client.query<{ id: string }>(
    `SELECT id FROM order_returns
      WHERE business_id = $1 AND invoice_id = $2 AND status IN ('requested', 'approved')
      LIMIT 1`,
    [p.businessId, invoiceId],
  );
  if (open.rows[0]) return open.rows[0].id;
  const left = await returnableLines(client, p.businessId, invoiceId);
  if (!left.some((l) => l.returnable_qty > 1e-9)) return null;
  return createReturn(client, {
    businessId: p.businessId,
    invoiceId,
    reason: p.wasDelivered ? 'other' : 'not_delivered',
    initiatedBy: p.wasDelivered ? 'merchant' : 'courier',
    userId: p.userId ?? null,
    fulfilmentId: p.fulfilmentId,
  });
}

export type ReturnListRow = {
  id: string;
  return_number: string;
  status: ReturnStatus;
  initiated_by: string;
  reason: ReturnReason;
  reason_note: string | null;
  invoice_id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  store_order_id: string | null;
  sales_order_id: string | null;
  fulfilment_id: string | null;
  credit_note_id: string | null;
  credit_note_number: string | null;
  credit_amount: string;
  refunded_amount: string;
  refund_method: string | null;
  item_count: number;
  total_qty: string;
  requested_at: string;
  received_at: string | null;
  closed_at: string | null;
};

const LIST_SQL = `
  SELECT r.id, r.return_number, r.status, r.initiated_by, r.reason, r.reason_note,
         r.invoice_id, i.invoice_number, r.customer_id, c.name AS customer_name, c.phone AS customer_phone,
         r.store_order_id, r.sales_order_id, r.fulfilment_id,
         r.credit_note_id, cn.credit_note_number, r.credit_amount::text, r.refunded_amount::text, r.refund_method,
         (SELECT COUNT(*)::int FROM order_return_items ri WHERE ri.return_id = r.id) AS item_count,
         (SELECT COALESCE(SUM(ri.quantity), 0)::text FROM order_return_items ri WHERE ri.return_id = r.id) AS total_qty,
         r.requested_at, r.received_at, r.closed_at
    FROM order_returns r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN credit_notes cn ON cn.id = r.credit_note_id`;

export async function listReturns(
  client: Pick<PoolClient, 'query'>,
  p: {
    businessId: string;
    branchIds: string[] | null;
    status?: ReturnStatus | 'open' | null;
    invoiceId?: string | null;
    limit?: number;
  },
): Promise<ReturnListRow[]> {
  const res = await client.query<ReturnListRow>(
    `${LIST_SQL}
     WHERE r.business_id = $1
       AND ($2::uuid[] IS NULL OR r.branch_id IS NULL OR r.branch_id = ANY($2::uuid[]))
       AND ($3::text IS NULL
            OR ($3 = 'open' AND r.status IN ('requested', 'approved', 'received'))
            OR r.status = $3)
       AND ($4::uuid IS NULL OR r.invoice_id = $4::uuid)
     ORDER BY CASE r.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 WHEN 'received' THEN 2 ELSE 3 END,
              r.requested_at DESC
     LIMIT $5`,
    [p.businessId, p.branchIds, p.status ?? null, p.invoiceId ?? null, Math.min(Math.max(p.limit ?? 100, 1), 500)],
  );
  return res.rows;
}

export async function getReturn(
  client: Pick<PoolClient, 'query'>,
  p: { businessId: string; returnId: string; branchIds: string[] | null },
): Promise<(ReturnListRow & { lines: unknown[]; refunds: unknown[] }) | null> {
  const res = await client.query<ReturnListRow>(
    `${LIST_SQL}
     WHERE r.business_id = $1 AND r.id = $2
       AND ($3::uuid[] IS NULL OR r.branch_id IS NULL OR r.branch_id = ANY($3::uuid[]))`,
    [p.businessId, p.returnId, p.branchIds],
  );
  const row = res.rows[0];
  if (!row) return null;
  const lines = await client.query(
    `SELECT id, invoice_item_id, item_id, variant_id, item_name, unit, quantity::float8 AS quantity,
            received_qty::float8 AS received_qty, condition, unit_price::float8 AS unit_price, tax_rate::float8 AS tax_rate
       FROM order_return_items WHERE return_id = $1 ORDER BY sort_order, id`,
    [row.id],
  );
  const refunds = await client.query(
    `SELECT id, amount::float8 AS amount, refund_date::text AS refund_date, mode, reference, voucher_number
       FROM credit_note_refunds WHERE order_return_id = $1 AND business_id = $2 ORDER BY created_at`,
    [row.id, p.businessId],
  );
  return { ...row, lines: lines.rows, refunds: refunds.rows };
}
