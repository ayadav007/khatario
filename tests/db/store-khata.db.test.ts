/**
 * Store khata on a real database (docs/plan/STORE_KHATA.md): Ganesh Traders opens a khata for
 * Sharma ji, who orders from the online store on khata and settles on his day of the month.
 * Checkout rules (allow, warn, approval, block), billing to the khata customer with the
 * settlement due date, no cash to collect, approval and rejection, one payment across bills,
 * statements, overdue reminders, online khata payments and khata requests.
 * Opt-in, disposable DB only:
 *   STORE_KHATA_DB_TEST=1 npx jest tests/db/store-khata.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 444 must be applied there.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.STORE_KHATA_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}
const d = enabled ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
// No online gateway in this fixture: "My khata" is read-only and online payments are applied directly.
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn(
    async (_businessId: string, feature: string) =>
      feature !== jest.requireActual('@/lib/featureKeys').FeatureKeys.PAYMENT_GATEWAY,
  ),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreCustomerWhatsApp: jest.fn(), notifyStoreEvent: jest.fn() }));
jest.mock('@/lib/store/notify-merchant', () => ({ notifyStoreMerchantNewOrder: jest.fn() }));
jest.mock('@/lib/fulfilment/notify-trigger', () => ({ triggerFulfilmentNotification: jest.fn() }));
jest.mock('@/lib/khata/notify', () => ({
  notifyMerchantKhataRequest: jest.fn().mockResolvedValue(undefined),
  notifyMerchantKhataApproval: jest.fn().mockResolvedValue(undefined),
  notifyMerchantKhataWarning: jest.fn().mockResolvedValue(undefined),
  notifyCustomerKhataOpened: jest.fn().mockResolvedValue(undefined),
  notifyCustomerKhataOrder: jest.fn().mockResolvedValue(undefined),
  sendKhataStatementMessage: jest.fn().mockResolvedValue({ via: 'qr' }),
  khataLink: jest.fn(() => ''),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { accountOutstandingStoreOrders } from '@/lib/store/fulfill-paid-order';
import { collectStoreOrderCash } from '@/lib/store/store-receipt';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { todayIst } from '@/lib/gst/time-limits';
import { addDays, khataStatementDateFor, khataStatementPeriod } from '@/lib/khata/cycle';
import {
  khataCustomerForShopper,
  khataDueDateForCustomer,
  khataSummary,
  openKhata,
  requestKhataFromStore,
  saveKhataSettings,
  KhataError,
} from '@/lib/khata/service';
import { approveKhataOrder, rejectKhataOrder } from '@/lib/khata/approval';
import { settleKhataPayment } from '@/lib/khata/settle';
import { createKhataStatement, runKhataStatements, sendKhataStatementNow } from '@/lib/khata/statements';
import { applyKhataGatewayPayment } from '@/lib/khata/online-pay';
import * as khataNotify from '@/lib/khata/notify';
import { POST as placeOrder } from '@/app/api/public/store/[subdomain]/orders/route';
import { GET as storeKhata } from '@/app/api/public/store/[subdomain]/khata/route';
import { GET as khataSummaryApi } from '@/app/api/khata/summary/route';

d('store khata (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const OWNER = randomUUID();
  const ITEM = randomUUID();
  const SHARMA = randomUUID();
  const OLDER_SAME_PHONE = randomUUID();
  const SHOPPER = randomUUID();
  const tag = B.slice(0, 8);
  const SUB = `kh-${tag}`;
  const PHONE = `9${Date.now().toString().slice(-9)}`;
  const today = todayIst();
  const dueDate = khataStatementDateFor(today, 5);

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function checkout(qty: number, paymentMethod = 'khata', shopper = SHOPPER, phone = PHONE) {
    const res = await placeOrder(
      new NextRequest(`http://localhost/api/public/store/${SUB}/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(B, shopper)}`,
        },
        body: JSON.stringify({
          payment_method: paymentMethod,
          delivery_mode: 'pickup',
          customer_name: 'Sharma ji',
          customer_phone: phone,
          items: [{ item_id: ITEM, quantity: qty }],
        }),
      }),
      { params: { subdomain: SUB } },
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  const order = async (id: string) => (await pool.query(`SELECT * FROM store_orders WHERE id = $1`, [id])).rows[0];
  const invoice = async (id: string) =>
    (
      await pool.query(
        `SELECT customer_id, due_date::text AS due_date, grand_total::float8 AS grand, balance_amount::float8 AS bal, notes
           FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const balance = async (customerId = SHARMA) =>
    Number((await pool.query(`SELECT current_balance::float8 AS b FROM customers WHERE id = $1`, [customerId])).rows[0].b);
  const orderCount = async () =>
    Number((await pool.query(`SELECT COUNT(*)::int AS n FROM store_orders WHERE business_id = $1`, [B])).rows[0].n);

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000001')`,
      [B, `Ganesh Traders ${tag}`, `27AABCG${tag.slice(0, 4).toUpperCase()}K1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Ganesh', $3, true, true)`,
      [OWNER, B, `91${PHONE.slice(1)}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true`,
      [B, SUB],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type)
       VALUES ($1, $2, 'Atta 5kg', 'PCS', 100, 0, 1000, true, true, 'goods')`,
      [ITEM, B],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 1000)`,
      [B, BR, ITEM],
    );
    // An older customer with the same number written as +91...: COD posting matches the last
    // 10 digits and would pick it; khata must not.
    await pool.query(
      `INSERT INTO customers (id, business_id, branch_id, name, phone, state_code, current_balance, created_at)
       VALUES ($1, $2, $3, 'Old record', $4, '27', 0, CURRENT_TIMESTAMP - INTERVAL '30 days'),
              ($5, $2, $3, 'Sharma ji', $6, '27', 0, CURRENT_TIMESTAMP)`,
      [OLDER_SAME_PHONE, B, BR, `+91${PHONE}`, SHARMA, PHONE],
    );
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Sharma ji')`, [
      SHOPPER,
      B,
      PHONE,
    ]);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', OWNER, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
    } finally {
      await closePool();
    }
  });

  test('1. without an open khata, khata checkout is refused and no order is made', async () => {
    const before = await orderCount();
    const r = await checkout(1);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('KHATA_NOT_OPEN');
    expect(await orderCount()).toBe(before);
  });

  test('2. opening the khata links the store login with the same number', async () => {
    await openKhata(B, SHARMA, { settlementDay: 5, creditLimit: 1000 });
    const link = await pool.query(`SELECT customer_id FROM store_customers WHERE id = $1`, [SHOPPER]);
    expect(link.rows[0].customer_id).toBe(SHARMA);
    expect(khataNotify.notifyCustomerKhataOpened).toHaveBeenCalledTimes(1);
  });

  let firstOrderId = '';
  test('3. a khata order is billed to the khata customer, due on the settlement date, nothing to collect', async () => {
    const r = await checkout(1);
    expect(r.status).toBe(200);
    expect(r.json.khata).toMatchObject({ due_date: dueDate, awaiting_approval: false });
    firstOrderId = r.json.order_id;
    const o = await order(firstOrderId);
    expect(o.payment_status).toBe('cod');
    expect(o.payment_provider).toBe('khata');
    expect(o.khata_customer_id).toBe(SHARMA);
    expect(o.invoice_id).toEqual(expect.any(String));
    const inv = await invoice(o.invoice_id);
    expect(inv.customer_id).toBe(SHARMA);
    expect(inv.due_date).toBe(dueDate);
    expect(inv.bal).toBeCloseTo(100, 2);
    expect(inv.notes).toContain('Khata');
    expect(await balance()).toBeCloseTo(100, 2);
    expect(await balance(OLDER_SAME_PHONE)).toBeCloseTo(0, 2);
    const f = await pool.query(`SELECT cod_amount::float8 AS cod FROM order_fulfilments WHERE store_order_id = $1`, [firstOrderId]);
    expect(f.rows[0]?.cod ?? 0).toBe(0);
    const hub = await pool.query(`SELECT payment_status FROM order_hub WHERE source_type = 'store_order' AND source_id = $1`, [
      firstOrderId,
    ]);
    expect(hub.rows[0].payment_status).toBe('khata');
    expect(khataNotify.notifyCustomerKhataOrder).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'placed' }));
  });

  test('4. marking cash collected is refused for a khata order', async () => {
    await expect(collectStoreOrderCash(firstOrderId, B, OWNER)).rejects.toMatchObject({ code: 'KHATA_ORDER' });
  });

  test('5. a khata pickup order can be confirmed and marked ready', async () => {
    expect((await transitionStoreOrder({ businessId: B, orderId: firstOrderId, to: 'confirmed', actorUserId: OWNER })).ok).toBe(true);
    const ready = await transitionStoreOrder({
      businessId: B,
      orderId: firstOrderId,
      to: 'ready',
      dispatchMode: 'pickup',
      actorUserId: OWNER,
    });
    expect(ready.ok).toBe(true);
  });

  let pendingId = '';
  test('6. over the limit with "ask me": the order waits, is not billed, cannot be confirmed, then approval bills it', async () => {
    const r = await checkout(10); // 100 owed + 1000 > 1000 limit
    expect(r.status).toBe(200);
    expect(r.json.khata.awaiting_approval).toBe(true);
    pendingId = r.json.order_id;
    expect((await order(pendingId)).invoice_id).toBeNull();
    expect((await order(pendingId)).khata_approval_reason).toBe('over_limit');
    expect(khataNotify.notifyMerchantKhataApproval).toHaveBeenCalledWith(expect.objectContaining({ orderId: pendingId }));
    await accountOutstandingStoreOrders(B, OWNER);
    expect((await order(pendingId)).invoice_id).toBeNull();
    const moved = await transitionStoreOrder({ businessId: B, orderId: pendingId, to: 'confirmed', actorUserId: OWNER });
    expect(moved).toMatchObject({ ok: false, code: 'KHATA_APPROVAL_PENDING' });
    const summary = await khataSummary(B, SHARMA);
    expect(summary?.pendingOrders).toBeCloseTo(1000, 2);
    const approved = await approveKhataOrder({ businessId: B, orderId: pendingId, actorUserId: OWNER });
    expect(approved.invoiceError).toBeNull();
    expect((await order(pendingId)).invoice_id).toEqual(expect.any(String));
    expect(await balance()).toBeCloseTo(1100, 2);
  });

  test('7. with "block", an order over the limit is refused and nothing is saved', async () => {
    await saveKhataSettings(B, { overLimitRule: 'block' });
    const before = await orderCount();
    const r = await checkout(1);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('KHATA_BLOCKED');
    expect(await orderCount()).toBe(before);
  });

  test('8. a customer override beats the business rule; rejecting cancels the order', async () => {
    await openKhata(B, SHARMA, { settlementDay: 5, creditLimit: 1000, overLimitRule: 'approval' });
    const r = await checkout(2);
    expect(r.status).toBe(200);
    expect(r.json.khata.awaiting_approval).toBe(true);
    await rejectKhataOrder({ businessId: B, orderId: r.json.order_id, actorUserId: OWNER });
    const o = await order(r.json.order_id);
    expect(o.status).toBe('cancelled');
    expect(o.khata_approval).toBe('rejected');
    expect(o.invoice_id).toBeNull();
    expect((await khataSummary(B, SHARMA))?.pendingOrders).toBe(0);
    expect(khataNotify.notifyCustomerKhataOrder).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'rejected' }));
  });

  test('9. overdue bills use the overdue rule ("allow and tell me")', async () => {
    await openKhata(B, SHARMA, { settlementDay: 5, creditLimit: 0 });
    await saveKhataSettings(B, { overdueRule: 'warn', graceDays: 0 });
    const firstInvoice = (await order(firstOrderId)).invoice_id;
    await pool.query(`UPDATE invoices SET due_date = $2::date WHERE id = $1`, [firstInvoice, addDays(today, -10)]);
    const r = await checkout(1);
    expect(r.status).toBe(200);
    expect(r.json.khata).toMatchObject({ awaiting_approval: false, warning: 'overdue' });
    expect(khataNotify.notifyMerchantKhataWarning).toHaveBeenCalledWith(expect.objectContaining({ reason: 'overdue' }));
  });

  test('10. one payment settles the oldest bills first', async () => {
    const owedBefore = await balance();
    const bills = await pool.query(
      `SELECT id, balance_amount::float8 AS bal FROM invoices WHERE customer_id = $1 AND balance_amount > 0
        ORDER BY due_date ASC NULLS LAST, invoice_date ASC, created_at ASC`,
      [SHARMA],
    );
    expect(bills.rows.length).toBe(3);
    const result = await tx((c) =>
      settleKhataPayment(c, {
        businessId: B,
        customerId: SHARMA,
        amount: 150,
        paymentMode: 'cash',
        createdBy: OWNER,
        reference: `KR-${tag}`,
      }),
    );
    expect(result.allocations.map((a) => a.invoiceId)).toEqual([bills.rows[0].id, bills.rows[1].id]);
    expect(result.allocations.map((a) => a.amount)).toEqual([100, 50]);
    expect(await balance()).toBeCloseTo(owedBefore - 150, 2);
    const first = await invoice(bills.rows[0].id);
    expect(first.bal).toBeCloseTo(0, 2);
  });

  test('11. paying more than the open bills is refused at the counter', async () => {
    await expect(
      tx((c) =>
        settleKhataPayment(c, {
          businessId: B,
          customerId: SHARMA,
          amount: 100000,
          paymentMode: 'cash',
          createdBy: OWNER,
          reference: `KR2-${tag}`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'MORE_THAN_OWED' });
  });

  test('12. the statement is stored and sent once on the settlement day', async () => {
    const send = khataNotify.sendKhataStatementMessage as jest.Mock;
    send.mockClear();
    const first = await runKhataStatements({ today: dueDate, businessId: B });
    expect(first.statements).toBe(1);
    const again = await runKhataStatements({ today: dueDate, businessId: B });
    expect(again.statements).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const st = await pool.query(
      `SELECT closing_due::float8 AS closing, due_date::text AS due FROM khata_statements WHERE customer_id = $1`,
      [SHARMA],
    );
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0].closing).toBeCloseTo(await balance(), 2);
    expect(st.rows[0].due).toBe(dueDate);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: 'statement', amountDue: st.rows[0].closing });
  });

  test('13. an overdue reminder follows after the pay-by date, then waits for the interval', async () => {
    const send = khataNotify.sendKhataStatementMessage as jest.Mock;
    send.mockClear();
    const later = addDays(dueDate, 2);
    await pool.query(
      `UPDATE invoices SET due_date = $2::date WHERE customer_id = $1 AND balance_amount > 0`,
      [SHARMA, dueDate],
    );
    const r1 = await runKhataStatements({ today: later, businessId: B });
    expect(r1.reminders).toBe(1);
    const r2 = await runKhataStatements({ today: later, businessId: B });
    expect(r2.reminders).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: 'overdue' });
  });

  test('14. an online khata payment settles once; a wrong amount is refused', async () => {
    const owed = await balance();
    const kp = (
      await pool.query(
        `INSERT INTO khata_payments (business_id, customer_id, amount, provider, payment_ref)
         VALUES ($1, $2, 50, 'razorpay', $3) RETURNING id`,
        [B, SHARMA, `plink_${tag}`],
      )
    ).rows[0].id;
    const wrong = await applyKhataGatewayPayment({ khataPaymentId: kp, businessId: B, amount: 49, payload: {} });
    expect(wrong).toMatchObject({ outcome: 'rejected', reason: 'AMOUNT_MISMATCH' });
    const payload = { payload: { payment: { entity: { method: 'upi' } } } };
    const ok = await applyKhataGatewayPayment({ khataPaymentId: kp, businessId: B, amount: 50, payload, providerPaymentId: `pay_${tag}` });
    expect(ok).toMatchObject({ outcome: 'settled', settled: 50, advance: 0 });
    const dup = await applyKhataGatewayPayment({ khataPaymentId: kp, businessId: B, amount: 50, payload });
    expect(dup).toEqual({ outcome: 'duplicate' });
    expect(await balance()).toBeCloseTo(owed - 50, 2);
    const row = await pool.query(`SELECT status, provider_payment_id FROM khata_payments WHERE id = $1`, [kp]);
    expect(row.rows[0]).toMatchObject({ status: 'paid', provider_payment_id: `pay_${tag}` });
  });

  test('15. "My khata" shows the balance read-only without a gateway', async () => {
    const res = await storeKhata(
      new NextRequest(`http://localhost/api/public/store/${SUB}/khata`, {
        headers: { cookie: `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(B, SHOPPER)}` },
      }),
      { params: { subdomain: SUB } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.kind).toBe('khata');
    expect(body.khata.balance).toBeCloseTo(await balance(), 2);
    expect(body.pay.online).toBe(false);
    expect(body.bills.length).toBeGreaterThan(0);
    expect(body.statements).toHaveLength(1);
  });

  test('16. a counter bill for a khata customer defaults to the settlement date', async () => {
    expect(await khataDueDateForCustomer(B, SHARMA, today)).toBe(dueDate);
    expect(await khataDueDateForCustomer(B, OLDER_SAME_PHONE, today)).toBeNull();
  });

  test('17. a shopper can ask for a khata; the business is alerted once', async () => {
    const phone2 = `8${Date.now().toString().slice(-9)}`;
    const shopper2 = randomUUID();
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Verma ji')`, [
      shopper2,
      B,
      phone2,
    ]);
    const alert = khataNotify.notifyMerchantKhataRequest as jest.Mock;
    alert.mockClear();
    const first = await requestKhataFromStore({ businessId: B, storeCustomerId: shopper2 });
    expect(first.status).toBe('requested');
    const c = await pool.query(`SELECT name, phone, khata_requested_at, khata_enabled FROM customers WHERE id = $1`, [
      first.customerId,
    ]);
    expect(c.rows[0]).toMatchObject({ name: 'Verma ji', phone: phone2, khata_enabled: false });
    expect(c.rows[0].khata_requested_at).not.toBeNull();
    const again = await requestKhataFromStore({ businessId: B, storeCustomerId: shopper2 });
    expect(again).toEqual({ customerId: first.customerId, status: 'already_requested' });
    expect(alert).toHaveBeenCalledTimes(1);
    await openKhata(B, first.customerId, { settlementDay: 0 });
    const opened = await pool.query(`SELECT khata_requested_at, khata_enabled FROM customers WHERE id = $1`, [first.customerId]);
    expect(opened.rows[0]).toMatchObject({ khata_requested_at: null, khata_enabled: true });
  });

  test('18. a khata opened first links the shopper who signs in later with that number', async () => {
    const phone3 = `7${Date.now().toString().slice(-9)}`;
    const cust3 = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, business_id, branch_id, name, phone, state_code) VALUES ($1, $2, $3, 'Gupta ji', $4, '27')`,
      [cust3, B, BR, phone3],
    );
    await openKhata(B, cust3, { settlementDay: 10 });
    const shopper3 = randomUUID();
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Gupta ji')`, [
      shopper3,
      B,
      phone3,
    ]);
    const found = await khataCustomerForShopper(B, shopper3);
    expect(found?.id).toBe(cust3);
    const link = await pool.query(`SELECT customer_id FROM store_customers WHERE id = $1`, [shopper3]);
    expect(link.rows[0].customer_id).toBe(cust3);
  });

  test('19. invalid settlement days are refused', async () => {
    await expect(openKhata(B, SHARMA, { settlementDay: 31 })).rejects.toBeInstanceOf(KhataError);
  });

  test('20. the dashboard summary counts open khatas and what is owed', async () => {
    const res = await khataSummaryApi(
      new NextRequest('http://localhost/api/khata/summary', {
        headers: { 'x-authenticated-user-id': OWNER, 'x-authenticated-business-id': B },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.open_khatas).toBe(3);
    expect(body.owed).toBeCloseTo(await balance(), 2);
    expect(body.pending_approvals).toBe(0);
  });

  test('21. a statement made mid-cycle covers the cycle so far and is due on the next settlement day', async () => {
    const midCycle = addDays(dueDate, -3);
    const { statement } = await tx((c) =>
      createKhataStatement(c, {
        businessId: B,
        customerId: SHARMA,
        statementDate: midCycle,
        settlementDay: 5,
        graceDays: 2,
        manual: true,
      }),
    );
    expect(statement.period_start).toBe(khataStatementPeriod(dueDate, 5).start);
    expect(statement.period_end).toBe(midCycle);
    expect(statement.due_date).toBe(addDays(dueDate, 2));
    await pool.query(`DELETE FROM khata_statements WHERE id = $1`, [statement.id]);
  });

  test('22. a statement WhatsApp could not deliver is saved but not marked sent', async () => {
    (khataNotify.sendKhataStatementMessage as jest.Mock).mockResolvedValueOnce({ via: null });
    const { statement, sent } = await sendKhataStatementNow(B, SHARMA);
    expect(sent).toBe(false);
    const row = await pool.query(`SELECT sent_at FROM khata_statements WHERE id = $1`, [statement.id]);
    expect(row.rows[0].sent_at).toBeNull();
  });
});
