/**
 * Phase 3.5: a store order finalises as one normal final sales invoice.
 * Accounting, GST, stock audit and the order link commit together.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
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
import { createInvoiceForStoreOrder, fulfillStoreOrderPayment, StoreInvoiceError } from '@/lib/store/fulfill-paid-order';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { PATCH as patchOrder } from '@/app/api/settings/online-store/orders/route';

d('Phase 3.5 store order final invoice (real DB)', () => {
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

  async function shelf(): Promise<number> {
    const r = await pool.query(`SELECT current_stock::float8 AS q FROM items WHERE id = $1`, [ITEM]);
    return Number(r.rows[0].q);
  }

  async function branchQty(): Promise<number> {
    const r = await pool.query(
      `SELECT COALESCE(quantity, 0)::float8 AS q FROM branch_item_stock
        WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
      [B, BR, ITEM],
    );
    return Number(r.rows[0]?.q ?? 0);
  }

  async function movementQty(invoiceId: string): Promise<number> {
    const r = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0)::float8 AS q, COUNT(*)::int AS n
         FROM stock_movements WHERE reference_id = $1 AND reference_type = 'invoice'`,
      [invoiceId],
    );
    return Number(r.rows[0].q);
  }

  async function movementCount(invoiceId: string): Promise<number> {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1 AND reference_type = 'invoice'`,
      [invoiceId],
    );
    return Number(r.rows[0].n);
  }

  async function ledgerCodes(invoiceId: string): Promise<Array<{ code: string; debit: number; credit: number }>> {
    const r = await pool.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.account_code AS code, l.debit::text, l.credit::text
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.voucher_id = $1 AND l.voucher_type = 'invoice'`,
      [invoiceId],
    );
    return r.rows.map((row) => ({
      code: row.code,
      debit: parseFloat(row.debit),
      credit: parseFloat(row.credit),
    }));
  }

  async function invoiceCountForOrder(orderId: string): Promise<number> {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE store_order_id = $1 OR id = (
         SELECT invoice_id FROM store_orders WHERE id = $1
       )`,
      [orderId],
    );
    return Number(r.rows[0].n);
  }

  type SeedOpts = {
    payment?: 'cod' | 'paid' | 'unpaid';
    status?: string;
    qty?: number;
    unit?: number;
    taxRate?: number;
    lineTotal?: number;
    subtotal?: number;
    tax?: number;
    delivery?: number;
    discount?: number;
    grand?: number;
    onHand?: number;
    lines?: Array<{ qty: number; unit: number; taxRate: number; lineTotal: number; name?: string }>;
    eventAmount?: number | null;
    skipEvent?: boolean;
  };

  async function seedOrder(opts: SeedOpts = {}): Promise<string> {
    const id = randomUUID();
    seq += 1;
    const qty = opts.qty ?? 2;
    const unit = opts.unit ?? 100;
    const taxRate = opts.taxRate ?? 18;
    const lineTotal = opts.lineTotal ?? 236;
    const subtotal = opts.subtotal ?? 200;
    const tax = opts.tax ?? 36;
    const delivery = opts.delivery ?? 0;
    const discount = opts.discount ?? 0;
    const grand = opts.grand ?? 236;
    const payment = opts.payment ?? 'cod';
    const onHand = opts.onHand ?? 10;
    await pool.query(`UPDATE items SET current_stock = $2 WHERE id = $1`, [ITEM, onHand]);
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, branch_id, item_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP`,
      [B, BR, ITEM, onHand],
    );
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,$6,$7,$8,$9,$10,$11,$12,'pickup')`,
      [id, B, BR, `P35-${tag}-${seq}`, phone, opts.status ?? 'pending', payment, subtotal, tax, delivery, discount, grand],
    );
    const lines = opts.lines ?? [{ qty, unit, taxRate, lineTotal, name: 'Widget' }];
    for (const line of lines) {
      await pool.query(
        `INSERT INTO store_order_items
           (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
         VALUES ($1,$2,$3,$4,'PCS',$5,$6,$7)`,
        [id, ITEM, line.name ?? 'Widget', line.qty, line.unit, line.taxRate, line.lineTotal],
      );
    }
    if (payment === 'paid' && !opts.skipEvent) {
      await pool.query(
        `INSERT INTO store_payment_events
           (business_id, order_id, provider, idempotency_key, payload, amount, status)
         VALUES ($1,$2,'razorpay',$3,'{}',$4,'processed')`,
        [B, id, `p35-${id}`, opts.eventAmount === undefined ? grand : opts.eventAmount],
      );
    }
    return id;
  }

  async function invoiceRow(id: string) {
    const r = await pool.query(
      `SELECT status, document_type, grand_total::float8 AS grand_total, tax_total::float8 AS tax_total,
              subtotal::float8 AS subtotal, additional_charges::float8 AS additional_charges,
              cgst_total::float8 AS cgst_total, sgst_total::float8 AS sgst_total,
              igst_total::float8 AS igst_total, paid_amount::float8 AS paid_amount,
              balance_amount::float8 AS balance_amount, payment_status, created_by, customer_id,
              store_order_id, branch_id
         FROM invoices WHERE id = $1`,
      [id],
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS store_order_id UUID;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_store_order_id
        ON invoices (store_order_id) WHERE store_order_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_orders_invoice_id
        ON store_orders (invoice_id) WHERE invoice_id IS NOT NULL;
    `);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '27', 'regular')`,
      [B, `Phase35 ${tag}`, `27AABCU${tag.slice(0, 4).toUpperCase()}A1Z5`, B2, `Phase35b ${tag}`, `29AABCU${tag.slice(0, 4).toUpperCase()}B1Z5`],
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

  test('1. a store order creates one final invoice', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    expect(invoiceId).toEqual(expect.any(String));
    expect(await invoiceCountForOrder(id)).toBe(1);
  });

  test('2. the invoice status is final', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const row = await invoiceRow(invoiceId!);
    expect(row.status).toBe('final');
    expect(row.document_type).toBe('tax_invoice');
  });

  test('3. the store order records the invoice relationship', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const link = await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].invoice_id).toBe(invoiceId);
    const inv = await invoiceRow(invoiceId!);
    expect(inv.store_order_id).toBe(id);
    expect(inv.customer_id).toBe(CUST);
    expect(inv.branch_id).toBe(BR);
  });

  test('4. invoice accounting entries are created once', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const lines = await ledgerCodes(invoiceId!);
    const ar = lines.find((l) => l.code === '1103');
    const sales = lines.find((l) => l.code === '4101');
    expect(ar?.debit).toBeCloseTo(236, 2);
    expect(sales?.credit).toBeCloseTo(200, 2);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  test('5. GST is posted the same way as a normal invoice', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const lines = await ledgerCodes(invoiceId!);
    expect(lines.find((l) => l.code === '2150')?.credit).toBeCloseTo(18, 2);
    expect(lines.find((l) => l.code === '2151')?.credit).toBeCloseTo(18, 2);
    const row = await invoiceRow(invoiceId!);
    expect(row.cgst_total).toBeCloseTo(18, 2);
    expect(row.sgst_total).toBeCloseTo(18, 2);
    expect(row.igst_total).toBeCloseTo(0, 2);
  });

  test('6. stock is deducted exactly once', async () => {
    const id = await seedOrder();
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    expect(await shelf()).toBe(8);
    expect(await branchQty()).toBe(8);
    expect(await movementCount(invoiceId!)).toBe(1);
    expect(await movementQty(invoiceId!)).toBe(2);
  });

  test('7. the invoice writes one stock movement for the sold quantity', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    expect(await movementCount(invoiceId!)).toBe(1);
    expect(await movementQty(invoiceId!)).toBe(2);
  });

  test('8. a second finalisation returns the same invoice and does not post again', async () => {
    const id = await seedOrder();
    const first = await createInvoiceForStoreOrder(id, B, A);
    const ledgerBefore = (await ledgerCodes(first!)).length;
    const movesBefore = await movementCount(first!);
    const second = await createInvoiceForStoreOrder(id, B, A);
    expect(second).toBe(first);
    expect((await ledgerCodes(first!)).length).toBe(ledgerBefore);
    expect(await movementCount(first!)).toBe(movesBefore);
    expect(await shelf()).toBe(8);
    expect(await invoiceCountForOrder(id)).toBe(1);
  });

  test('9. concurrent finalisation creates exactly one invoice', async () => {
    const id = await seedOrder();
    const results = await Promise.all([
      createInvoiceForStoreOrder(id, B, A),
      createInvoiceForStoreOrder(id, B, A),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(await invoiceCountForOrder(id)).toBe(1);
    expect(await movementCount(results[0]!)).toBe(1);
    expect((await ledgerCodes(results[0]!)).filter((l) => l.code === '1103')).toHaveLength(1);
    expect(await shelf()).toBe(8);
  });

  test('10. a failed invoice creation leaves no invoice', async () => {
    const id = await seedOrder({ lines: [] });
    await expect(createInvoiceForStoreOrder(id, B, A)).rejects.toBeInstanceOf(StoreInvoiceError);
    const link = await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].invoice_id).toBeNull();
    expect(await invoiceCountForOrder(id)).toBe(0);
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
  });

  test('11. a failed ledger post leaves no partial accounting', async () => {
    const id = await seedOrder();
    await pool.query(
      `UPDATE accounts SET is_active = false WHERE business_id = $1 AND account_code = '2150'`,
      [B],
    );
    try {
      await expect(createInvoiceForStoreOrder(id, B, A)).rejects.toThrow(/GST accounts/);
    } finally {
      await pool.query(
        `UPDATE accounts SET is_active = true WHERE business_id = $1 AND account_code = '2150'`,
        [B],
      );
    }
    const link = await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].invoice_id).toBeNull();
    const ledger = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'invoice'
         AND voucher_id NOT IN (SELECT id FROM invoices WHERE business_id = $1)`,
      [B],
    );
    expect(Number(ledger.rows[0].n)).toBe(0);
    expect(await invoiceCountForOrder(id)).toBe(0);
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
  });

  test('12. a failed stock post rolls back the invoice and the shelf', async () => {
    const id = await seedOrder();
    const shelfBefore = await shelf();
    const branchBefore = await branchQty();
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled)
       VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true`,
      [B],
    );
    try {
      await expect(createInvoiceForStoreOrder(id, B, A)).rejects.toThrow(/Warehouse required/);
    } finally {
      await pool.query(
        `UPDATE business_settings SET warehouses_enabled = false WHERE business_id = $1`,
        [B],
      );
    }
    const link = await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].invoice_id).toBeNull();
    expect(await shelf()).toBe(shelfBefore);
    expect(await branchQty()).toBe(branchBefore);
    const forOrder = await pool.query(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE store_order_id = $1`,
      [id],
    );
    expect(Number(forOrder.rows[0].n)).toBe(0);
  });

  test('12b. warehouse mode posts the sale to the default warehouse and the ledger', async () => {
    const id = await seedOrder();
    const wh = randomUUID();
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, is_active)
       VALUES ($1, $2, $3, 'Store warehouse', true)`,
      [wh, B, BR],
    );
    await pool.query(
      `INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary) VALUES ($1, $2, true)`,
      [BR, wh],
    );
    await pool.query(
      `INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 10)`,
      [wh, ITEM],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled)
       VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true`,
      [B],
    );
    try {
      const invoiceId = await createInvoiceForStoreOrder(id, B, A);
      expect(invoiceId).toEqual(expect.any(String));
      const lines = await ledgerCodes(invoiceId!);
      expect(lines.find((l) => l.code === '4101')?.credit).toBeCloseTo(200, 2);
      expect(lines.find((l) => l.code === '1103')?.debit).toBeCloseTo(236, 2);
      const stock = await pool.query(
        `SELECT current_stock_qty::float8 AS q FROM location_stock WHERE location_id = $1 AND item_id = $2`,
        [wh, ITEM],
      );
      expect(Number(stock.rows[0].q)).toBe(8);
      const row = await invoiceRow(invoiceId!);
      expect(row.status).toBe('final');
    } finally {
      await pool.query(`UPDATE business_settings SET warehouses_enabled = false WHERE business_id = $1`, [B]);
    }
  });

  test('12c. a shopper who is not a customer yet is created and the sale posts to their account', async () => {
    const id = await seedOrder();
    const newPhone = `8${String(Date.now()).slice(-9)}`;
    await pool.query(`UPDATE store_orders SET customer_phone = $2, customer_name = 'New Shopper' WHERE id = $1`, [id, newPhone]);
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const inv = await invoiceRow(invoiceId!);
    expect(inv.customer_id).toEqual(expect.any(String));
    expect(inv.customer_id).not.toBe(CUST);
    const cust = (await pool.query(`SELECT name, phone, business_id FROM customers WHERE id = $1`, [inv.customer_id])).rows[0];
    expect(cust).toMatchObject({ name: 'New Shopper', phone: newPhone, business_id: B });
    const lines = await ledgerCodes(invoiceId!);
    expect(lines.find((l) => l.code === '1103')?.debit).toBeCloseTo(236, 2);
    expect(lines.find((l) => l.code === '1101')).toBeUndefined();

    const again = await seedOrder();
    await pool.query(`UPDATE store_orders SET customer_phone = $2 WHERE id = $1`, [again, newPhone]);
    const second = await invoiceRow((await createInvoiceForStoreOrder(again, B, A))!);
    expect(second.customer_id).toBe(inv.customer_id);
  });

  test('13. a failed transaction leaves the store order uninvoiced', async () => {
    const id = await seedOrder({ tax: 0, grand: 200 });
    await expect(createInvoiceForStoreOrder(id, B, A)).rejects.toMatchObject({
      code: 'STORE_TOTALS_NOT_REPRESENTABLE',
    });
    const row = await pool.query(`SELECT invoice_id, status, payment_status FROM store_orders WHERE id = $1`, [id]);
    expect(row.rows[0].invoice_id).toBeNull();
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].payment_status).toBe('cod');
  });

  test('14. another business cannot finalise the order', async () => {
    const id = await seedOrder();
    await expect(createInvoiceForStoreOrder(id, B2, A2)).resolves.toBeNull();
    const link = await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].invoice_id).toBeNull();
    const res = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A2,
          'x-authenticated-business-id': B2,
        },
        body: JSON.stringify({ order_id: id, status: 'confirmed' }),
      }),
    );
    expect(res.status).toBe(404);
    expect((await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [id])).rows[0].invoice_id).toBeNull();
  });

  test('15. client-supplied business and user ids cannot override the session', async () => {
    const id = await seedOrder({ status: 'pending' });
    const spoof = randomUUID();
    const denied = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders?business_id=' + B2, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({
          order_id: id,
          status: 'confirmed',
          business_id: B2,
          user_id: spoof,
          created_by: spoof,
        }),
      }),
    );
    expect(denied.status).toBe(403);
    expect((await pool.query(`SELECT status, invoice_id FROM store_orders WHERE id = $1`, [id])).rows[0]).toMatchObject({
      status: 'pending',
      invoice_id: null,
    });

    await expect(createInvoiceForStoreOrder(id, B, A2)).rejects.toMatchObject({ code: 'ACTOR_MISMATCH' });

    const ok = await patchOrder(
      new NextRequest('http://localhost/api/settings/online-store/orders?user_id=' + spoof + '&business_id=' + spoof, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({
          order_id: id,
          status: 'confirmed',
          business_id: B,
          user_id: spoof,
          created_by: spoof,
        }),
      }),
    );
    expect(ok.status).toBe(200);
    const link = await pool.query(`SELECT invoice_id, status FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].status).toBe('confirmed');
    const inv = await invoiceRow(link.rows[0].invoice_id);
    expect(inv.created_by).toBe(A);
  });

  test('16. an already invoiced order cannot create another invoice', async () => {
    const id = await seedOrder();
    const first = await createInvoiceForStoreOrder(id, B, A);
    const again = await createInvoiceForStoreOrder(id, B, A);
    expect(again).toBe(first);
    const other = randomUUID();
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone, payment_status, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'cod',1,'pickup')`,
      [other, B, BR, `DUP${tag.slice(0, 4)}${seq}`, phone],
    );
    await expect(
      pool.query(`UPDATE store_orders SET invoice_id = $1 WHERE id = $2`, [first, other]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  test('17. a Razorpay amount that does not match the order is rejected', async () => {
    const id = await seedOrder({ payment: 'paid', eventAmount: 100, grand: 236 });
    await expect(createInvoiceForStoreOrder(id, B, A)).rejects.toMatchObject({
      code: 'PAYMENT_AMOUNT_MISMATCH',
    });
    const link = await pool.query(`SELECT invoice_id, payment_status FROM store_orders WHERE id = $1`, [id]);
    expect(link.rows[0].invoice_id).toBeNull();
    expect(link.rows[0].payment_status).toBe('paid');
    const unverified = await seedOrder({ payment: 'paid', skipEvent: true });
    await expect(createInvoiceForStoreOrder(unverified, B, A)).rejects.toMatchObject({
      code: 'STORE_PAYMENT_NOT_VERIFIED',
    });
  });

  test('18. a COD order stays COD and does not create a payment voucher', async () => {
    const id = await seedOrder({ payment: 'cod' });
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const order = await pool.query(`SELECT payment_status FROM store_orders WHERE id = $1`, [id]);
    expect(order.rows[0].payment_status).toBe('cod');
    const pays = await pool.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE reference_id = $1 AND deleted_at IS NULL`,
      [invoiceId],
    );
    expect(Number(pays.rows[0].n)).toBe(0);
    const row = await invoiceRow(invoiceId!);
    expect(row.paid_amount).toBeCloseTo(0, 2);
    expect(row.balance_amount).toBeCloseTo(236, 2);
    const note = await pool.query(`SELECT notes FROM invoices WHERE id = $1`, [invoiceId]);
    expect(String(note.rows[0].notes)).toContain('COD');
  });

  test('19. tax totals on the invoice match the order', async () => {
    const id = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const row = await invoiceRow(invoiceId!);
    const order = await pool.query(
      `SELECT tax_total::float8 AS tax, grand_total::float8 AS grand FROM store_orders WHERE id = $1`,
      [id],
    );
    expect(row.tax_total).toBeCloseTo(order.rows[0].tax, 2);
    expect(row.grand_total).toBeCloseTo(order.rows[0].grand, 2);
    const items = await pool.query(
      `SELECT quantity::float8 AS quantity, unit_price::float8 AS unit_price, tax_rate::float8 AS tax_rate
         FROM invoice_items WHERE invoice_id = $1`,
      [invoiceId],
    );
    expect(items.rows[0]).toMatchObject({ quantity: 2, unit_price: 100, tax_rate: 18 });
  });

  test('20. coupon discount and delivery are kept on the invoice, and mixed tax is rejected', async () => {
    const id = await seedOrder({
      qty: 1,
      unit: 100,
      taxRate: 18,
      lineTotal: 118,
      subtotal: 100,
      tax: 18,
      delivery: 40,
      discount: 10,
      grand: 148,
    });
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    const row = await invoiceRow(invoiceId!);
    expect(row.additional_charges).toBeCloseTo(30, 2);
    expect(row.grand_total).toBeCloseTo(148, 2);
    expect(row.tax_total).toBeCloseTo(18, 2);
    expect(row.subtotal).toBeCloseTo(100, 2);

    const mixed = await seedOrder({
      lines: [
        { qty: 1, unit: 100, taxRate: 18, lineTotal: 118, name: 'Exclusive' },
        { qty: 1, unit: 100, taxRate: 18, lineTotal: 100, name: 'Inclusive' },
      ],
      subtotal: 200,
      tax: 18,
      grand: 218,
    });
    await expect(createInvoiceForStoreOrder(mixed, B, A)).rejects.toMatchObject({
      code: 'STORE_TAX_NOT_REPRESENTABLE',
    });
    expect((await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [mixed])).rows[0].invoice_id).toBeNull();
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
  });

  test('COD checkout stock stays put until the final invoice deducts it once', async () => {
    const id = await seedOrder({ payment: 'cod' });
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
    const invoiceId = await createInvoiceForStoreOrder(id, B, A);
    expect(await shelf()).toBe(8);
    expect(await branchQty()).toBe(8);
    expect(await movementCount(invoiceId!)).toBe(1);
  });

  test('Razorpay payment does not deduct stock; the invoice that follows deducts once', async () => {
    const id = await seedOrder({ payment: 'unpaid' });
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
    const outcome = await fulfillStoreOrderPayment(id, B, {
      provider: 'razorpay',
      idempotencyKey: `p35-pay-${id}`,
      amount: 236,
      currency: 'INR',
      payload: '{}',
    });
    expect(outcome).toEqual({ outcome: 'fulfilled' });
    const link = await pool.query<{ invoice_id: string; payment_status: string }>(
      `SELECT invoice_id, payment_status FROM store_orders WHERE id = $1`,
      [id],
    );
    expect(link.rows[0].payment_status).toBe('paid');
    expect(await shelf()).toBe(8);
    expect(await branchQty()).toBe(8);
    expect(await movementCount(link.rows[0].invoice_id)).toBe(1);
    expect(await movementQty(link.rows[0].invoice_id)).toBe(2);
  });

  test('cancelling an uninvoiced COD order does not change stock', async () => {
    const id = await seedOrder({ payment: 'cod', status: 'confirmed' });
    const movesBefore = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE item_id = $1`, [ITEM])).rows[0].n,
    );
    const moved = await transitionStoreOrder({
      businessId: B,
      orderId: id,
      to: 'cancelled',
      cancelledReason: 'Changed mind',
    });
    expect(moved).toMatchObject({ ok: true, stockRestored: false });
    expect((await pool.query(`SELECT status, invoice_id FROM store_orders WHERE id = $1`, [id])).rows[0]).toMatchObject({
      status: 'cancelled',
      invoice_id: null,
    });
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
    const movesAfter = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE item_id = $1`, [ITEM])).rows[0].n,
    );
    expect(movesAfter).toBe(movesBefore);
  });
});
