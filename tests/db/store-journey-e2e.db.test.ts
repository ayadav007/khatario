/**
 * Online store end-to-end journey audit (customer pays → merchant fulfils → accounts).
 * Each test asserts the behaviour a merchant expects; a failure is a product defect, recorded in
 * docs/qa/store-journey-audit-results.md. Runs only when PHASE2_TEST_DATABASE_URL points at
 * local kh_phase2_test. Ledger, stock and invoices are real; only WhatsApp is stubbed.
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
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreCustomerWhatsApp: jest.fn(), notifyStoreEvent: jest.fn() }));
jest.mock('@/lib/fulfilment/notify-trigger', () => ({ triggerFulfilmentNotification: jest.fn() }));
// The fixture business has no subscription; plan gating is not what this audit checks.
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { buildStoreQuote } from '@/lib/store/quote';
import { createInvoiceForStoreOrder, fulfillStoreOrderPayment } from '@/lib/store/fulfill-paid-order';
import { collectStoreOrderCash } from '@/lib/store/store-receipt';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { recordRemittance } from '@/lib/fulfilment/cod-remittance';
import { paymentBanner } from '@/lib/fulfilment/shipping-label';

d('Online store journey audit (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const EXCL = randomUUID();
  const INCL = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `8${String(Date.now()).slice(-9)}`;
  let seq = 0;

  async function seedOrder(o: {
    payment: 'cod' | 'paid' | 'unpaid';
    provider?: string | null;
    delivery?: number;
    discount?: number;
    createdAt?: string;
  }): Promise<string> {
    const id = randomUUID();
    seq += 1;
    const delivery = o.delivery ?? 0;
    const discount = o.discount ?? 0;
    const grand = 236 + delivery - discount;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone, customer_address, customer_pincode,
          status, payment_status, payment_provider, subtotal, tax_total, delivery_charge, discount_amount, grand_total,
          delivery_mode, created_at)
       VALUES ($1,$2,$3,$4,'Journey Buyer',$5,'12 MG Road, Pune','411001','pending',$6,$7,200,36,$8,$9,$10,'delivery',
               COALESCE($11::timestamptz, CURRENT_TIMESTAMP))`,
      [id, B, BR, `SJ-${tag}-${seq}`, phone, o.payment, o.provider ?? null, delivery, discount, grand, o.createdAt ?? null],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Journey Widget',2,'PCS',100,18,236)`,
      [id, EXCL],
    );
    return id;
  }

  const order = async (id: string) =>
    (await pool.query(`SELECT * FROM store_orders WHERE id = $1`, [id])).rows[0];
  const invoice = async (id: string) =>
    (
      await pool.query(
        `SELECT invoice_date::text AS invoice_date, grand_total::float8 AS grand, balance_amount::float8 AS bal,
                payment_status, status, customer_id
           FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const fulfilment = async (orderId: string) =>
    (await pool.query(`SELECT * FROM order_fulfilments WHERE store_order_id = $1 ORDER BY seq LIMIT 1`, [orderId])).rows[0];

  async function tryInvoice(id: string): Promise<{ invoiceId: string | null; error: string | null }> {
    try {
      return { invoiceId: await createInvoiceForStoreOrder(id, B, A), error: null };
    } catch (e) {
      return { invoiceId: null, error: `${(e as { code?: string }).code ?? ''} ${(e as Error).message}` };
    }
  }

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== 'kh_phase2_test') throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1,$2,$3,'27','regular')`,
      [B, `StoreJourney ${tag}`, `27AABCS${tag.slice(0, 4).toUpperCase()}J1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B],
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1,$2,'Owner',$3,true)`, [
      A,
      B,
      `97${phone}`,
    ]);
    // Same setup every real business gets: default chart plus the standard Indian heads.
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac,
                          current_stock, show_in_store, gst_included)
       VALUES ($1,$3,'Journey Widget','goods','PCS',100,40,18,'847130',50,true,false),
              ($2,$3,'Journey Inclusive','goods','PCS',118,40,18,'847130',50,true,true)`,
      [EXCL, INCL, B],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,50), ($1,$2,$4,50)`,
      [B, BR, EXCL, INCL],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`UPDATE order_fulfilments SET cod_remittance_id = NULL WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM cod_remittances WHERE business_id = $1`, [B]);
      await pool.query(`UPDATE store_orders SET receipt_payment_id = NULL WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM order_fulfilments WHERE business_id = $1`, [B]).catch(() => {});
      await pool.query(`DELETE FROM store_orders WHERE business_id = $1`, [B]);
      const c: PoolClient = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('J1 COD order, no delivery fee: invoice, stock, ship, deliver, cash collected, invoice settled', async () => {
    const id = await seedOrder({ payment: 'cod' });
    const before = Number((await pool.query(`SELECT current_stock FROM items WHERE id = $1`, [EXCL])).rows[0].current_stock);
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    const after = Number((await pool.query(`SELECT current_stock FROM items WHERE id = $1`, [EXCL])).rows[0].current_stock);
    expect(before - after).toBe(2);
    const i = await invoice(inv.invoiceId!);
    expect(i.grand).toBeCloseTo(236, 2);
    expect(i.customer_id).toBeTruthy();

    expect((await transitionStoreOrder({ businessId: B, orderId: id, to: 'confirmed', actorUserId: A })).ok).toBe(true);
    expect(
      (await transitionStoreOrder({ businessId: B, orderId: id, to: 'ready', dispatchMode: 'self', actorUserId: A })).ok,
    ).toBe(true);
    const f = await fulfilment(id);
    expect(f.status).toBe('shipped');
    expect(Number(f.cod_amount)).toBeCloseTo(236, 2);
    expect((await transitionStoreOrder({ businessId: B, orderId: id, to: 'delivered', actorUserId: A })).ok).toBe(true);

    await collectStoreOrderCash(id, B, A);
    const paid = await invoice(inv.invoiceId!);
    expect(paid.bal).toBeCloseTo(0, 2);
  });

  test('J2 COD order with a ₹40 delivery fee is invoiced (sale reaches the accounts)', async () => {
    const id = await seedOrder({ payment: 'cod', delivery: 40 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect((await invoice(inv.invoiceId!)).grand).toBeCloseTo(276, 2);
  });

  test('J3 COD order with a ₹20 coupon discount is invoiced', async () => {
    const id = await seedOrder({ payment: 'cod', discount: 20 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect((await invoice(inv.invoiceId!)).grand).toBeCloseTo(216, 2);
  });

  test('J4 cart with one GST-inclusive and one GST-exclusive item is priced correctly', async () => {
    const q = await buildStoreQuote({
      businessId: B,
      minOrderAmount: 0,
      items: [
        { item_id: EXCL, quantity: 1 },
        { item_id: INCL, quantity: 1 },
      ],
      deliveryMode: 'pickup',
    });
    expect(q.serviceable).toBe(true);
    // ₹100 + 18% = ₹118, plus ₹118 GST-inclusive = ₹236.
    expect(q.grand_total).toBeCloseTo(236, 2);
  });

  test('J5 online (UPI via gateway) payment posts a receipt on a business with the standard chart', async () => {
    const id = await seedOrder({ payment: 'unpaid' });
    let error: string | null = null;
    try {
      await fulfillStoreOrderPayment(id, B, {
        provider: 'razorpay',
        idempotencyKey: `sj-upi-${id}`,
        amount: 236,
        currency: 'INR',
        payload: JSON.stringify({ payload: { payment: { entity: { method: 'upi' } } } }),
        providerPaymentId: `pay_sj_${id.replace(/-/g, '').slice(0, 12)}`,
        providerOrderId: `plink_sj_${id.replace(/-/g, '').slice(0, 10)}`,
      });
    } catch (e) {
      error = (e as Error).message;
    }
    const o = await order(id);
    expect(o.payment_status).toBe('paid');
    expect(error).toBeNull();
    expect(o.receipt_payment_id).toBeTruthy();
  });

  test('J6 order placed at 00:30 IST on 23 Oct is invoiced on 23 Oct', async () => {
    const id = await seedOrder({ payment: 'cod', createdAt: '2026-10-22T19:00:00Z' });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect((await invoice(inv.invoiceId!)).invoice_date).toBe('2026-10-23');
  });

  test('J7 a courier COD remittance settles the invoice in the accounts', async () => {
    const id = await seedOrder({ payment: 'cod' });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'confirmed', actorUserId: A });
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'ready', dispatchMode: 'self', actorUserId: A });
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'delivered', actorUserId: A });
    const f = await fulfilment(id);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await recordRemittance(c, {
        businessId: B,
        userId: A,
        source: 'own_rider',
        remittedOn: '2026-10-23',
        receivedAmount: 236,
        fulfilmentIds: [f.id],
      });
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    expect((await invoice(inv.invoiceId!)).bal).toBeCloseTo(0, 2);
  });

  test('J8 a direct-UPI order can be marked received and its receipt posts', async () => {
    const id = await seedOrder({ payment: 'cod', provider: 'upi' });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    let error: string | null = null;
    try {
      await collectStoreOrderCash(id, B, A);
    } catch (e) {
      error = (e as Error).message;
    }
    expect(error).toBeNull();
    expect((await invoice(inv.invoiceId!)).bal).toBeCloseTo(0, 2);
  });

  test('J9 a direct-UPI order shipping label does not tell the courier to collect cash', async () => {
    const id = await seedOrder({ payment: 'cod', provider: 'upi' });
    await tryInvoice(id);
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'confirmed', actorUserId: A });
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'ready', dispatchMode: 'self', actorUserId: A });
    const f = await fulfilment(id);
    const banner = paymentBanner({ paid: false, codAmount: f.cod_collected_at ? 0 : Number(f.cod_amount) || 0 });
    expect(banner.tone).not.toBe('cod');
  });
});
