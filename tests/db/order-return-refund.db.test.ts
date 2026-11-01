/**
 * Refund to the original payment: a received return on a store order paid online sends the money
 * back through the gateway (a fake requester here) and posts it against the credit note, to the
 * bank account the online payment settled in. Pending refunds wait for the notice or the check.
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
import { createReturn, receiveReturn, settleReturn } from '@/lib/returns/service';
import { listReturnEvents } from '@/lib/returns/events';
import { GatewayRefundError } from '@/lib/payments/gateway-refund-error';
import { StoreRefundError } from '@/lib/store/store-refund';
import {
  applyReturnGatewayRefundResult,
  checkPendingReturnRefunds,
  matchReturnRefundNotice,
  originalRefundRoom,
  refundReturnToOriginalPayment,
  type GatewayRequester,
} from '@/lib/returns/gateway-refund';

d('refund a return to the original payment (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const B2 = randomUUID();
  const A2 = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `6${String(Date.now()).slice(-9)}`;
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
      [id, B, BR, `RF-${tag}-${seq}`, phone, paid ? 'unpaid' : 'cod', paid ? 'razorpay' : null, qty * 100, qty * 18, total],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',$3,'PCS',100,18,$4)`,
      [id, ITEM, qty, total],
    );
    if (paid) {
      const out = await fulfillStoreOrderPayment(id, B, {
        provider: 'razorpay',
        idempotencyKey: `rf-${id}`,
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

  /** A received return of `qty` lines (everything when omitted) on the bill. */
  async function receivedReturn(invoiceId: string, qty?: number): Promise<string> {
    const lines = qty
      ? [
          {
            invoice_item_id: (await pool.query(`SELECT id FROM invoice_items WHERE invoice_id = $1`, [invoiceId])).rows[0].id as string,
            quantity: qty,
          },
        ]
      : null;
    const id = await tx((c) => createReturn(c, { businessId: B, invoiceId, lines, reason: 'wrong_item', initiatedBy: 'merchant', userId: A }));
    await tx((c) => receiveReturn(c, { businessId: B, returnId: id, userId: A }));
    return id;
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

  async function refundRows(returnId: string) {
    return (await pool.query(`SELECT * FROM return_gateway_refunds WHERE order_return_id = $1 ORDER BY created_at`, [returnId])).rows;
  }

  function fakeGateway(status: 'processed' | 'pending', refundId = `rfnd_${randomUUID().slice(0, 8)}`) {
    const calls: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }[] = [];
    const requester: GatewayRequester = async (args) => {
      calls.push(args);
      return { providerRefundId: refundId, status };
    };
    return { requester, calls, refundId };
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `Refunds ${tag}`, `27AABCF${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(`INSERT INTO businesses (id, name, state_code) VALUES ($1, $2, '27')`, [B2, `Other ${tag}`]);
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`, [
      A,
      B,
      `93${phone}`,
    ]);
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Other', $3, true)`, [
      A2,
      B2,
      `92${phone}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 'PCS', 100, 40, 18, '847130', 100)`,
      [ITEM, B],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,100)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = 100`,
      [B, BR, ITEM],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM return_gateway_refunds WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
      await pool.query(`DELETE FROM credit_note_refunds WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM order_returns WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, B2]]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('a processed refund posts a gateway voucher to the payment\'s settlement account and closes the return', async () => {
    const { orderId, invoiceId } = await billedOrder(1, true);
    const balBefore = await customerBalance(invoiceId);
    const id = await receivedReturn(invoiceId);
    expect(await originalRefundRoom(pool, B, id)).toEqual({ allowed: true, max: 118, provider: 'razorpay', reason: null });

    const gw = fakeGateway('processed');
    const out = await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    expect(out).toEqual({ status: 'processed', amount: 118, providerRefundId: gw.refundId });
    expect(gw.calls).toHaveLength(1);
    expect(gw.calls[0].amountPaise).toBe(11800);
    expect(gw.calls[0].providerPaymentId).toBe(`pay_${orderId.slice(0, 12)}`);

    const [row] = await refundRows(id);
    expect(row).toMatchObject({ status: 'processed', provider: 'razorpay', provider_refund_id: gw.refundId, amount: '118.00' });
    expect(gw.calls[0].idempotencyKey).toBe(row.idempotency_key);
    expect(row.idempotency_key).toBe(row.id);

    const cnr = (await pool.query(`SELECT * FROM credit_note_refunds WHERE id = $1`, [row.credit_note_refund_id])).rows[0];
    expect(cnr).toMatchObject({ mode: 'gateway', reference: gw.refundId, order_return_id: id });
    expect(Number(cnr.amount)).toBe(118);

    const settlement = (
      await pool.query(
        `SELECT p.settlement_account_id FROM store_orders o JOIN payments p ON p.id = o.receipt_payment_id WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0].settlement_account_id as string;
    expect(settlement).toBeTruthy();
    const lines = (
      await pool.query(
        `SELECT account_id, debit::float8 AS dr, credit::float8 AS cr, narration FROM ledger_entry_lines
          WHERE voucher_id = $1 AND voucher_type = 'credit_note_refund'`,
        [cnr.id],
      )
    ).rows;
    expect(lines.reduce((s, l) => s + l.dr, 0)).toBe(118);
    expect(lines.reduce((s, l) => s + l.cr, 0)).toBe(118);
    expect(lines.find((l) => l.cr > 0)!.account_id).toBe(settlement);
    expect(lines[0].narration).toMatch(/^Refund on .+ \(GATEWAY\)$/);

    const ret = await returnRow(id);
    expect(ret.status).toBe('closed');
    expect(ret.refund_method).toBe('original_payment');
    expect(ret.refunded_amount).toBe('118.00');
    expect(await customerBalance(invoiceId)).toBeCloseTo(balBefore, 2);
    expect((await pool.query(`SELECT payment_status FROM store_orders WHERE id = $1`, [orderId])).rows[0].payment_status).toBe('refunded');
    expect((await listReturnEvents(pool, B, id)).map((e) => e.kind)).toContain('refunded');
  });

  test('a pending refund waits, and the matching notice completes it once', async () => {
    const { orderId, invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    let earlyMatch: string | null = null;
    const gw = fakeGateway('pending');
    const out = await refundReturnToOriginalPayment({
      businessId: B,
      returnId: id,
      userId: A,
      requestRefund: async (args) => {
        // The notice can arrive before the refund id is saved: it matches the open attempt by amount.
        earlyMatch = await matchReturnRefundNotice({ businessId: B, storeOrderId: orderId, providerRefundId: 'rfnd_early', amountInr: 118 });
        return gw.requester(args);
      },
    });
    expect(out).toEqual({ status: 'pending', amount: 118, providerRefundId: gw.refundId });
    const [row] = await refundRows(id);
    expect(earlyMatch).toBe(row.id);
    expect(row).toMatchObject({ status: 'pending', provider_refund_id: gw.refundId });
    expect((await returnRow(id)).status).toBe('received');
    expect((await listReturnEvents(pool, B, id)).map((e) => e.kind)).toContain('refund_pending');

    // Paying another way while the gateway refund is on its way would pay twice.
    await expect(tx((c) => settleReturn(c, { businessId: B, returnId: id, userId: A, method: 'cash' }))).rejects.toMatchObject({
      status: 409,
      code: 'GATEWAY_REFUND_PENDING',
    });
    // A second click reuses the open attempt and its key.
    const again = fakeGateway('pending', gw.refundId);
    await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, amount: 50, requestRefund: again.requester });
    expect(again.calls[0]).toMatchObject({ idempotencyKey: row.idempotency_key, amountPaise: 11800 });
    expect(await refundRows(id)).toHaveLength(1);

    const matched = await matchReturnRefundNotice({ businessId: B, storeOrderId: orderId, providerRefundId: gw.refundId, amountInr: 118 });
    expect(matched).toBe(row.id);
    for (let i = 0; i < 2; i++) {
      const s = await applyReturnGatewayRefundResult({
        businessId: B,
        refundRowId: matched!,
        providerRefundId: gw.refundId,
        providerStatus: 'processed',
        actor: 'webhook',
      });
      expect(s).toBe('processed');
    }
    expect((await pool.query(`SELECT 1 FROM credit_note_refunds WHERE order_return_id = $1`, [id])).rowCount).toBe(1);
    const ret = await returnRow(id);
    expect(ret.status).toBe('closed');
    expect(ret.refunded_amount).toBe('118.00');
    expect((await listReturnEvents(pool, B, id)).filter((e) => e.kind === 'refunded')).toHaveLength(1);
  });

  test('the refund is capped by what is left online', async () => {
    const { orderId, invoiceId } = await billedOrder(2, true);
    const first = await receivedReturn(invoiceId, 1);
    await refundReturnToOriginalPayment({ businessId: B, returnId: first, userId: A, requestRefund: fakeGateway('processed').requester });
    expect((await pool.query(`SELECT payment_status FROM store_orders WHERE id = $1`, [orderId])).rows[0].payment_status).toBe('paid');

    const second = await receivedReturn(invoiceId, 1);
    expect(await originalRefundRoom(pool, B, second)).toMatchObject({ allowed: true, max: 118 });

    // Another ₹18 already went back online for this order: only ₹100 of the ₹118 note can follow.
    await pool.query(
      `INSERT INTO return_gateway_refunds (business_id, order_return_id, store_order_id, provider, provider_payment_id,
                                           idempotency_key, amount, status)
       VALUES ($1, $2, $3, 'razorpay', 'pay_x', $4, 18, 'processed')`,
      [B, first, orderId, randomUUID()],
    );
    expect(await originalRefundRoom(pool, B, second)).toMatchObject({ allowed: true, max: 100 });
    await expect(
      refundReturnToOriginalPayment({ businessId: B, returnId: second, userId: A, amount: 101, requestRefund: fakeGateway('processed').requester }),
    ).rejects.toMatchObject({ status: 400, code: 'EXCEEDS_MAX', message: 'Only ₹100.00 can go back to the original payment' });

    const gw = fakeGateway('processed');
    const out = await refundReturnToOriginalPayment({ businessId: B, returnId: second, userId: A, requestRefund: gw.requester });
    expect(out.amount).toBe(100);
    expect(gw.calls[0].amountPaise).toBe(10000);
    // The rest of the note can still be paid another way.
    expect((await returnRow(second)).status).toBe('received');
    expect(await originalRefundRoom(pool, B, second)).toMatchObject({ allowed: false, max: 0 });
  });

  test('bad amounts are refused', async () => {
    const { invoiceId } = await billedOrder(11, true);
    const id = await receivedReturn(invoiceId);
    const gw = fakeGateway('processed');
    for (const amount of ['0', -5, 'abc', Number.NaN]) {
      await expect(
        refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, amount, requestRefund: gw.requester }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_AMOUNT' });
    }
    await expect(
      refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, amount: 5000, requestRefund: gw.requester }),
    ).rejects.toMatchObject({ status: 400, code: 'EXCEEDS_MAX', message: 'Only ₹1,298.00 can go back to the original payment' });
    expect(gw.calls).toHaveLength(0);
    expect(await refundRows(id)).toHaveLength(0);

    const out = await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, amount: '1180.555', requestRefund: gw.requester });
    expect(gw.calls[0].amountPaise).toBe(118056);
    expect(out).toMatchObject({ status: 'processed', amount: 1180.56 });
    const ret = await returnRow(id);
    expect(ret.status).toBe('received');
    expect(ret.refunded_amount).toBe('1180.56');
    await expect(
      refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, amount: 200, requestRefund: gw.requester }),
    ).rejects.toMatchObject({ status: 400, code: 'EXCEEDS_MAX', message: 'Only ₹117.44 can go back to the original payment' });
  });

  test('a gateway error marks the attempt failed and a retry makes a new attempt', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const out = await refundReturnToOriginalPayment({
      businessId: B,
      returnId: id,
      userId: A,
      requestRefund: async () => {
        throw new GatewayRefundError('Razorpay refund failed: 400', 400, true);
      },
    });
    expect(out).toEqual({ status: 'failed', amount: 118, providerRefundId: null, error: 'Razorpay refund failed: 400' });
    const [failed] = await refundRows(id);
    expect(failed).toMatchObject({ status: 'failed', failure_reason: 'Razorpay refund failed: 400' });
    expect((await returnRow(id)).status).toBe('received');
    expect((await listReturnEvents(pool, B, id)).map((e) => e.kind)).toContain('refund_failed');
    expect(await originalRefundRoom(pool, B, id)).toMatchObject({ allowed: true, max: 118 });

    const gw = fakeGateway('processed');
    const retry = await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    expect(retry.status).toBe('processed');
    const rows = await refundRows(id);
    expect(rows).toHaveLength(2);
    expect(rows[1].idempotency_key).not.toBe(failed.idempotency_key);
    expect(gw.calls[0].idempotencyKey).toBe(rows[1].idempotency_key);
    expect((await returnRow(id)).status).toBe('closed');
  });

  test('an Easebuzz refusal marks the attempt failed', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const out = await refundReturnToOriginalPayment({
      businessId: B,
      returnId: id,
      userId: A,
      requestRefund: async () => {
        throw new StoreRefundError('Easebuzz declined this refund', 502, 'REFUND_FAILED');
      },
    });
    expect(out).toMatchObject({ status: 'failed', error: 'Easebuzz declined this refund' });
    expect((await refundRows(id))[0].status).toBe('failed');
  });

  test('an unclear gateway error keeps the attempt open and a retry repeats it with the same key', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    for (const err of [new TypeError('fetch failed'), new GatewayRefundError('Razorpay refund failed: 503', 503, false)]) {
      const out = await refundReturnToOriginalPayment({
        businessId: B,
        returnId: id,
        userId: A,
        requestRefund: async () => {
          throw err;
        },
      });
      expect(out).toEqual({ status: 'pending', amount: 118, providerRefundId: null, error: err.message });
      const rows = await refundRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'pending', provider_refund_id: null, failure_reason: err.message });
    }
    const kinds = (await listReturnEvents(pool, B, id)).map((e) => e.kind);
    expect(kinds).not.toContain('refund_failed');
    expect((await returnRow(id)).status).toBe('received');

    const [open] = await refundRows(id);
    const gw = fakeGateway('processed');
    const retry = await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    expect(gw.calls[0]).toMatchObject({ idempotencyKey: open.idempotency_key, amountPaise: 11800 });
    expect(retry.status).toBe('processed');
    const rows = await refundRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'processed', failure_reason: null });
    expect((await returnRow(id)).status).toBe('closed');
  });

  test('two clicks at once refund once', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const keys: string[] = [];
    const slow: GatewayRequester = async (args) => {
      keys.push(args.idempotencyKey);
      await new Promise((r) => setTimeout(r, 150));
      return { providerRefundId: `rfnd_same_${tag}`, status: 'processed' };
    };
    const results = await Promise.allSettled([
      refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: slow }),
      refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: slow }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled' && r.value.status === 'processed')).toBe(true);
    // Every gateway call that happened used the one attempt's key, so the gateway refunds once.
    expect(new Set(keys).size).toBe(1);
    expect(await refundRows(id)).toHaveLength(1);
    expect((await pool.query(`SELECT 1 FROM credit_note_refunds WHERE order_return_id = $1`, [id])).rowCount).toBe(1);
    expect((await returnRow(id)).refunded_amount).toBe('118.00');
  });

  test('a payment that settled in a gateway clearing account is refunded from that account', async () => {
    const { orderId, invoiceId } = await billedOrder(1, true);
    const clearing = (
      await pool.query(
        `INSERT INTO accounts (business_id, account_code, account_name, account_type, nature)
         VALUES ($1, '1199', 'Payment Gateway Clearing', 'asset', 'debit') RETURNING id`,
        [B],
      )
    ).rows[0].id as string;
    await pool.query(
      `UPDATE payments SET settlement_account_id = $2 WHERE id = (SELECT receipt_payment_id FROM store_orders WHERE id = $1)`,
      [orderId, clearing],
    );
    const id = await receivedReturn(invoiceId);
    const out = await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: fakeGateway('processed').requester });
    expect(out.status).toBe('processed');
    const [row] = await refundRows(id);
    const credit = (
      await pool.query(
        `SELECT account_id FROM ledger_entry_lines WHERE voucher_id = $1 AND voucher_type = 'credit_note_refund' AND credit > 0`,
        [row.credit_note_refund_id],
      )
    ).rows[0];
    expect(credit.account_id).toBe(clearing);
  });

  test('COD and manual orders cannot refund to the original payment', async () => {
    const { invoiceId } = await billedOrder(1);
    const id = await receivedReturn(invoiceId);
    // A COD bill not yet paid is settled by the credit note itself; open it as received to reach the check.
    await pool.query(`UPDATE order_returns SET status = 'received', closed_at = NULL WHERE id = $1`, [id]);
    expect(await originalRefundRoom(pool, B, id)).toEqual({ allowed: false, max: 0, provider: null, reason: 'This order was not paid online' });
    await expect(
      refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: fakeGateway('processed').requester }),
    ).rejects.toMatchObject({ status: 409, message: 'This order was not paid online' });

    await pool.query(`UPDATE order_returns SET store_order_id = NULL WHERE id = $1`, [id]);
    expect(await originalRefundRoom(pool, B, id)).toMatchObject({ allowed: false, reason: 'This order was not paid online' });
  });

  test('another business cannot refund this return', async () => {
    const { orderId, invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    expect(await originalRefundRoom(pool, B2, id)).toMatchObject({ allowed: false, max: 0 });
    const gw = fakeGateway('pending');
    await expect(
      refundReturnToOriginalPayment({ businessId: B2, returnId: id, userId: A2, requestRefund: gw.requester }),
    ).rejects.toMatchObject({ status: 404, code: 'RETURN_NOT_FOUND' });
    await expect(
      refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A2, requestRefund: gw.requester }),
    ).rejects.toMatchObject({ status: 403, code: 'ACTOR_MISMATCH' });
    expect(gw.calls).toHaveLength(0);

    await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    const [row] = await refundRows(id);
    expect(await matchReturnRefundNotice({ businessId: B2, storeOrderId: orderId, providerRefundId: gw.refundId, amountInr: 118 })).toBeNull();
    await expect(
      applyReturnGatewayRefundResult({ businessId: B2, refundRowId: row.id, providerRefundId: gw.refundId, providerStatus: 'processed', actor: 'webhook' }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await refundRows(id))[0].status).toBe('pending');
  });

  test('checkPendingReturnRefunds applies a processed status from the gateway', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const gw = fakeGateway('pending', `rfnd_chk_${tag}`);
    await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    const [row] = await refundRows(id);

    const asked: string[] = [];
    const fetchStatus = async (r: { provider_refund_id: string | null; idempotency_key: string }) => {
      asked.push(r.idempotency_key);
      return r.provider_refund_id === gw.refundId ? ('processed' as const) : null;
    };
    // Too fresh: left for the notice.
    await checkPendingReturnRefunds({ fetchStatus });
    expect(asked).not.toContain(row.idempotency_key);

    await pool.query(`UPDATE return_gateway_refunds SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [row.id]);
    const res = await checkPendingReturnRefunds({ fetchStatus });
    expect(asked).toContain(row.idempotency_key);
    expect(res.processed).toBeGreaterThanOrEqual(1);
    expect((await refundRows(id))[0].status).toBe('processed');
    expect((await returnRow(id)).status).toBe('closed');
  });

  test('checkPendingReturnRefunds re-sends a Razorpay attempt that never got a refund id, with the same key', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    // The gateway call never answered (a crash or timeout after the claim committed).
    await refundReturnToOriginalPayment({
      businessId: B,
      returnId: id,
      userId: A,
      requestRefund: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const [row] = await refundRows(id);
    expect(row).toMatchObject({ status: 'pending', provider: 'razorpay', provider_refund_id: null });
    await pool.query(`UPDATE return_gateway_refunds SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [row.id]);

    const sent: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }[] = [];
    const resubmit: GatewayRequester = async (args) => {
      if (args.idempotencyKey !== row.idempotency_key) throw new TypeError('not this test');
      sent.push(args);
      return { providerRefundId: `rfnd_re_${tag}`, status: 'processed' };
    };
    const asked: string[] = [];
    const res = await checkPendingReturnRefunds({
      fetchStatus: async (r) => {
        asked.push(r.idempotency_key);
        return null;
      },
      resubmit,
    });
    expect(sent).toEqual([{ providerPaymentId: row.provider_payment_id, amountPaise: 11800, idempotencyKey: row.idempotency_key }]);
    expect(asked).not.toContain(row.idempotency_key);
    expect(res.processed).toBeGreaterThanOrEqual(1);
    expect((await refundRows(id))[0]).toMatchObject({ status: 'processed', provider_refund_id: `rfnd_re_${tag}` });
    expect((await returnRow(id)).status).toBe('closed');
  });
});
