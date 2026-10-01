/**
 * Phase 3.6A: cancelling a store order reverses its final invoice, or cancels
 * with no accounting when no invoice exists. Payments are not touched.
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
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { InvoiceCancelError, SHIPROCKET_WEBHOOK_ACTOR } from '@/lib/invoices/cancel-final-invoice';
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { hashStoreWebhookToken } from '@/lib/store/delivery/webhooks';
import { PATCH as patchOrder } from '@/app/api/settings/online-store/orders/route';
import { PATCH as cancelInvoice } from '@/app/api/invoices/[id]/cancel/route';
import { POST as shiprocketWebhook } from '@/app/api/webhooks/store/shiprocket/route';

d('Phase 3.6A store order cancellation (real DB)', () => {
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
    return Number((await pool.query(`SELECT current_stock::float8 AS q FROM items WHERE id = $1`, [ITEM])).rows[0].q);
  }

  async function branchQty(): Promise<number> {
    return Number(
      (
        await pool.query(
          `SELECT COALESCE(quantity, 0)::float8 AS q FROM branch_item_stock
            WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
          [B, BR, ITEM],
        )
      ).rows[0]?.q ?? 0,
    );
  }

  async function setOnHand(qty: number) {
    await pool.query(`UPDATE items SET current_stock = $2 WHERE id = $1`, [ITEM, qty]);
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, branch_id, item_id)
       DO UPDATE SET quantity = EXCLUDED.quantity`,
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
      [id, B, BR, `P36-${tag}-${seq}`, phone, opts?.status ?? 'confirmed', opts?.payment ?? 'cod'],
    );
    await pool.query(
      `INSERT INTO store_order_items
         (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Widget',2,'PCS',100,18,236)`,
      [id, ITEM],
    );
    return id;
  }

  async function invoiceOf(orderId: string) {
    const id = (await pool.query(`SELECT invoice_id FROM store_orders WHERE id = $1`, [orderId])).rows[0].invoice_id as string;
    const row = (
      await pool.query(
        `SELECT status, payment_status, cancellation_details FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0];
    return { id, ...row };
  }

  async function finalize() {
    const orderId = await seedOrder();
    const invoiceId = await createInvoiceForStoreOrder(orderId, B, A);
    return { orderId, invoiceId: invoiceId! };
  }

  async function originalLines(invoiceId: string) {
    const r = await pool.query<{ id: string; debit: string; credit: string; account_id: string }>(
      `SELECT id, debit::text, credit::text, account_id
         FROM ledger_entry_lines
        WHERE voucher_id = $1 AND voucher_type = 'invoice' AND narration NOT LIKE 'Reversal:%'
        ORDER BY id`,
      [invoiceId],
    );
    return r.rows;
  }

  async function reversalCount(invoiceId: string): Promise<number> {
    return Number(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM ledger_entry_reversals
            WHERE voucher_id = $1 AND voucher_type = 'invoice'`,
          [invoiceId],
        )
      ).rows[0].n,
    );
  }

  async function movementCount(invoiceId: string, referenceType: string): Promise<number> {
    return Number(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM stock_movements
            WHERE reference_id = $1 AND reference_type = $2`,
          [invoiceId, referenceType],
        )
      ).rows[0].n,
    );
  }

  function patch(body: Record<string, unknown>, business = B, user = A) {
    return patchOrder(
      new NextRequest(`http://localhost/api/settings/online-store/orders?business_id=${B2}&user_id=${randomUUID()}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': user,
          'x-authenticated-business-id': business,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '27', 'regular')`,
      [B, `Phase36 ${tag}`, `27AABCU${tag.slice(0, 4).toUpperCase()}A1Z5`, B2, `Phase36b ${tag}`, `29AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`],
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

  test('1. an uninvoiced order can be cancelled', async () => {
    const id = await seedOrder();
    const moved = await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', cancelledReason: 'No' });
    expect(moved).toMatchObject({ ok: true, to: 'cancelled' });
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [id])).rows[0].status).toBe('cancelled');
  });

  test('2. an uninvoiced cancellation creates no ledger reversal', async () => {
    const id = await seedOrder();
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled' });
    const n = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_reversals WHERE business_id = $1`, [B])).rows[0].n,
    );
    expect(n).toBe(0);
  });

  test('3. an uninvoiced cancellation creates no stock reversal', async () => {
    const id = await seedOrder();
    const before = await movementCount(id, 'invoice_cancel');
    await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled' });
    expect(await shelf()).toBe(10);
    expect(await branchQty()).toBe(10);
    expect(await movementCount(id, 'invoice_cancel')).toBe(before);
  });

  test('4. an invoiced store order can be cancelled', async () => {
    const { orderId } = await finalize();
    const moved = await transitionStoreOrder({
      businessId: B,
      orderId,
      to: 'cancelled',
      actorUserId: A,
      cancelledReason: 'Buyer changed mind',
    });
    expect(moved).toMatchObject({ ok: true, stockRestored: true });
  });

  test('5. the original invoice ledger lines stay unchanged', async () => {
    const { orderId, invoiceId } = await finalize();
    const before = await originalLines(invoiceId);
    expect(before.length).toBeGreaterThan(0);
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const after = await originalLines(invoiceId);
    expect(after).toEqual(before);
  });

  test('6. reversal ledger entries are created', async () => {
    const { orderId, invoiceId } = await finalize();
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const rev = await pool.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.account_code AS code, l.debit::text, l.credit::text
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.voucher_id = $1 AND l.narration LIKE 'Reversal:%'`,
      [invoiceId],
    );
    expect(rev.rows.find((r) => r.code === '1103')?.credit).toBe('236.00');
    expect(parseFloat(rev.rows.find((r) => r.code === '4101')?.debit || '0')).toBeCloseTo(200, 2);
    expect(parseFloat(rev.rows.find((r) => r.code === '2150')?.debit || '0')).toBeCloseTo(18, 2);
    expect(parseFloat(rev.rows.find((r) => r.code === '2151')?.debit || '0')).toBeCloseTo(18, 2);
  });

  test('7. reversal links are created', async () => {
    const { orderId, invoiceId } = await finalize();
    const originals = (await originalLines(invoiceId)).length;
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    expect(await reversalCount(invoiceId)).toBe(originals);
  });

  test('8. the original stock movement remains', async () => {
    const { orderId, invoiceId } = await finalize();
    expect(await movementCount(invoiceId, 'invoice')).toBe(1);
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const out = await pool.query(
      `SELECT type, quantity::float8 AS quantity FROM stock_movements
        WHERE reference_id = $1 AND reference_type = 'invoice'`,
      [invoiceId],
    );
    expect(out.rows).toEqual([expect.objectContaining({ type: 'out', quantity: 2 })]);
  });

  test('9. a stock reversal movement is created', async () => {
    const { orderId, invoiceId } = await finalize();
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const inn = await pool.query(
      `SELECT type, quantity::float8 AS quantity FROM stock_movements
        WHERE reference_id = $1 AND reference_type = 'invoice_cancel'`,
      [invoiceId],
    );
    expect(inn.rows).toEqual([expect.objectContaining({ type: 'in', quantity: 2 })]);
  });

  test('10. stock quantity is restored', async () => {
    const { orderId } = await finalize();
    expect(await branchQty()).toBe(8);
    expect(await shelf()).toBe(8);
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    expect(await branchQty()).toBe(10);
    expect(await shelf()).toBe(10);
  });

  test('11. the invoice is marked cancelled and the original row remains', async () => {
    const { orderId, invoiceId } = await finalize();
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const inv = await invoiceOf(orderId);
    expect(inv.id).toBe(invoiceId);
    expect(inv.status).toBe('cancelled');
    const still = await pool.query(`SELECT id FROM invoices WHERE id = $1`, [invoiceId]);
    expect(still.rows).toHaveLength(1);
  });

  test('12. the store order is marked cancelled and its payment status is unchanged', async () => {
    const { orderId } = await finalize();
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' });
    const row = (await pool.query(`SELECT status, payment_status FROM store_orders WHERE id = $1`, [orderId])).rows[0];
    expect(row).toMatchObject({ status: 'cancelled', payment_status: 'cod' });
  });

  test('13. an accounting reversal failure rolls back the cancellation', async () => {
    const { orderId, invoiceId } = await finalize();
    const fn = `p36_led_${tag.replace(/-/g, '')}`;
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        IF NEW.narration LIKE 'Reversal:%' THEN RAISE EXCEPTION 'simulated ledger failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON ledger_entry_lines FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      await expect(
        transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' }),
      ).rejects.toThrow(/simulated ledger failure/);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON ledger_entry_lines`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('confirmed');
    expect((await invoiceOf(orderId)).status).toBe('final');
    expect(await reversalCount(invoiceId)).toBe(0);
    expect(await branchQty()).toBe(8);
  });

  test('14. a stock reversal failure rolls back accounting and the order', async () => {
    const { orderId, invoiceId } = await finalize();
    const fn = `p36_stk_${tag.replace(/-/g, '')}`;
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        IF NEW.reference_type = 'invoice_cancel' THEN RAISE EXCEPTION 'simulated stock failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      await expect(
        transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' }),
      ).rejects.toThrow(/simulated stock failure/);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON stock_movements`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('confirmed');
    expect((await invoiceOf(orderId)).status).toBe('final');
    expect(await reversalCount(invoiceId)).toBe(0);
    expect(await movementCount(invoiceId, 'invoice_cancel')).toBe(0);
    expect(await branchQty()).toBe(8);
  });

  test('15. a failed cancellation leaves the original invoice active', async () => {
    const { orderId, invoiceId } = await finalize();
    const before = await originalLines(invoiceId);
    const fn = `p36_act_${tag.replace(/-/g, '')}`;
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        IF NEW.narration LIKE 'Reversal:%' THEN RAISE EXCEPTION 'simulated ledger failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON ledger_entry_lines FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      await expect(
        transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Stop' }),
      ).rejects.toThrow(/simulated ledger failure/);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON ledger_entry_lines`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect((await invoiceOf(orderId)).status).toBe('final');
    expect(await originalLines(invoiceId)).toEqual(before);
    expect(await movementCount(invoiceId, 'invoice')).toBe(1);
    expect(await shelf()).toBe(8);
  });

  test('16. two simultaneous cancellations create only one reversal', async () => {
    const { orderId, invoiceId } = await finalize();
    const results = await Promise.all([
      transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Once' }),
      transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Twice' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 'INVALID_TRANSITION')).toHaveLength(1);
    const originals = (await originalLines(invoiceId)).length;
    expect(await reversalCount(invoiceId)).toBe(originals);
  });

  test('17. two simultaneous cancellations create only one stock reversal', async () => {
    const { orderId, invoiceId } = await finalize();
    await Promise.all([
      transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Once' }),
      transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Twice' }),
    ]);
    expect(await movementCount(invoiceId, 'invoice_cancel')).toBe(1);
    expect(await branchQty()).toBe(10);
  });

  test('18. a second cancellation is rejected and does not reverse again', async () => {
    const { orderId, invoiceId } = await finalize();
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Once' });
    const links = await reversalCount(invoiceId);
    const again = await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Twice' });
    expect(again).toMatchObject({ ok: false, status: 409, code: 'INVALID_TRANSITION' });
    expect(await reversalCount(invoiceId)).toBe(links);
    expect(await movementCount(invoiceId, 'invoice_cancel')).toBe(1);
  });

  test('19. another business cannot cancel the order', async () => {
    const { orderId } = await finalize();
    const moved = await transitionStoreOrder({ businessId: B2, orderId, to: 'cancelled', actorUserId: A2 });
    expect(moved).toMatchObject({ ok: false, status: 404, code: 'ORDER_NOT_FOUND' });
    const res = await patch({ order_id: orderId, status: 'cancelled' }, B2, A2);
    expect(res.status).toBe(404);
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('confirmed');
    expect((await invoiceOf(orderId)).status).toBe('final');
  });

  test('20. client-supplied identity cannot override the session', async () => {
    const { orderId, invoiceId } = await finalize();
    const spoof = randomUUID();
    const denied = await patch({
      order_id: orderId,
      status: 'cancelled',
      business_id: B2,
      user_id: spoof,
      cancelled_by: spoof,
      cancelled_reason: 'Spoof',
    });
    expect(denied.status).toBe(403);
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('confirmed');

    const ok = await patch({
      order_id: orderId,
      status: 'cancelled',
      business_id: B,
      user_id: spoof,
      cancelled_by: spoof,
      created_by: spoof,
      cancelled_reason: 'Real reason',
    });
    expect(ok.status).toBe(200);
    const details = (await invoiceOf(orderId)).cancellation_details;
    expect(details.cancelled_by).toBe(A);
    expect(details.reason).toBe('Real reason');
    expect(invoiceId).toEqual(expect.any(String));
  });

  test('21. a delivered order cannot be cancelled', async () => {
    const { orderId, invoiceId } = await finalize();
    await pool.query(`UPDATE store_orders SET status = 'delivered' WHERE id = $1`, [orderId]);
    const moved = await transitionStoreOrder({
      businessId: B,
      orderId,
      to: 'cancelled',
      actorUserId: A,
      cancelledReason: 'Too late',
    });
    expect(moved).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('delivered');
    expect((await invoiceOf(orderId)).status).toBe('final');
    expect(await reversalCount(invoiceId)).toBe(0);
    expect(await branchQty()).toBe(8);
  });

  test('22. an already-cancelled order cannot be cancelled again', async () => {
    const id = await seedOrder({ status: 'cancelled' });
    const moved = await transitionStoreOrder({ businessId: B, orderId: id, to: 'cancelled', actorUserId: A });
    expect(moved).toMatchObject({ ok: false, status: 409, code: 'INVALID_TRANSITION' });
  });

  test('23. the cancellation reason is stored on the order and the invoice', async () => {
    const { orderId } = await finalize();
    await transitionStoreOrder({
      businessId: B,
      orderId,
      to: 'cancelled',
      actorUserId: A,
      cancelledReason: 'Wrong item',
    });
    const order = (await pool.query(`SELECT cancelled_reason FROM store_orders WHERE id = $1`, [orderId])).rows[0];
    expect(order.cancelled_reason).toBe('Wrong item');
    expect((await invoiceOf(orderId)).cancellation_details.reason).toBe('Wrong item');
    expect((await invoiceOf(orderId)).cancellation_details.cancelled_by).toBe(A);
  });

  test('24. a locked accounting period blocks cancellation', async () => {
    const { orderId, invoiceId } = await finalize();
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, $2, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $3)`,
      [B, BR, A],
    );
    try {
      await expect(
        transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Locked' }),
      ).rejects.toBeInstanceOf(InvoiceCancelError);
    } finally {
      await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
    }
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('confirmed');
    expect((await invoiceOf(orderId)).status).toBe('final');
    expect(await reversalCount(invoiceId)).toBe(0);
    expect(await branchQty()).toBe(8);
  });

  test('25. the invoice reversal cannot be performed twice', async () => {
    const { orderId, invoiceId } = await finalize();
    await transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', actorUserId: A, cancelledReason: 'Once' });
    const links = await reversalCount(invoiceId);
    const res = await cancelInvoice(
      new NextRequest(`http://localhost/api/invoices/${invoiceId}/cancel?business_id=${B2}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': A,
          'x-authenticated-business-id': B,
        },
        body: JSON.stringify({ reason: 'Again', cancelled_by: randomUUID(), business_id: B2 }),
      }),
      { params: { id: invoiceId } },
    );
    expect(res.status).toBe(409);
    expect(await reversalCount(invoiceId)).toBe(links);
    expect(await movementCount(invoiceId, 'invoice_cancel')).toBe(1);
    expect(await branchQty()).toBe(10);
  });

  test('26. an invoiced cancel without a session user is not attributed to the primary admin', async () => {
    const { orderId, invoiceId } = await finalize();
    await expect(
      transitionStoreOrder({ businessId: B, orderId, to: 'cancelled', cancelledReason: 'No session' }),
    ).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' });
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('confirmed');
    expect((await invoiceOf(orderId)).status).toBe('final');
    expect(await reversalCount(invoiceId)).toBe(0);
    const actors = await pool.query(
      `SELECT created_by FROM ledger_entry_reversals WHERE voucher_id = $1`,
      [invoiceId],
    );
    expect(actors.rows).toEqual([]);
  });

  test('27. an authenticated Shiprocket cancel is a carrier event, not the primary admin', async () => {
    const { orderId, invoiceId } = await finalize();
    const awb = `AWB36${tag}${seq}`;
    const token = `Phase36ShiprocketToken${tag}`;
    await pool.query(`UPDATE store_orders SET awb = $2 WHERE id = $1`, [orderId, awb]);
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_shiprocket_webhook_token_hash)
       VALUES ($1, $2, true, $3)
       ON CONFLICT (business_id) DO UPDATE
         SET store_shiprocket_webhook_token_hash = EXCLUDED.store_shiprocket_webhook_token_hash`,
      [B, `p36${tag}`, hashStoreWebhookToken(token)],
    );
    const res = await shiprocketWebhook(
      new NextRequest('http://localhost/api/webhooks/store/shiprocket', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': token },
        body: JSON.stringify({
          awb,
          current_status: 'Cancelled',
          user_id: A2,
          userId: A2,
          cancelled_by: A2,
          created_by: A,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await pool.query(`SELECT status FROM store_orders WHERE id = $1`, [orderId])).rows[0].status).toBe('cancelled');
    const details = (await invoiceOf(orderId)).cancellation_details;
    expect(details.actor_type).toBe(SHIPROCKET_WEBHOOK_ACTOR);
    expect(details.cancelled_by).toBeNull();
    expect(details.cancelled_by).not.toBe(A);
    const actors = await pool.query<{ created_by: string | null }>(
      `SELECT created_by FROM ledger_entry_reversals WHERE voucher_id = $1 AND business_id = $2`,
      [invoiceId, B],
    );
    expect(actors.rows.length).toBeGreaterThan(0);
    expect(actors.rows.every((row) => row.created_by === null)).toBe(true);
  });
});
