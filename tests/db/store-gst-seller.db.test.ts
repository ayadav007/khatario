/**
 * Composition sellers and businesses without a GSTIN must not charge GST: the checkout quote and
 * the Bill of Supply agree, and orders that already charged it can still be billed. Runs only
 * when PHASE2_TEST_DATABASE_URL points at local kh_phase2_test.
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
import { buildStoreQuote } from '@/lib/store/quote';
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';

d('Store orders for sellers who cannot charge GST (real DB)', () => {
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
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1,$2,$3,'27','composition')`,
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

  const bill = async (id: string) =>
    (
      await pool.query(
        `SELECT document_type, grand_total::float8 AS grand, tax_total::float8 AS tax FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0];

  /** Places an order from the real quote, the way the orders route stores it. */
  async function orderFromQuote(itemId: string) {
    const quote = await buildStoreQuote({
      businessId: B,
      minOrderAmount: 0,
      items: [{ item_id: itemId, quantity: 2 }],
      deliveryMode: 'pickup',
    });
    expect(quote.serviceable).toBe(true);
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone, customer_address, customer_pincode,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'12 MG Road, Pune','411001','pending','cod',$6,$7,0,0,$8,'pickup')`,
      [id, B, BR, `SG-${tag}-${seq}`, phone, quote.subtotal, quote.tax_total, quote.grand_total],
    );
    for (const l of quote.lines) {
      await pool.query(
        `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, l.item_id, l.item_name, l.quantity, l.unit, l.unit_price, l.tax_rate, l.line_total],
      );
    }
    return { id, quote };
  }

  test('G1 composition seller: GST-extra item is charged at its price and billed without tax', async () => {
    const { id, quote } = await orderFromQuote(EXCL);
    expect(quote).toMatchObject({ grand_total: 200, tax_total: 0 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect(await bill(inv.invoiceId!)).toEqual({ document_type: 'bill_of_supply', grand: 200, tax: 0 });
  });

  test('G2 composition seller: GST-included item keeps its price, with no GST in it', async () => {
    const { id, quote } = await orderFromQuote(INCL);
    expect(quote).toMatchObject({ grand_total: 236, tax_total: 0 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect(await bill(inv.invoiceId!)).toEqual({ document_type: 'bill_of_supply', grand: 236, tax: 0 });
  });

  test('G3 an order already charged GST before the fix bills what the shopper paid, with a delivery fee and coupon', async () => {
    const id = await seedOrder({ payment: 'cod', delivery: 40, discount: 20 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect(await bill(inv.invoiceId!)).toEqual({ document_type: 'bill_of_supply', grand: 256, tax: 0 });
  });

  test('G4 a business with no GSTIN is treated the same', async () => {
    await pool.query(`UPDATE businesses SET gstin = NULL, gst_registration_type = 'unregistered' WHERE id = $1`, [B]);
    const { id, quote } = await orderFromQuote(EXCL);
    expect(quote).toMatchObject({ grand_total: 200, tax_total: 0 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect(await bill(inv.invoiceId!)).toEqual({ document_type: 'bill_of_supply', grand: 200, tax: 0 });
  });

  test('G5 the same business charges GST once it has a regular registration', async () => {
    await pool.query(`UPDATE businesses SET gstin = $2, gst_registration_type = 'regular' WHERE id = $1`, [
      B,
      `27AABCS${tag.slice(0, 4).toUpperCase()}J1Z5`,
    ]);
    const { id, quote } = await orderFromQuote(EXCL);
    expect(quote).toMatchObject({ grand_total: 236, tax_total: 36 });
    const inv = await tryInvoice(id);
    expect(inv.error).toBeNull();
    expect(await bill(inv.invoiceId!)).toEqual({ document_type: 'tax_invoice', grand: 236, tax: 36 });
  });
});
