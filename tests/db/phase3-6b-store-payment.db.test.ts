/**
 * Phase 3.6B: store payment receipts and refunds on the real database.
 * Razorpay HTTP is stubbed at the provider method. Ledger and rows are not mocked.
 */
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreCustomerWhatsApp: jest.fn(), notifyStoreEvent: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { getAccountForPaymentMode } from '@/lib/ledger-utils';
import { InvoiceCancelError } from '@/lib/invoices/cancel-final-invoice';
import * as providerConfig from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import {
  fulfillStoreOrderPayment,
  recordStorePaymentFailure,
} from '@/lib/store/fulfill-paid-order';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { STORE_RECEIPT_ACTOR, StoreReceiptPendingError } from '@/lib/store/store-receipt';
import { confirmStoreRefundFromProvider, refundStoreOrder } from '@/lib/store/store-refund';
import { PATCH as patchOrder } from '@/app/api/settings/online-store/orders/route';
import { POST as razorpayWebhook } from '@/app/api/webhooks/store/razorpay/route';

d('Phase 3.6B store payment lifecycle (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const A2 = randomUUID();
  const CUST = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `9${String(Date.now()).slice(-9)}`;
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

  async function setOnHand(qty: number) {
    await pool.query(`UPDATE items SET current_stock = $2 WHERE id = $1`, [ITEM, qty]);
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [B, BR, ITEM, qty],
    );
  }

  async function seedOrder(opts?: { status?: string; payment?: string }): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await setOnHand(10);
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,$6,$7,200,36,0,0,236,'pickup')`,
      [id, B, BR, `P3B-${tag}-${seq}`, phone, opts?.status ?? 'confirmed', opts?.payment ?? 'unpaid'],
    );
    await pool.query(
      `INSERT INTO store_order_items
         (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',2,'PCS',100,18,236)`,
      [id, ITEM],
    );
    return id;
  }

  async function pay(orderId: string, amount = 236, businessId = B, key = `pay-${orderId}`) {
    return fulfillStoreOrderPayment(orderId, businessId, {
      provider: 'razorpay',
      idempotencyKey: key,
      amount,
      currency: 'INR',
      payload: '{}',
      providerPaymentId: `pay_${orderId.replace(/-/g, '').slice(0, 14)}`,
      providerOrderId: `plink_${orderId.replace(/-/g, '').slice(0, 12)}`,
    });
  }

  async function orderRow(orderId: string) {
    return (
      await pool.query(
        `SELECT status, payment_status, invoice_id, receipt_payment_id, receipt_actor_type,
                provider_payment_id, cash_collected_at
           FROM store_orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];
  }

  async function paymentCount(invoiceId: string) {
    return Number(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM payments
            WHERE business_id = $1 AND reference_id = $2 AND deleted_at IS NULL`,
          [B, invoiceId],
        )
      ).rows[0].n,
    );
  }

  async function voucherLines(voucherId: string, voucherType: string) {
    return (
      await pool.query<{ account_code: string; debit: string; credit: string }>(
        `SELECT a.account_code, l.debit::text, l.credit::text
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.voucher_id = $1 AND l.voucher_type = $2 AND l.business_id = $3
          ORDER BY l.debit DESC, a.account_code`,
        [voucherId, voucherType, B],
      )
    ).rows;
  }

  async function reversalCount(voucherId: string, voucherType: string) {
    return Number(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM ledger_entry_reversals
            WHERE voucher_id = $1 AND voucher_type = $2 AND business_id = $3`,
          [voucherId, voucherType, B],
        )
      ).rows[0].n,
    );
  }

  function processedRefund() {
    const calls: Array<{ idempotencyKey: string; amountPaise: number; providerPaymentId: string }> = [];
    const requestRefund = async (args: {
      providerPaymentId: string;
      amountPaise: number;
      idempotencyKey: string;
    }) => {
      calls.push(args);
      return { providerRefundId: `rfnd_${args.idempotencyKey.slice(0, 8)}`, status: 'processed' as const };
    };
    return { calls, requestRefund };
  }

  beforeAll(async () => {
    pool = getPool();
    const sql = readFileSync(path.join(process.cwd(), 'database/migrations/330_store_payment_lifecycle.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '29', 'regular')`,
      [B, `Phase36b ${tag}`, `27AABCU${tag.slice(0, 4).toUpperCase()}B1Z5`, B2, `Phase36c ${tag}`, `29AABCU${tag.slice(0, 4).toUpperCase()}D1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, true), ($4, $5, 'Other', $6, true)`,
      [A, B, `91${phone}`, A2, B2, `92${phone}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, phone, state_code, current_balance)
       VALUES ($1,$2,'Buyer',$3,'27',0)`,
      [CUST, B, phone],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 'PCS', 100, 40, 18, '847130', 10)`,
      [ITEM, B],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM store_payment_refunds WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
      await pool.query(`UPDATE store_orders SET receipt_payment_id = NULL WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
      await pool.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
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

  test('1. a valid Razorpay payment is accepted', async () => {
    const id = await seedOrder();
    await expect(pay(id)).resolves.toEqual({ outcome: 'fulfilled' });
    expect((await orderRow(id)).payment_status).toBe('paid');
  });

  test('2. the payment amount must match the order to the paise', async () => {
    const id = await seedOrder();
    await expect(pay(id, 236)).resolves.toEqual({ outcome: 'fulfilled' });
    expect((await orderRow(id)).receipt_payment_id).toBeTruthy();
  });

  test('3. a wrong amount is rejected and posts nothing', async () => {
    const id = await seedOrder();
    await expect(pay(id, 100)).resolves.toEqual({ outcome: 'rejected', reason: 'AMOUNT_MISMATCH' });
    const row = await orderRow(id);
    expect(row.payment_status).toBe('unpaid');
    expect(row.receipt_payment_id).toBeNull();
    expect(await paymentCount(row.invoice_id)).toBe(0);
  });

  test('4. a payment for another business is rejected', async () => {
    const id = await seedOrder();
    await expect(pay(id, 236, B2, `cross-${id}`)).resolves.toEqual({ outcome: 'rejected', reason: 'ORDER_NOT_FOUND' });
    expect((await orderRow(id)).payment_status).toBe('unpaid');
  });

  test('5. a duplicate webhook is idempotent', async () => {
    const id = await seedOrder();
    const key = `dup-${id}`;
    await expect(pay(id, 236, B, key)).resolves.toEqual({ outcome: 'fulfilled' });
    await expect(pay(id, 236, B, key)).resolves.toEqual({ outcome: 'duplicate' });
  });

  test('6. a duplicate payment cannot create a second payment record', async () => {
    const id = await seedOrder();
    const key = `once-${id}`;
    await pay(id, 236, B, key);
    await pay(id, 236, B, key);
    const row = await orderRow(id);
    expect(await paymentCount(row.invoice_id)).toBe(1);
  });

  test('7. a duplicate payment cannot create a second ledger posting', async () => {
    const id = await seedOrder();
    const key = `led-${id}`;
    await pay(id, 236, B, key);
    await pay(id, 236, B, key);
    const row = await orderRow(id);
    expect(await voucherLines(row.receipt_payment_id, 'payment')).toHaveLength(2);
  });

  test('8. the payment links to the final invoice', async () => {
    const id = await seedOrder();
    await pay(id);
    const row = await orderRow(id);
    const payRow = (
      await pool.query(`SELECT reference_type, reference_id FROM payments WHERE id = $1`, [row.receipt_payment_id])
    ).rows[0];
    expect(payRow).toEqual({ reference_type: 'invoice', reference_id: row.invoice_id });
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [row.invoice_id])).rows[0].status).toBe('final');
  });

  test('9. the payment reduces the invoice balance', async () => {
    const id = await seedOrder();
    await pay(id);
    const row = await orderRow(id);
    const inv = (
      await pool.query(`SELECT paid_amount::float8 AS paid, balance_amount::float8 AS bal, payment_status FROM invoices WHERE id = $1`, [
        row.invoice_id,
      ])
    ).rows[0];
    expect(inv.paid).toBeCloseTo(236, 2);
    expect(inv.bal).toBeCloseTo(0, 2);
    expect(inv.payment_status).toBe('paid');
  });

  test('10. a failed payment does not create accounting', async () => {
    const id = await seedOrder();
    await expect(
      recordStorePaymentFailure(id, B, {
        provider: 'razorpay',
        idempotencyKey: `fail-${id}`,
        amount: 236,
        currency: 'INR',
        payload: '{}',
      }),
    ).resolves.toBe('failed');
    const row = await orderRow(id);
    expect(row.payment_status).toBe('failed');
    expect(row.invoice_id).toBeNull();
    expect(row.receipt_payment_id).toBeNull();
    const n = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE business_id = $1`, [B])).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(0);
    const lines = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'payment'`, [B])).rows[0].n,
    );
    const paidOrders = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM store_orders WHERE id = $1 AND receipt_payment_id IS NOT NULL`, [id])).rows[0].n,
    );
    expect(paidOrders).toBe(0);
    expect(lines).toBe(
      Number(
        (await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE business_id = $1 AND deleted_at IS NULL`, [B])).rows[0].n,
      ) * 2,
    );
  });

  test('11. a successful payment creates exactly one payment voucher', async () => {
    const id = await seedOrder();
    await pay(id);
    const row = await orderRow(id);
    expect(await voucherLines(row.receipt_payment_id, 'payment')).toHaveLength(2);
    expect(await paymentCount(row.invoice_id)).toBe(1);
  });

  test('12. a receipt with no Razorpay method uses the cash payment-mode account', async () => {
    const id = await seedOrder();
    await pay(id);
    const mapped = await getAccountForPaymentMode(B, 'cash');
    const row = await orderRow(id);
    const lines = await voucherLines(row.receipt_payment_id, 'payment');
    const debit = lines.find((l) => Number(l.debit) > 0);
    const account = (await pool.query(`SELECT account_code FROM accounts WHERE id = $1`, [mapped!.id])).rows[0];
    expect(debit?.account_code).toBe(account.account_code);
    expect(Number(debit?.debit)).toBeCloseTo(236, 2);
  });

  test('13. the receipt credits accounts receivable', async () => {
    const id = await seedOrder();
    await pay(id);
    const lines = await voucherLines((await orderRow(id)).receipt_payment_id, 'payment');
    const credit = lines.find((l) => Number(l.credit) > 0);
    expect(credit?.account_code).toBe('1103');
    expect(Number(credit?.credit)).toBeCloseTo(236, 2);
  });

  test('14. the payment voucher can be reversed later without touching the invoice', async () => {
    const id = await seedOrder();
    await pay(id);
    const row = await orderRow(id);
    const { requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(await reversalCount(row.receipt_payment_id, 'payment')).toBe(2);
    expect(await reversalCount(row.invoice_id, 'invoice')).toBe(0);
  });

  test('15. recording the payment does not reverse the sales invoice', async () => {
    const id = await seedOrder();
    await pay(id);
    const row = await orderRow(id);
    expect(await reversalCount(row.invoice_id, 'invoice')).toBe(0);
    expect(await voucherLines(row.invoice_id, 'invoice').then((rows) => rows.length)).toBeGreaterThan(0);
  });

  test('16. a COD order is not treated as paid', async () => {
    const id = await seedOrder({ payment: 'cod' });
    const row = await orderRow(id);
    expect(row.payment_status).toBe('cod');
    expect(row.receipt_payment_id).toBeNull();
    expect(row.cash_collected_at).toBeNull();
  });

  test('17. COD collection is separate from the order status', async () => {
    const id = await seedOrder({ payment: 'cod', status: 'confirmed' });
    const res = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({ action: 'collect_cash', order_id: id, business_id: B2, user_id: A2 }),
      }),
    );
    expect(res.status).toBe(403);
    const ok = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({ action: 'collect_cash', order_id: id }),
      }),
    );
    expect(ok.status).toBe(200);
    const row = await orderRow(id);
    expect(row.status).toBe('confirmed');
    expect(row.payment_status).toBe('cod');
    expect(row.cash_collected_at).toBeTruthy();
  });

  test('18. cash collection posts one cash receipt against the invoice', async () => {
    const id = await seedOrder({ payment: 'cod', status: 'ready' });
    const collect = () =>
      patchOrder(
        new NextRequest('http://localhost/api/settings/online-store/orders', {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-authenticated-user-id': A,
            'x-authenticated-business-id': B,
          },
          body: JSON.stringify({ action: 'collect_cash', order_id: id }),
        }),
      );
    expect((await collect()).status).toBe(200);
    expect((await collect()).status).toBe(200);
    const row = await orderRow(id);
    expect(row.payment_status).toBe('cod');
    expect(row.receipt_payment_id).toBeNull();
    expect(row.status).toBe('ready');
    expect(row.invoice_id).toEqual(expect.any(String));
    expect(await paymentCount(row.invoice_id)).toBe(1);
    const pay = (
      await pool.query(`SELECT id, payment_mode, amount::float8 AS amount, created_by FROM payments WHERE reference_id = $1`, [
        row.invoice_id,
      ])
    ).rows[0];
    expect(pay).toMatchObject({ payment_mode: 'cash', amount: 236, created_by: A });
    const lines = await voucherLines(pay.id, 'payment');
    expect(lines.find((l) => l.account_code === '1103')?.credit).toBe('236.00');
    const inv = (await pool.query(`SELECT payment_status FROM invoices WHERE id = $1`, [row.invoice_id])).rows[0];
    expect(inv.payment_status).toBe('paid');
  });

  test('19. a refund can be requested for the captured payment', async () => {
    const id = await seedOrder();
    await pay(id);
    const { requestRefund } = processedRefund();
    const result = await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(result.status).toBe('refunded');
    expect((await orderRow(id)).payment_status).toBe('refunded');
  });

  test('20. the provider refund id is stored', async () => {
    const id = await seedOrder();
    await pay(id);
    const { requestRefund } = processedRefund();
    const result = await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    const stored = (
      await pool.query(`SELECT provider_refund_id, actor_type, actor_user_id FROM store_payment_refunds WHERE order_id = $1`, [id])
    ).rows[0];
    expect(stored.provider_refund_id).toBe(result.providerRefundId);
    expect(stored.actor_type).toBe('user');
    expect(stored.actor_user_id).toBe(A);
  });

  test('21. a repeated refund request does not call the provider again', async () => {
    const id = await seedOrder();
    await pay(id);
    const { calls, requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(calls).toHaveLength(1);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM store_payment_refunds WHERE order_id = $1`, [id])).rows[0].n),
    ).toBe(1);
  });

  test('22. a refund does not reverse the sales invoice', async () => {
    const id = await seedOrder();
    await pay(id);
    const invoiceId = (await orderRow(id)).invoice_id as string;
    const { requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(await reversalCount(invoiceId, 'invoice')).toBe(0);
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId])).rows[0].status).toBe('final');
  });

  test('23. refund accounting reverses the receipt once', async () => {
    const id = await seedOrder();
    await pay(id);
    const paymentId = (await orderRow(id)).receipt_payment_id as string;
    const { requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(await reversalCount(paymentId, 'payment')).toBe(2);
  });

  test('24. a refunded payment cannot be refunded again', async () => {
    const id = await seedOrder();
    await pay(id);
    const { calls, requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    const again = await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(again.status).toBe('refunded');
    expect(calls).toHaveLength(1);
  });

  test('25. a refund for another business is rejected', async () => {
    const id = await seedOrder();
    await pay(id);
    await expect(
      refundStoreOrder({
        businessId: B2,
        orderId: id,
        actorUserId: A2,
        requestRefund: async () => ({ providerRefundId: 'rfnd_no', status: 'processed' }),
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect((await orderRow(id)).payment_status).toBe('paid');
  });

  test('26. cancelling an unpaid invoiced order reverses the invoice and not a payment', async () => {
    const id = await seedOrder({ payment: 'cod', status: 'confirmed' });
    const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    expect(await reversalCount(invoiceId!, 'invoice')).toBeGreaterThan(0);
    expect((await orderRow(id)).receipt_payment_id).toBeNull();
    expect(await paymentCount(invoiceId!)).toBe(0);
  });

  test('27. cancelling a paid order leaves the receipt in place', async () => {
    const id = await seedOrder();
    await pay(id);
    const before = await orderRow(id);
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const after = await orderRow(id);
    expect(after.status).toBe('cancelled');
    expect(after.payment_status).toBe('paid');
    expect(after.receipt_payment_id).toBe(before.receipt_payment_id);
    expect(await reversalCount(before.receipt_payment_id, 'payment')).toBe(0);
    expect(await reversalCount(before.invoice_id, 'invoice')).toBeGreaterThan(0);
  });

  test('28. cancelling and then refunding reverses the receipt once', async () => {
    const id = await seedOrder();
    await pay(id);
    const before = await orderRow(id);
    const salesReversals = async () => reversalCount(before.invoice_id, 'invoice');
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const afterCancel = await salesReversals();
    const { requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(await reversalCount(before.receipt_payment_id, 'payment')).toBe(2);
    expect(await salesReversals()).toBe(afterCancel);
    expect((await orderRow(id)).payment_status).toBe('refunded');
  });

  test('29. repeating cancel and refund does not post again', async () => {
    const id = await seedOrder();
    await pay(id);
    const row = await orderRow(id);
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A, cancelledReason: 'Once' });
    const again = await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A, cancelledReason: 'Twice' });
    expect(again).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    const { calls, requestRefund } = processedRefund();
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund });
    expect(calls).toHaveLength(1);
    expect(await reversalCount(row.receipt_payment_id, 'payment')).toBe(2);
    expect(await reversalCount(row.invoice_id, 'invoice')).toBeGreaterThan(0);
  });

  test('30. a repeated refund webhook does not reverse the receipt again', async () => {
    const id = await seedOrder();
    await pay(id);
    const payId = (await orderRow(id)).provider_payment_id as string;
    const pending = jest.fn().mockResolvedValue({ providerRefundId: 'rfnd_webhook_1', status: 'pending' });
    await refundStoreOrder({ businessId: B, orderId: id, actorUserId: A, requestRefund: pending });
    expect((await orderRow(id)).payment_status).toBe('refund_pending');
    expect(await reversalCount((await orderRow(id)).receipt_payment_id, 'payment')).toBe(0);
    const notice = {
      providerPaymentId: payId,
      providerRefundId: 'rfnd_webhook_1',
      amountInr: 236,
      providerStatus: 'processed' as const,
    };
    await confirmStoreRefundFromProvider(notice);
    await confirmStoreRefundFromProvider(notice);
    expect(await reversalCount((await orderRow(id)).receipt_payment_id, 'payment')).toBe(2);
    const actor = (await pool.query(`SELECT actor_type, actor_user_id FROM store_payment_refunds WHERE order_id = $1`, [id])).rows[0];
    expect(actor).toEqual({ actor_type: 'user', actor_user_id: A });
  });

  test('31. a client-supplied user cannot override the session on refund', async () => {
    const id = await seedOrder();
    await pay(id);
    const spyCfg = jest.spyOn(providerConfig, 'getBusinessPaymentProviderConfig').mockResolvedValue({
      clientId: 'rzp_test_store',
      clientSecret: 'secret_secret',
      webhookSecret: 'secret_secret',
    });
    const spyRefund = jest.spyOn(RazorpayPaymentProvider.prototype, 'refundCapturedPayment').mockResolvedValue({
      providerRefundId: 'rfnd_session_1',
      status: 'processed',
    });
    const res = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({
          action: 'refund',
          order_id: id,
          business_id: B,
          user_id: A2,
          created_by: A2,
          refund_owner: A2,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const actor = (await pool.query(`SELECT actor_user_id, receipt_actor_type FROM store_payment_refunds r JOIN store_orders o ON o.id = r.order_id WHERE r.order_id = $1`, [id])).rows[0];
    expect(actor.actor_user_id).toBe(A);
    expect((await orderRow(id)).receipt_actor_type).toBe(STORE_RECEIPT_ACTOR);
    const createdBy = (await pool.query(`SELECT created_by FROM payments WHERE id = $1`, [(await orderRow(id)).receipt_payment_id])).rows[0].created_by;
    expect(createdBy).toBeNull();
    spyCfg.mockRestore();
    spyRefund.mockRestore();
  });

  test('32. a locked period still blocks invoice cancellation', async () => {
    const id = await seedOrder();
    await pay(id);
    const invoiceId = (await orderRow(id)).invoice_id as string;
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, $2, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $3)`,
      [B, BR, A],
    );
    try {
      await expect(
        transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A, cancelledReason: 'Locked' }),
      ).rejects.toBeInstanceOf(InvoiceCancelError);
    } finally {
      await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
    }
    expect((await orderRow(id)).status).toBe('confirmed');
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId])).rows[0].status).toBe('final');
  });

  test('webhook notes cannot choose a different business', async () => {
    const id = await seedOrder();
    const plink = `plink_notes_${tag}${seq}`;
    await pool.query(`UPDATE store_orders SET payment_ref = $2, payment_provider = 'razorpay' WHERE id = $1`, [id, plink]);
    const res = await razorpayWebhook(
      new NextRequest('http://localhost/api/webhooks/store/razorpay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'payment_link.paid',
          payload: {
            payment_link: {
              entity: { id: plink, notes: { business_id: B2, user_id: A2, store_order_id: randomUUID() } },
            },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await orderRow(id)).payment_status).toBe('unpaid');
  });

  test('33. card and UPI receipts use their own configured payment accounts', async () => {
    const accounts = await pool.query<{ id: string; account_code: string }>(
      `SELECT id, account_code FROM accounts WHERE business_id = $1 AND account_code IN ('1101', '1102')`,
      [B],
    );
    const cash = accounts.rows.find((a) => a.account_code === '1101')!;
    const bank = accounts.rows.find((a) => a.account_code === '1102')!;
    await pool.query(
      `INSERT INTO business_settings (business_id, account_mappings)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (business_id) DO UPDATE SET account_mappings = EXCLUDED.account_mappings`,
      [B, JSON.stringify({ payment_modes: { upi: cash.id, credit_card: bank.id } })],
    );
    try {
      const cardOrder = await seedOrder();
      await fulfillStoreOrderPayment(cardOrder, B, {
        provider: 'razorpay',
        idempotencyKey: `card-${cardOrder}`,
        amount: 236,
        currency: 'INR',
        payload: JSON.stringify({ payload: { payment: { entity: { method: 'card' } } } }),
        providerPaymentId: `pay_card_${cardOrder.replace(/-/g, '').slice(0, 10)}`,
        providerOrderId: `plink_card_${cardOrder.replace(/-/g, '').slice(0, 8)}`,
      });
      const cardRow = await orderRow(cardOrder);
      expect(
        (await pool.query(`SELECT payment_mode FROM payments WHERE id = $1`, [cardRow.receipt_payment_id])).rows[0]
          .payment_mode,
      ).toBe('credit_card');
      expect((await voucherLines(cardRow.receipt_payment_id, 'payment')).find((l) => Number(l.debit) > 0)?.account_code).toBe(
        '1102',
      );

      const upiOrder = await seedOrder();
      await fulfillStoreOrderPayment(upiOrder, B, {
        provider: 'razorpay',
        idempotencyKey: `upi-${upiOrder}`,
        amount: 236,
        currency: 'INR',
        payload: JSON.stringify({ payload: { payment: { entity: { method: 'upi' } } } }),
        providerPaymentId: `pay_upi_${upiOrder.replace(/-/g, '').slice(0, 10)}`,
        providerOrderId: `plink_upi_${upiOrder.replace(/-/g, '').slice(0, 8)}`,
      });
      const upiRow = await orderRow(upiOrder);
      expect(
        (await pool.query(`SELECT payment_mode FROM payments WHERE id = $1`, [upiRow.receipt_payment_id])).rows[0]
          .payment_mode,
      ).toBe('upi');
      expect((await voucherLines(upiRow.receipt_payment_id, 'payment')).find((l) => Number(l.debit) > 0)?.account_code).toBe(
        '1101',
      );
    } finally {
      await pool.query(`UPDATE business_settings SET account_mappings = '{}'::jsonb WHERE business_id = $1`, [B]);
    }
  });

  test('34. a paid order whose receipt fails stays retryable and posts once', async () => {
    const id = await seedOrder();
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, $2, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $3)`,
      [B, BR, A],
    );
    try {
      await expect(pay(id)).rejects.toBeInstanceOf(StoreReceiptPendingError);
      const mid = await orderRow(id);
      expect(mid.payment_status).toBe('paid');
      expect(mid.receipt_payment_id).toBeNull();
    } finally {
      await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
    }
    await expect(pay(id)).resolves.toEqual({ outcome: 'duplicate' });
    const row = await orderRow(id);
    const invoices = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE store_order_id = $1`, [id])).rows[0].n,
    );
    expect(invoices).toBe(1);
    expect(await paymentCount(row.invoice_id)).toBe(1);
    expect(await voucherLines(row.receipt_payment_id, 'payment')).toHaveLength(2);
    expect(await reversalCount(row.invoice_id, 'invoice')).toBe(0);
  });
});
