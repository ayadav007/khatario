/**
 * Refund to the original payment: a received return on a store order paid online sends the money
 * back through the gateway (a fake requester here) and posts it against the credit note, to the
 * bank account the online payment settled in. Pending refunds wait for the notice or the check.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { createHmac, randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

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
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import { StoreRefundError } from '@/lib/store/store-refund';
import { applyCustomerCredit, listAvailableCustomerCredits } from '@/lib/credit-notes/customer-credit';
import * as providerConfig from '@/lib/payments/business-provider-config';
import * as gatewayRefund from '@/lib/returns/gateway-refund';
import { POST as razorpayWebhook } from '@/app/api/webhooks/store/razorpay/route';
import { PATCH as cancelCreditNote } from '@/app/api/credit-notes/[id]/cancel/route';
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
  async function billedOrder(qty: number, paid = false, buyerPhone = phone): Promise<{ orderId: string; invoiceId: string }> {
    const id = randomUUID();
    seq += 1;
    const total = qty * 118;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, payment_provider, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'confirmed',$6,$7,$8,$9,0,0,$10,'delivery')`,
      [id, B, BR, `RF-${tag}-${seq}`, buyerPhone, paid ? 'unpaid' : 'cod', paid ? 'razorpay' : null, qty * 100, qty * 18, total],
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
      await pool.query(`DELETE FROM store_payment_refunds WHERE business_id = $1`, [B]);
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

  test('a pending refund holds its amount on the credit note, so the credit cannot also be spent on a bill', async () => {
    // A buyer of their own, so no other credit notes are in play.
    const ownPhone = `5${String(Date.now()).slice(-9)}`;
    const { invoiceId } = await billedOrder(1, true, ownPhone);
    const balBefore = await customerBalance(invoiceId);
    const id = await receivedReturn(invoiceId);
    const customerId = (await returnRow(id)).customer_id as string;
    const noteId = (await returnRow(id)).credit_note_id as string;
    const spendable = async () =>
      (await tx((c) => listAvailableCustomerCredits(c, B, customerId))).notes.find((n) => n.id === noteId)?.available ?? 0;
    expect(await spendable()).toBe(118);

    const gw = fakeGateway('pending');
    await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    expect(await spendable()).toBe(0);

    // A new bill for the same customer cannot use the credit that is on its way back to the card.
    const { invoiceId: nextBill } = await billedOrder(1, false, ownPhone);
    expect((await pool.query(`SELECT customer_id FROM invoices WHERE id = $1`, [nextBill])).rows[0].customer_id).toBe(customerId);
    expect((await tx((c) => listAvailableCustomerCredits(c, B, customerId))).available).toBe(0);
    await expect(
      tx((c) => applyCustomerCredit(c, { businessId: B, customerId, invoiceId: nextBill, amount: 118, userId: A })),
    ).rejects.toMatchObject({ code: 'EXCEEDS_CREDIT' });

    // Its own hold does not block the refund it is holding for.
    const [row] = await refundRows(id);
    const s = await applyReturnGatewayRefundResult({
      businessId: B,
      refundRowId: row.id,
      providerRefundId: gw.refundId,
      providerStatus: 'processed',
      actor: 'webhook',
    });
    expect(s).toBe('processed');
    expect(await spendable()).toBe(0);
    expect((await returnRow(id)).status).toBe('closed');
    expect(await customerBalance(invoiceId)).toBeCloseTo(balBefore + 118, 2); // + the unpaid next bill
    const v = (
      await pool.query(
        `SELECT SUM(debit)::float8 AS dr, SUM(credit)::float8 AS cr FROM ledger_entry_lines
          WHERE voucher_id = $1 AND voucher_type = 'credit_note_refund'`,
        [(await refundRows(id))[0].credit_note_refund_id],
      )
    ).rows[0];
    expect(v).toEqual({ dr: 118, cr: 118 });
  });

  test('a refund the gateway made but the books could not post keeps its refund id and is posted by the check later', async () => {
    const { orderId, invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const settlement = (
      await pool.query(
        `SELECT p.settlement_account_id FROM store_orders o JOIN payments p ON p.id = o.receipt_payment_id WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0].settlement_account_id as string;
    let row: Record<string, string>;
    const refundId = `rfnd_post_${tag}`;
    const gw = fakeGateway('processed', refundId);
    try {
      const out = await refundReturnToOriginalPayment({
        businessId: B,
        returnId: id,
        userId: A,
        // The account is closed while the refund is at the gateway (after the claim checked it).
        requestRefund: async (args) => {
          await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [settlement]);
          return gw.requester(args);
        },
      });
      expect(out).toMatchObject({ status: 'pending', amount: 118, providerRefundId: refundId });
      expect(out.error).toMatch(/^Refunded at the gateway; posting failed: /);
      [row] = await refundRows(id);
      expect(row).toMatchObject({ status: 'pending', provider_refund_id: refundId });
      expect(row.failure_reason).toBe(out.error);
      expect((await pool.query(`SELECT 1 FROM credit_note_refunds WHERE order_return_id = $1`, [id])).rowCount).toBe(0);
    } finally {
      await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [settlement]);
    }

    await pool.query(`UPDATE return_gateway_refunds SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [row.id]);
    const looked: string[] = [];
    const resent: string[] = [];
    const res = await checkPendingReturnRefunds({
      fetchStatus: async (r) => {
        if (r.provider_refund_id !== refundId) return null;
        looked.push(r.provider_refund_id);
        return 'processed';
      },
      resubmit: async (args) => {
        resent.push(args.idempotencyKey);
        throw new TypeError('not this test');
      },
    });
    expect(looked).toEqual([refundId]);
    expect(resent).not.toContain(row.idempotency_key);
    expect(res.processed).toBeGreaterThanOrEqual(1);
    expect((await refundRows(id))[0]).toMatchObject({ status: 'processed', provider_refund_id: refundId, failure_reason: null });
    expect((await pool.query(`SELECT 1 FROM credit_note_refunds WHERE order_return_id = $1`, [id])).rowCount).toBe(1);
    expect((await returnRow(id)).status).toBe('closed');
  });

  /** A billed online order paid through Easebuzz instead of Razorpay. */
  async function easebuzzOrder(qty: number): Promise<{ orderId: string; invoiceId: string }> {
    const out = await billedOrder(qty, true);
    await pool.query(`UPDATE store_orders SET payment_provider = 'easebuzz' WHERE id = $1`, [out.orderId]);
    return out;
  }

  test('an Easebuzz refund answered with status false marks the attempt failed, and a retry makes a new attempt', async () => {
    const { invoiceId } = await easebuzzOrder(1);
    const id = await receivedReturn(invoiceId);
    const easebuzz = new EasebuzzPaymentProvider({ clientId: 'EBKEY_RETURNS', clientSecret: 'EBSALT_RETURNS' });
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ status: false, reason: 'Refund not allowed for this transaction' }), { status: 200 }),
    ) as typeof fetch;
    let out: Awaited<ReturnType<typeof refundReturnToOriginalPayment>>;
    try {
      out = await refundReturnToOriginalPayment({
        businessId: B,
        returnId: id,
        userId: A,
        requestRefund: (a) => easebuzz.refundPayment({ easebuzzId: a.providerPaymentId, amountPaise: a.amountPaise, merchantRefundId: a.idempotencyKey }),
      });
    } finally {
      global.fetch = realFetch;
    }
    expect(out).toEqual({ status: 'failed', amount: 118, providerRefundId: null, error: 'Easebuzz refund failed: Refund not allowed for this transaction' });
    const [failed] = await refundRows(id);
    expect(failed).toMatchObject({ status: 'failed', provider: 'easebuzz', provider_refund_id: null });
    expect(await originalRefundRoom(pool, B, id)).toMatchObject({ allowed: true, max: 118, provider: 'easebuzz' });

    const gw = fakeGateway('pending', 'ebz_retry');
    const retry = await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    expect(retry.status).toBe('pending');
    const rows = await refundRows(id);
    expect(rows).toHaveLength(2);
    expect(gw.calls[0].idempotencyKey).toBe(rows[1].idempotency_key);
    expect(rows[1].idempotency_key).not.toBe(failed.idempotency_key);
  });

  test('an Easebuzz attempt whose send never answered is re-sent by the check, with the same key, once Easebuzz has no such refund', async () => {
    const { invoiceId } = await easebuzzOrder(1);
    const id = await receivedReturn(invoiceId);
    const out = await refundReturnToOriginalPayment({
      businessId: B,
      returnId: id,
      userId: A,
      requestRefund: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(out).toMatchObject({ status: 'pending', providerRefundId: null, error: 'fetch failed' });
    const [row] = await refundRows(id);
    expect(row).toMatchObject({ status: 'pending', provider: 'easebuzz', provider_refund_id: null, failure_reason: 'fetch failed' });
    await pool.query(`UPDATE return_gateway_refunds SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [row.id]);

    const sent: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }[] = [];
    const resubmit: GatewayRequester = async (args) => {
      sent.push(args);
      return { providerRefundId: args.idempotencyKey, status: 'processed' };
    };
    // Easebuzz knows the refund and it is still on its way: nothing is sent again.
    await checkPendingReturnRefunds({ businessId: B, returnId: id, fetchStatus: async () => 'pending', resubmit });
    expect(sent).toHaveLength(0);
    expect((await refundRows(id))[0].status).toBe('pending');

    // Easebuzz has no refund under our key: the attempt is sent again with the same key and amount.
    const asked: string[] = [];
    const res = await checkPendingReturnRefunds({
      businessId: B,
      returnId: id,
      fetchStatus: async (r) => {
        asked.push(r.idempotency_key);
        return null;
      },
      resubmit,
    });
    expect(asked).toEqual([row.idempotency_key]);
    expect(sent).toEqual([{ providerPaymentId: row.provider_payment_id, amountPaise: 11800, idempotencyKey: row.idempotency_key }]);
    expect(res).toMatchObject({ checked: 1, processed: 1 });
    expect(await refundRows(id)).toHaveLength(1);
    expect((await refundRows(id))[0]).toMatchObject({ status: 'processed', provider_refund_id: row.idempotency_key, failure_reason: null });
    expect((await returnRow(id)).status).toBe('closed');
  });

  test('the claim takes the credit note lock, so credit being spent on a bill at the same time is never also refunded', async () => {
    const ownPhone = `8${String(Date.now()).slice(-9)}`;
    const { invoiceId } = await billedOrder(1, true, ownPhone);
    const id = await receivedReturn(invoiceId);
    const customerId = (await returnRow(id)).customer_id as string;
    const { invoiceId: nextBill } = await billedOrder(1, false, ownPhone);

    // Staff spend the whole credit on the next bill; that transaction is still open.
    const spender = await pool.connect();
    let released = false;
    try {
      await spender.query('BEGIN');
      await applyCustomerCredit(spender, { businessId: B, customerId, invoiceId: nextBill, amount: 118, userId: A });

      const gw = fakeGateway('processed');
      const refund = refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester }).then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      );
      await new Promise((r) => setTimeout(r, 500));
      // The claim waits for the note instead of reading credit that is being spent.
      expect(gw.calls).toHaveLength(0);

      await spender.query('COMMIT');
      spender.release();
      released = true;
      const res = await refund;
      expect(res.ok).toBe(false);
      expect(!res.ok && res.e).toMatchObject({ status: 409, code: 'CANNOT_REFUND_ORIGINAL' });
      expect(gw.calls).toHaveLength(0);
      expect(await refundRows(id)).toHaveLength(0);
    } finally {
      if (!released) {
        await spender.query('ROLLBACK').catch(() => {});
        spender.release();
      }
    }
  });

  test('with no account to refund from, the claim is refused before the gateway is asked', async () => {
    const { orderId, invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const settlement = (
      await pool.query(
        `SELECT p.settlement_account_id FROM store_orders o JOIN payments p ON p.id = o.receipt_payment_id WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0].settlement_account_id as string;
    await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [settlement]);
    const gw = fakeGateway('processed');
    try {
      await expect(
        refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester }),
      ).rejects.toMatchObject({ status: 409, code: 'NO_SETTLEMENT_ACCOUNT' });
    } finally {
      await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [settlement]);
    }
    expect(gw.calls).toHaveLength(0);
    expect(await refundRows(id)).toHaveLength(0);
  });

  test('a refund confirmed after the staff member who sent it was removed is posted as the business owner', async () => {
    const { invoiceId } = await billedOrder(1, true);
    const id = await receivedReturn(invoiceId);
    const gw = fakeGateway('pending');
    await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
    const [row] = await refundRows(id);
    // What ON DELETE SET NULL leaves behind when that user is deleted.
    await pool.query(`UPDATE return_gateway_refunds SET created_by = NULL WHERE id = $1`, [row.id]);
    const s = await applyReturnGatewayRefundResult({
      businessId: B,
      refundRowId: row.id,
      providerRefundId: gw.refundId,
      providerStatus: 'processed',
      actor: 'webhook',
    });
    expect(s).toBe('processed');
    const cnr = (await pool.query(`SELECT created_by FROM credit_note_refunds WHERE order_return_id = $1`, [id])).rows[0];
    expect(cnr.created_by).toBe(A);
  });

  test('a credit note cannot be cancelled while a refund to the original payment is on its way or done', async () => {
    const cancel = (noteId: string) =>
      cancelCreditNote(
        new NextRequest(`http://localhost/api/credit-notes/${noteId}/cancel`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-authenticated-user-id': A, 'x-authenticated-business-id': B },
          body: JSON.stringify({ reason: 'Raised by mistake' }),
        }),
        { params: { id: noteId } },
      ).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> }));
    const blocked = {
      status: 409,
      body: { error: 'A refund to the original payment is in progress or done on this credit note', code: 'GATEWAY_REFUND_ON_NOTE' },
    };

    // On its way.
    const pending = await receivedReturn((await billedOrder(1, true)).invoiceId);
    await refundReturnToOriginalPayment({ businessId: B, returnId: pending, userId: A, requestRefund: fakeGateway('pending').requester });
    const pendingNote = (await returnRow(pending)).credit_note_id as string;
    expect(await cancel(pendingNote)).toMatchObject(blocked);

    // Done (part of the note, so the note is still active with credit left).
    const { invoiceId } = await billedOrder(2, true);
    const done = await receivedReturn(invoiceId);
    await refundReturnToOriginalPayment({ businessId: B, returnId: done, userId: A, amount: 50, requestRefund: fakeGateway('processed').requester });
    const doneNote = (await returnRow(done)).credit_note_id as string;
    expect(await cancel(doneNote)).toMatchObject(blocked);
    for (const note of [pendingNote, doneNote]) {
      expect((await pool.query(`SELECT status FROM credit_notes WHERE id = $1`, [note])).rows[0].status).toBe('active');
    }

    // A refused attempt moved no money: the note can still be cancelled.
    const refused = await receivedReturn((await billedOrder(1, true)).invoiceId);
    await refundReturnToOriginalPayment({
      businessId: B,
      returnId: refused,
      userId: A,
      requestRefund: async () => {
        throw new GatewayRefundError('Razorpay refund failed: 400', 400, true);
      },
    });
    const refusedNote = (await returnRow(refused)).credit_note_id as string;
    expect((await cancel(refusedNote)).status).toBe(200);
    expect((await pool.query(`SELECT status FROM credit_notes WHERE id = $1`, [refusedNote])).rows[0].status).toBe('cancelled');
  });

  describe('Razorpay refund notices and the pending-refund cron', () => {
    const WEBHOOK_SECRET = `whsec_returns_${tag}`;
    let cfgSpy: jest.SpyInstance;

    beforeAll(() => {
      cfgSpy = jest.spyOn(providerConfig, 'getBusinessPaymentProviderConfig').mockImplementation(async (businessId) =>
        businessId === B ? { clientId: 'rzp_test_returns', clientSecret: 'key_secret_returns', webhookSecret: WEBHOOK_SECRET } : null,
      );
    });
    afterAll(() => cfgSpy.mockRestore());

    function payId(orderId: string): string {
      return `pay_${orderId.slice(0, 12)}`;
    }

    /** A Razorpay refund notice signed with the store's webhook secret, posted to the store webhook. */
    async function notice(event: string, entity: { id: string; payment_id: string; amount: number }) {
      const body = JSON.stringify({ event, payload: { refund: { entity: { entity: 'refund', currency: 'INR', ...entity } } } });
      const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
      const res = await razorpayWebhook(
        new NextRequest('http://localhost/api/webhooks/store/razorpay', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
          body,
        }),
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }

    async function receiptReversals(orderId: string): Promise<number> {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ledger_entry_reversals
          WHERE voucher_type = 'payment' AND business_id = $2
            AND voucher_id = (SELECT receipt_payment_id FROM store_orders WHERE id = $1)`,
        [orderId, B],
      );
      return r.rows[0].n as number;
    }

    async function cancellationRefunds(orderId: string): Promise<number> {
      return (await pool.query(`SELECT 1 FROM store_payment_refunds WHERE order_id = $1`, [orderId])).rowCount ?? 0;
    }

    async function noteRefunds(returnId: string): Promise<number> {
      return (await pool.query(`SELECT 1 FROM credit_note_refunds WHERE order_return_id = $1`, [returnId])).rowCount ?? 0;
    }

    async function paymentStatus(orderId: string): Promise<string> {
      return (await pool.query(`SELECT payment_status FROM store_orders WHERE id = $1`, [orderId])).rows[0].payment_status;
    }

    /** An attempt whose gateway call never answered: pending, no refund id. */
    async function unansweredAttempt(returnId: string) {
      await refundReturnToOriginalPayment({
        businessId: B,
        returnId,
        userId: A,
        requestRefund: async () => {
          throw new TypeError('fetch failed');
        },
      });
      return (await refundRows(returnId)).at(-1)!;
    }

    test('a Razorpay refund.processed notice completes the matching return refund', async () => {
      // No delivery fee: the full return refund equals grand_total, which must not read as a cancellation.
      const { orderId, invoiceId } = await billedOrder(1, true);
      const id = await receivedReturn(invoiceId);
      const gw = fakeGateway('pending');
      await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
      expect(await paymentStatus(orderId)).toBe('paid');

      const res = await notice('refund.processed', { id: gw.refundId, payment_id: payId(orderId), amount: 11800 });
      expect(res.status).toBe(200);
      expect((await refundRows(id))[0]).toMatchObject({ status: 'processed', provider_refund_id: gw.refundId });
      expect((await returnRow(id)).status).toBe('closed');
      expect(await noteRefunds(id)).toBe(1);
      expect(await receiptReversals(orderId)).toBe(0);
      expect(await cancellationRefunds(orderId)).toBe(0);
      expect(await paymentStatus(orderId)).toBe('refunded');
    });

    test('a notice that arrives before the refund id is saved matches by amount', async () => {
      const { orderId, invoiceId } = await billedOrder(1, true);
      const id = await receivedReturn(invoiceId);
      const refundId = `rfnd_early_${tag}`;
      let early: { status: number } | null = null;
      const out = await refundReturnToOriginalPayment({
        businessId: B,
        returnId: id,
        userId: A,
        requestRefund: async () => {
          early = await notice('refund.processed', { id: refundId, payment_id: payId(orderId), amount: 11800 });
          return { providerRefundId: refundId, status: 'pending' };
        },
      });
      expect(early).toMatchObject({ status: 200 });
      expect(out.status).toBe('processed');
      expect((await refundRows(id))[0]).toMatchObject({ status: 'processed', provider_refund_id: refundId });
      expect(await noteRefunds(id)).toBe(1);
      expect(await receiptReversals(orderId)).toBe(0);
      expect(await cancellationRefunds(orderId)).toBe(0);
    });

    test('the same notice twice posts once', async () => {
      // Half the order comes back: the notice amount differs from grand_total.
      const { orderId, invoiceId } = await billedOrder(2, true);
      const id = await receivedReturn(invoiceId, 1);
      const gw = fakeGateway('pending');
      await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
      for (let i = 0; i < 2; i++) {
        const res = await notice('refund.processed', { id: gw.refundId, payment_id: payId(orderId), amount: 11800 });
        expect(res.status).toBe(200);
      }
      expect(await noteRefunds(id)).toBe(1);
      expect((await listReturnEvents(pool, B, id)).filter((e) => e.kind === 'refunded')).toHaveLength(1);
      expect((await returnRow(id)).refunded_amount).toBe('118.00');
      expect(await paymentStatus(orderId)).toBe('paid');
      expect(await cancellationRefunds(orderId)).toBe(0);
    });

    test('a refund.failed notice marks the attempt failed', async () => {
      const { orderId, invoiceId } = await billedOrder(1, true);
      const id = await receivedReturn(invoiceId);
      const gw = fakeGateway('pending');
      await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
      const res = await notice('refund.failed', { id: gw.refundId, payment_id: payId(orderId), amount: 11800 });
      expect(res.status).toBe(200);
      expect((await refundRows(id))[0].status).toBe('failed');
      expect((await returnRow(id)).status).toBe('received');
      expect(await noteRefunds(id)).toBe(0);
      expect(await cancellationRefunds(orderId)).toBe(0);
    });

    test('an unmatched partial refund notice is acknowledged with 200, not retried', async () => {
      const { orderId } = await billedOrder(2, true);
      const res = await notice('refund.processed', { id: `rfnd_partial_${tag}`, payment_id: payId(orderId), amount: 5000 });
      expect(res.status).toBe(200);
      expect(await cancellationRefunds(orderId)).toBe(0);
      expect(await receiptReversals(orderId)).toBe(0);
      expect(await paymentStatus(orderId)).toBe('paid');
    });

    test('an unrelated notice with the same amount does not complete an attempt when two could match', async () => {
      const { orderId, invoiceId } = await billedOrder(2, true);
      const first = await unansweredAttempt(await receivedReturn(invoiceId, 1));
      const second = await unansweredAttempt(await receivedReturn(invoiceId, 1));
      expect([first.amount, second.amount]).toEqual(['118.00', '118.00']);

      expect(await matchReturnRefundNotice({ businessId: B, storeOrderId: orderId, providerRefundId: 'rfnd_unrelated', amountInr: 118 })).toBeNull();
      const res = await notice('refund.processed', { id: `rfnd_unrelated_${tag}`, payment_id: payId(orderId), amount: 11800 });
      expect(res.status).toBe(200);
      for (const row of [first, second]) {
        expect((await pool.query(`SELECT status, provider_refund_id FROM return_gateway_refunds WHERE id = $1`, [row.id])).rows[0]).toEqual({
          status: 'pending',
          provider_refund_id: null,
        });
      }
      expect(await cancellationRefunds(orderId)).toBe(0);
    });

    test('a refund id that belongs to a cancellation refund or another attempt never matches by amount', async () => {
      const { orderId, invoiceId } = await billedOrder(1, true);
      const id = await receivedReturn(invoiceId);
      const open = await unansweredAttempt(id);
      const cancelId = `rfnd_cancel_${tag}`;
      const order = (await pool.query(`SELECT receipt_payment_id, provider_payment_id FROM store_orders WHERE id = $1`, [orderId])).rows[0];
      await pool.query(
        `INSERT INTO store_payment_refunds (business_id, order_id, payment_id, provider, provider_payment_id, provider_refund_id,
                                            idempotency_key, amount, status, actor_type)
         VALUES ($1, $2, $3, 'razorpay', $4, $5, $6, 118, 'pending', 'razorpay_webhook')`,
        [B, orderId, order.receipt_payment_id, order.provider_payment_id, cancelId, randomUUID()],
      );
      expect(await matchReturnRefundNotice({ businessId: B, storeOrderId: orderId, providerRefundId: cancelId, amountInr: 118 })).toBeNull();

      // The id is already another order's return refund.
      const other = await billedOrder(1, true);
      const otherReturn = await receivedReturn(other.invoiceId);
      const otherGw = fakeGateway('processed', `rfnd_other_${tag}`);
      await refundReturnToOriginalPayment({ businessId: B, returnId: otherReturn, userId: A, requestRefund: otherGw.requester });
      expect(await matchReturnRefundNotice({ businessId: B, storeOrderId: orderId, providerRefundId: otherGw.refundId, amountInr: 118 })).toBeNull();

      // A fresh id still matches the one open attempt.
      expect(await matchReturnRefundNotice({ businessId: B, storeOrderId: orderId, providerRefundId: `rfnd_fresh_${tag}`, amountInr: 118 })).toBe(open.id);
    });

    test('a full-amount notice that matches no attempt is not taken for a cancellation while a return refund is open', async () => {
      const { orderId, invoiceId } = await billedOrder(1, true);
      const id = await receivedReturn(invoiceId);
      const gw = fakeGateway('pending');
      await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
      const res = await notice('refund.processed', { id: `rfnd_stray_${tag}`, payment_id: payId(orderId), amount: 11800 });
      expect(res.status).toBe(200);
      expect(await cancellationRefunds(orderId)).toBe(0);
      expect(await receiptReversals(orderId)).toBe(0);
      expect(await paymentStatus(orderId)).toBe('paid');
      expect((await refundRows(id))[0]).toMatchObject({ status: 'pending', provider_refund_id: gw.refundId });
    });

    test('a processed notice whose posting fails is acknowledged and keeps the refund id', async () => {
      const { orderId, invoiceId } = await billedOrder(1, true);
      const id = await receivedReturn(invoiceId);
      const gw = fakeGateway('pending');
      await refundReturnToOriginalPayment({ businessId: B, returnId: id, userId: A, requestRefund: gw.requester });
      const settlement = (
        await pool.query(
          `SELECT p.settlement_account_id FROM store_orders o JOIN payments p ON p.id = o.receipt_payment_id WHERE o.id = $1`,
          [orderId],
        )
      ).rows[0].settlement_account_id as string;
      await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [settlement]);
      const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await notice('refund.processed', { id: gw.refundId, payment_id: payId(orderId), amount: 11800 });
        expect(res.status).toBe(200);
      } finally {
        quiet.mockRestore();
        await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [settlement]);
      }
      const [row] = await refundRows(id);
      expect(row).toMatchObject({ status: 'pending', provider_refund_id: gw.refundId });
      expect(row.failure_reason).toMatch(/^Refunded at the gateway; posting failed: /);
      expect(await noteRefunds(id)).toBe(0);
      expect(await cancellationRefunds(orderId)).toBe(0);
      expect(await receiptReversals(orderId)).toBe(0);
    });

    test('the cron rejects calls without the cron secret', async () => {
      const { GET, POST } = await import('@/app/api/cron/return-refunds/route');
      const saved = process.env.CRON_SECRET;
      process.env.CRON_SECRET = `cron_${tag}`;
      const check = jest.spyOn(gatewayRefund, 'checkPendingReturnRefunds').mockResolvedValue({ checked: 3, processed: 1, failed: 1 });
      try {
        const call = (handler: typeof GET, auth?: string) =>
          handler(new NextRequest('http://localhost/api/cron/return-refunds', { headers: auth ? { authorization: auth } : {} }));
        expect((await call(POST)).status).toBe(401);
        expect((await call(GET, 'Bearer wrong')).status).toBe(401);
        expect(check).not.toHaveBeenCalled();

        for (const handler of [GET, POST]) {
          const res = await call(handler, `Bearer cron_${tag}`);
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({ checked: 3, processed: 1, failed: 1 });
        }
        expect(check).toHaveBeenCalledTimes(2);
      } finally {
        check.mockRestore();
        if (saved === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = saved;
      }
    });
  });
});
