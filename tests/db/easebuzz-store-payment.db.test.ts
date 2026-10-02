/**
 * Easebuzz store payments on the real database: browser return, webhook, receipts, refunds.
 * Easebuzz HTTP (refund APIs) is stubbed with global.fetch. Ledger and rows are not mocked.
 */
import { readFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
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
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreCustomerWhatsApp: jest.fn() }));
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
import * as providerConfig from '@/lib/payments/business-provider-config';
import { confirmStoreRefundFromProvider, refundStoreOrder } from '@/lib/store/store-refund';
import { POST as returnRoute } from '@/app/api/payments/return/easebuzz/route';
import { POST as webhookRoute } from '@/app/api/payments/webhook/easebuzz/route';

const KEY = 'EBTESTKEY';
const SALT = 'EBTESTSALT';

function sha512(s: string) {
  return createHash('sha512').update(s, 'utf8').digest('hex');
}

function signed(fields: Record<string, string>, salt = SALT): string {
  const f = {
    key: KEY,
    productinfo: 'Store order',
    firstname: 'Buyer',
    email: 'customer@example.com',
    udf1: '',
    udf2: '',
    mode: 'UPI',
    ...fields,
  };
  const hash = sha512(
    [salt, f.status, '', '', '', '', '', '', '', '', f.udf2, f.udf1, f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key].join('|'),
  );
  return new URLSearchParams({ ...f, hash }).toString();
}

function post(target: string, body: string) {
  return new NextRequest(`https://staging.khatario.com${target}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

d('Easebuzz store payment lifecycle (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const CUST = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `8${String(Date.now()).slice(-9)}`;
  let seq = 0;
  const realFetch = global.fetch;

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

  async function seedOrder(): Promise<{ id: string; txnid: string }> {
    const id = randomUUID();
    seq += 1;
    const txnid = `ST-${id.replace(/-/g, '').slice(0, 20)}-${Date.now()}${seq}`.slice(0, 40);
    await pool.query(`UPDATE items SET current_stock = 10 WHERE id = $1`, [ITEM]);
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total,
          delivery_mode, payment_provider, payment_ref)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'confirmed','unpaid',200,36,0,0,236,'pickup','easebuzz',$6)`,
      [id, B, BR, `EB-${tag}-${seq}`, phone, txnid],
    );
    await pool.query(
      `INSERT INTO store_order_items
         (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',2,'PCS',100,18,236)`,
      [id, ITEM],
    );
    return { id, txnid };
  }

  async function orderRow(orderId: string) {
    return (
      await pool.query(
        `SELECT payment_status, payment_provider, provider_payment_id, invoice_id,
                receipt_payment_id, receipt_actor_type
           FROM store_orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];
  }

  async function payViaReturn(order: { id: string; txnid: string }, easepayid: string) {
    return returnRoute(
      post(
        '/api/payments/return/easebuzz',
        signed({ status: 'success', txnid: order.txnid, amount: '236.00', easepayid, udf1: order.id, udf2: B }),
      ),
    );
  }

  beforeAll(async () => {
    pool = getPool();
    for (const f of ['330_store_payment_lifecycle.sql', '344_store_refund_provider_actor.sql']) {
      await pool.query(readFileSync(path.join(process.cwd(), 'database/migrations', f), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '29', 'regular')`,
      [B, `Easebuzz ${tag}`, `27AABCE${tag.slice(0, 4).toUpperCase()}B1Z5`, B2, `Easebuzz2 ${tag}`, `29AABCE${tag.slice(0, 4).toUpperCase()}D1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`,
      [A, B, `91${phone}`],
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
    jest.spyOn(providerConfig, 'getBusinessPaymentProviderConfig').mockImplementation(async (businessId, provider) =>
      businessId === B && provider === 'easebuzz'
        ? { clientId: KEY, clientSecret: SALT, environment: 'sandbox' }
        : null,
    );
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM store_payment_refunds WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
      await pool.query(`UPDATE store_orders SET receipt_payment_id = NULL WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
      await pool.query(`DELETE FROM store_payment_events WHERE business_id = ANY($1::uuid[])`, [[B, B2]]);
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

  test('1. a signed browser return marks the order paid and posts one UPI receipt', async () => {
    const order = await seedOrder();
    const res = await payViaReturn(order, `E${order.id.slice(0, 12)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://staging.khatario.com/pay/complete?status=paid&provider=easebuzz');

    const row = await orderRow(order.id);
    expect(row.payment_status).toBe('paid');
    expect(row.payment_provider).toBe('easebuzz');
    expect(row.provider_payment_id).toBe(`E${order.id.slice(0, 12)}`);
    expect(row.receipt_actor_type).toBe('easebuzz_webhook');
    const pay = await pool.query(`SELECT payment_mode, notes FROM payments WHERE id = $1`, [row.receipt_payment_id]);
    expect(pay.rows[0].payment_mode).toBe('upi');
    expect(pay.rows[0].notes).toContain('Easebuzz');
  });

  test('2. the dashboard webhook for the same payment does not post a second receipt', async () => {
    const order = await seedOrder();
    const easepayid = `E${order.id.slice(0, 12)}`;
    await payViaReturn(order, easepayid);
    const first = (await orderRow(order.id)).receipt_payment_id;

    const res = await webhookRoute(
      post(
        `/api/payments/webhook/easebuzz?business_id=${B}`,
        signed({ status: 'success', txnid: order.txnid, amount: '236.00', easepayid, udf1: order.id, udf2: B }),
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('duplicate');
    const n = await pool.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE business_id = $1 AND reference_id = $2 AND deleted_at IS NULL`,
      [B, (await orderRow(order.id)).invoice_id],
    );
    expect(n.rows[0].n).toBe(1);
    expect((await orderRow(order.id)).receipt_payment_id).toBe(first);
  });

  test('3. a callback signed with the wrong salt is rejected and changes nothing', async () => {
    const order = await seedOrder();
    const res = await webhookRoute(
      post(
        '/api/payments/webhook/easebuzz',
        signed({ status: 'success', txnid: order.txnid, amount: '236.00', easepayid: 'EFORGED', udf1: order.id }, 'WRONG'),
      ),
    );
    expect(res.status).toBe(401);
    expect((await orderRow(order.id)).payment_status).toBe('unpaid');
  });

  test('4. a webhook URL for another business is refused', async () => {
    const order = await seedOrder();
    const res = await webhookRoute(
      post(
        `/api/payments/webhook/easebuzz?business_id=${B2}`,
        signed({ status: 'success', txnid: order.txnid, amount: '236.00', easepayid: 'EX', udf1: order.id }),
      ),
    );
    expect(res.status).toBe(400);
    expect((await orderRow(order.id)).payment_status).toBe('unpaid');
  });

  test('5. a wrong amount is rejected without marking the order paid', async () => {
    const order = await seedOrder();
    const res = await webhookRoute(
      post(
        '/api/payments/webhook/easebuzz',
        signed({ status: 'success', txnid: order.txnid, amount: '1.00', easepayid: `E${order.id.slice(0, 10)}`, udf1: order.id }),
      ),
    );
    expect((await res.json()).outcome).toBe('rejected');
    expect((await orderRow(order.id)).payment_status).toBe('unpaid');
  });

  test('6. a cancelled payment marks the order failed and redirects to the failure page', async () => {
    const order = await seedOrder();
    const res = await returnRoute(
      post(
        '/api/payments/return/easebuzz',
        signed({ status: 'usercancelled', txnid: order.txnid, amount: '236.00', easepayid: 'ECANCEL', udf1: order.id }),
      ),
    );
    expect(res.headers.get('location')).toContain('status=failed');
    expect((await orderRow(order.id)).payment_status).toBe('failed');
  });

  test('7. an admin refund goes to Easebuzz once and settles on a later status check', async () => {
    const order = await seedOrder();
    const easepayid = `E${order.id.slice(0, 12)}`;
    await payViaReturn(order, easepayid);
    const receiptId = (await orderRow(order.id)).receipt_payment_id;

    const calls: string[] = [];
    let refundStatus: string | null = null;
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input);
      calls.push(u);
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.easebuzz_id).toBe(easepayid);
      if (u.endsWith('/refund/v1/retrieve')) {
        const refunds = refundStatus
          ? [{ merchant_refund_id: body.merchant_refund_id, refund_status: refundStatus, refund_amount: '236.0' }]
          : [];
        return new Response(JSON.stringify({ status: true, refunds }), { status: 200 });
      }
      expect(body.refund_amount).toBe('236.00');
      refundStatus = 'queued';
      return new Response(JSON.stringify({ status: true, refund_id: 'R1' }), { status: 200 });
    }) as typeof fetch;

    const first = await refundStoreOrder({ businessId: B, orderId: order.id, actorUserId: A });
    expect(first.status).toBe('pending');
    expect(calls.filter((c) => c.endsWith('/transaction/v2/refund'))).toHaveLength(1);
    expect((await orderRow(order.id)).payment_status).toBe('refund_pending');

    const again = await refundStoreOrder({ businessId: B, orderId: order.id, actorUserId: A });
    expect(again.status).toBe('pending');
    expect(calls.filter((c) => c.endsWith('/transaction/v2/refund'))).toHaveLength(1);

    refundStatus = 'refunded';
    const settled = await refundStoreOrder({ businessId: B, orderId: order.id, actorUserId: A });
    expect(settled.status).toBe('refunded');
    expect(calls.filter((c) => c.endsWith('/transaction/v2/refund'))).toHaveLength(1);

    const r = await pool.query(`SELECT provider, status FROM store_payment_refunds WHERE order_id = $1`, [order.id]);
    expect(r.rows[0]).toEqual({ provider: 'easebuzz', status: 'refunded' });
    expect((await orderRow(order.id)).payment_status).toBe('refunded');
    const rev = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ledger_entry_reversals WHERE voucher_id = $1 AND voucher_type = 'payment'`,
      [receiptId],
    );
    expect(rev.rows[0].n).toBe(2);
  });

  test('8. a provider-confirmed Easebuzz refund records the easebuzz_webhook actor', async () => {
    const order = await seedOrder();
    const easepayid = `E${order.id.slice(0, 12)}`;
    await payViaReturn(order, easepayid);
    const out = await confirmStoreRefundFromProvider({
      provider: 'easebuzz',
      providerPaymentId: easepayid,
      providerRefundId: `refund-${order.id.slice(0, 8)}`,
      amountInr: 236,
      providerStatus: 'processed',
    });
    expect(out.status).toBe('refunded');
    const r = await pool.query(`SELECT provider, actor_type FROM store_payment_refunds WHERE order_id = $1`, [order.id]);
    expect(r.rows[0]).toEqual({ provider: 'easebuzz', actor_type: 'easebuzz_webhook' });
  });

  test('9. a Razorpay refund notice cannot touch an Easebuzz order', async () => {
    const order = await seedOrder();
    const easepayid = `E${order.id.slice(0, 12)}`;
    await payViaReturn(order, easepayid);
    const out = await confirmStoreRefundFromProvider({
      providerPaymentId: easepayid,
      providerRefundId: 'rfnd_spoof00001',
      amountInr: 236,
      providerStatus: 'processed',
    });
    expect(out.status).toBe('ignored');
    expect((await orderRow(order.id)).payment_status).toBe('paid');
  });
});
