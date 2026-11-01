/**
 * Migration 460: return events (timeline) and the pickup status check. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database.
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
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { createReturn } from '@/lib/returns/service';
import { listReturnEvents, recordReturnEvent } from '@/lib/returns/events';

d('order returns 460 (real DB)', () => {
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

  /** A billed (unpaid, cash on delivery) store order for `qty` widgets at ₹100 + 18% GST. */
  async function billedOrder(qty: number): Promise<{ orderId: string; invoiceId: string }> {
    const id = randomUUID();
    seq += 1;
    const total = qty * 118;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, payment_provider, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Buyer',$5,'confirmed','cod',NULL,$6,$7,0,0,$8,'delivery')`,
      [id, B, BR, `RT-${tag}-${seq}`, phone, qty * 100, qty * 18, total],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',$3,'PCS',100,18,$4)`,
      [id, ITEM, qty, total],
    );
    const invoiceId = (await createInvoiceForStoreOrder(id, B, A))!;
    return { orderId: id, invoiceId };
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
      await pool.query(`DELETE FROM order_return_events WHERE business_id = $1`, [B]);
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

  async function newReturn(): Promise<string> {
    const { invoiceId } = await billedOrder(1);
    return tx((c) => createReturn(c, { businessId: B, invoiceId, reason: 'size_fit', initiatedBy: 'merchant', userId: A }));
  }

  test('recordReturnEvent then listReturnEvents returns the events oldest first', async () => {
    const id = await newReturn();
    await tx(async (c) => {
      await recordReturnEvent(c, { businessId: B, returnId: id, kind: 'requested', actorType: 'customer' });
      await recordReturnEvent(c, { businessId: B, returnId: id, kind: 'approved', note: 'Courier pickup', actorType: 'staff', actorUserId: A });
    });
    const events = await listReturnEvents(pool, B, id);
    expect(events.map((e) => e.kind)).toEqual(['requested', 'approved']);
    expect(events[1]).toMatchObject({ note: 'Courier pickup', actor_type: 'staff' });
    expect(events[0].note).toBeNull();
  });

  test("listReturnEvents never returns another business's events", async () => {
    const id = await newReturn();
    await tx((c) => recordReturnEvent(c, { businessId: B, returnId: id, kind: 'requested', actorType: 'customer' }));
    expect(await listReturnEvents(pool, randomUUID(), id)).toEqual([]);
    expect((await listReturnEvents(pool, B, id)).length).toBe(1);
  });

  test('order_returns rejects an unknown pickup_status', async () => {
    const id = await newReturn();
    await expect(pool.query(`UPDATE order_returns SET pickup_status = 'lost' WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
    await pool.query(`UPDATE order_returns SET pickup_status = 'booked' WHERE id = $1`, [id]);
  });
});
