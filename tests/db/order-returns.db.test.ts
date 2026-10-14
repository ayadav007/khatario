/**
 * Order returns: a return against a final bill posts a credit note through the shared credit-note
 * service, puts restocked goods back (damaged ones are written off), settles money as store credit
 * or a cash refund with its own voucher, and a "returned" delivery opens a return by itself.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createInvoiceForStoreOrder, fulfillStoreOrderPayment } from '@/lib/store/fulfill-paid-order';
import { ensureFulfilment, transitionFulfilment } from '@/lib/fulfilment/service';
import {
  approveReturn,
  createReturn,
  ensureReturnForReturnedFulfilment,
  receiveReturn,
  returnableLines,
  ReturnError,
  settleReturn,
} from '@/lib/returns/service';

d('order returns (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `7${String(Date.now()).slice(-9)}`;
  let seq = 0;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function stock(): Promise<number> {
    return Number((await pool.query(`SELECT current_stock::float8 AS q FROM items WHERE id = $1`, [ITEM])).rows[0].q);
  }

  /** A billed store order for `qty` widgets at ₹100 + 18% GST. `paid` adds a verified gateway payment. */
  async function billedOrder(qty: number, paid = false): Promise<{ orderId: string; invoiceId: string }> {
    const id = randomUUID();
    seq += 1;
    const total = qty * 118;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, payment_provider, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'confirmed',$6,$7,$8,$9,0,0,$10,'delivery')`,
      [id, B, BR, `RT-${tag}-${seq}`, phone, paid ? 'unpaid' : 'cod', paid ? 'razorpay' : null, qty * 100, qty * 18, total],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',$3,'PCS',100,18,$4)`,
      [id, ITEM, qty, total],
    );
    if (paid) {
      // The real gateway path: verified event -> order paid -> bill with its receipt.
      const out = await fulfillStoreOrderPayment(id, B, {
        provider: 'razorpay',
        idempotencyKey: `rt-${id}`,
        amount: total,
        payload: '{}',
        providerPaymentId: `pay_${id.slice(0, 12)}`,
      });
      expect(out.outcome).not.toBe('rejected');
      const inv = (await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id])).rows[0].invoice_id as string;
      return { orderId: id, invoiceId: inv };
    }
    const invoiceId = (await createInvoiceForStoreOrder(id, B, A))!;
    return { orderId: id, invoiceId };
  }

  async function customerBalance(invoiceId: string): Promise<number> {
    const r = await pool.query(
      `SELECT c.current_balance::float8 AS b FROM customers c JOIN invoices i ON i.customer_id = c.id WHERE i.id = $1`,
      [invoiceId],
    );
    return Number(r.rows[0].b);
  }

  async function returnRow(id: string) {
    return (await pool.query(`SELECT * FROM order_returns WHERE id = $1`, [id])).rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `Returns ${tag}`, `27AABCR${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`, [
      A,
      B,
      `94${phone}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 'PCS', 100, 40, 18, '847130', 50)`,
      [ITEM, B],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,50)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = 50`,
      [B, BR, ITEM],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM credit_note_refunds WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM order_returns WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('a restocked return on an unpaid bill credits the bill, puts stock back and closes', async () => {
    const { invoiceId } = await billedOrder(2);
    const before = await stock();
    const balBefore = await customerBalance(invoiceId);
    const [line] = await returnableLines(pool, B, invoiceId);
    expect(line).toMatchObject({ sold_qty: 2, returnable_qty: 2, unit_price: 100, tax_rate: 18 });

    const id = await tx((c) =>
      createReturn(c, { businessId: B, invoiceId, lines: [{ invoice_item_id: line.invoice_item_id, quantity: 1 }], reason: 'size_fit', initiatedBy: 'merchant', userId: A }),
    );
    expect((await returnRow(id)).status).toBe('approved');
    expect((await returnableLines(pool, B, invoiceId))[0].returnable_qty).toBe(1);

    const res = await tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A }));
    expect(res.creditAmount).toBe(118);
    expect(res.refundable).toBe(0);
    expect(res.status).toBe('closed');
    expect(await stock()).toBe(before + 1);
    expect(await customerBalance(invoiceId)).toBeCloseTo(balBefore - 118, 2);
    const inv = (await pool.query(`SELECT balance_amount::float8 AS due FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
    expect(inv.due).toBeCloseTo(118, 2);
  });

  test('damaged goods are credited but not put back on the shelf', async () => {
    const { invoiceId } = await billedOrder(1);
    const before = await stock();
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'damaged', initiatedBy: 'merchant', userId: A }));
    const lineId = (await pool.query(`SELECT id FROM order_return_items WHERE return_id = $1`, [id])).rows[0].id;
    const res = await tx((c) =>
      receiveReturn(c, { businessId: B, returnId: id, userId: A, lines: [{ id: lineId, condition: 'damaged' }] }),
    );
    expect(res.creditAmount).toBe(118);
    expect(await stock()).toBe(before);
    const cogs = await pool.query(
      `SELECT COALESCE(SUM(l.debit), 0)::float8 AS inv_dr
         FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.voucher_id = $1 AND l.voucher_type = 'credit_note' AND a.account_code LIKE '1104%'`,
      [res.creditNoteId],
    );
    expect(cogs.rows[0].inv_dr).toBe(0);
  });

  test('a return cannot ask for more than is left on the bill', async () => {
    const { invoiceId } = await billedOrder(1);
    const [line] = await returnableLines(pool, B, invoiceId);
    await expect(
      tx((c) =>
        createReturn(c, { businessId: B, invoiceId, lines: [{ invoice_item_id: line.invoice_item_id, quantity: 2 }], reason: 'other', initiatedBy: 'merchant' }),
      ),
    ).rejects.toMatchObject({ code: 'EXCEEDS_RETURNABLE' });
  });

  test('a buyer request waits for approval before goods can be received', async () => {
    const { invoiceId } = await billedOrder(1);
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'not_needed', initiatedBy: 'customer' }));
    expect((await returnRow(id)).status).toBe('requested');
    await expect(tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A }))).rejects.toBeInstanceOf(ReturnError);
    await tx((c) => approveReturn(c, { businessId: B, returnId: id }));
    const res = await tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A }));
    expect(res.status).toBe('closed');
  });

  test('on a paid bill the money is paid back in cash with a balanced voucher', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const paidDue = (await pool.query(`SELECT balance_amount::float8 AS due FROM invoices WHERE id = $1`, [invoiceId])).rows[0].due;
    expect(paidDue).toBeCloseTo(0, 2);
    const balBefore = await customerBalance(invoiceId);
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'wrong_item', initiatedBy: 'merchant', userId: A }));
    const res = await tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A }));
    expect(res.status).toBe('received');
    expect(res.refundable).toBe(118);
    expect(await customerBalance(invoiceId)).toBeCloseTo(balBefore - 118, 2);

    const status = await tx((c) => settleReturn(c, { businessId: B, returnId: id, userId: A, method: 'cash' }));
    expect(status).toBe('closed');
    const refund = (await pool.query(`SELECT * FROM credit_note_refunds WHERE order_return_id = $1`, [id])).rows[0];
    expect(Number(refund.amount)).toBe(118);
    const v = (
      await pool.query(
        `SELECT SUM(debit)::float8 AS dr, SUM(credit)::float8 AS cr FROM ledger_entry_lines
          WHERE voucher_id = $1 AND voucher_type = 'credit_note_refund'`,
        [refund.id],
      )
    ).rows[0];
    expect(v.dr).toBe(118);
    expect(v.cr).toBe(118);
    expect(await customerBalance(invoiceId)).toBeCloseTo(balBefore, 2);
    const note = (await pool.query(`SELECT refund_status FROM credit_notes WHERE id = $1`, [res.creditNoteId])).rows[0];
    expect(note.refund_status).toBe('refunded');
    expect((await returnRow(id)).refunded_amount).toBe('118.00');
  });

  test('store credit closes the return and leaves the credit for the next bill', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'size_fit', initiatedBy: 'merchant', userId: A }));
    await tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A, refund: { method: 'store_credit' } }));
    const row = await returnRow(id);
    expect(row.status).toBe('closed');
    expect(row.refund_method).toBe('store_credit');
    expect(await pool.query(`SELECT 1 FROM credit_note_refunds WHERE order_return_id = $1`, [id]).then((r) => r.rowCount)).toBe(0);
  });

  test('a delivery marked returned opens a return for the whole bill, and receiving it completes the parcel', async () => {
    const { orderId, invoiceId } = await billedOrder(3);
    const fulfilmentId = await tx(async (c) => {
      const { row } = await ensureFulfilment(c, {
        businessId: B,
        channel: 'online_store',
        storeOrderId: orderId,
        invoiceId,
        branchId: BR,
        buyerName: 'Buyer',
        buyerPhone: phone,
        status: 'confirmed',
        method: 'own_rider',
        codAmount: 0,
        actorType: 'staff',
        actorUserId: A,
      });
      for (const to of ['packed', 'shipped', 'delivered', 'returned'] as const) {
        const moved = await transitionFulfilment(c, { businessId: B, fulfilmentId: row.id, to, actorType: 'staff', actorUserId: A, skipPaymentGate: true });
        expect(moved.ok).toBe(true);
      }
      return row.id;
    });
    const returnId = await tx((c) => ensureReturnForReturnedFulfilment(c, { businessId: B, fulfilmentId, userId: A, wasDelivered: true }));
    expect(returnId).toBeTruthy();
    const again = await tx((c) => ensureReturnForReturnedFulfilment(c, { businessId: B, fulfilmentId, userId: A, wasDelivered: true }));
    expect(again).toBe(returnId);
    const r = await returnRow(returnId!);
    expect(r).toMatchObject({ status: 'approved', fulfilment_id: fulfilmentId, store_order_id: orderId });
    const qty = (await pool.query(`SELECT SUM(quantity)::float8 AS q FROM order_return_items WHERE return_id = $1`, [returnId])).rows[0].q;
    expect(qty).toBe(3);
  });
});
