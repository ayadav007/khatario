/**
 * Orders & delivery operations on a real DB: parcel contents, pick list, rider link, failed-delivery
 * follow-up, order edit before packing and COD remittance.
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
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { ensureFulfilment, transitionFulfilment } from '@/lib/fulfilment/service';
import { loadOrderLineRefs, loadParcelContents, setParcelItems, ParcelItemsError } from '@/lib/fulfilment/parcel-items';
import { buildPickList } from '@/lib/fulfilment/pick-list';
import { applyRiderUpdate, ensureRiderToken, loadRiderDrop } from '@/lib/fulfilment/rider';
import { actOnFailedDelivery } from '@/lib/fulfilment/ndr';
import { removeItemsBeforePacking } from '@/lib/fulfilment/order-edit';
import { listOpenCod, recordRemittance } from '@/lib/fulfilment/cod-remittance';

d('fulfilment operations (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const SHIRT = randomUUID();
  const CAP = randomUUID();
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

  const stock = async (id: string) =>
    Number((await pool.query(`SELECT current_stock::float8 AS q FROM items WHERE id = $1`, [id])).rows[0].q);

  /** COD store order: 3 shirts @100 + 1 cap @50 (no GST), billed, with one confirmed parcel. */
  async function order(method: 'own_rider' | 'courier' = 'own_rider') {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders
         (id, business_id, branch_id, order_number, customer_name, customer_phone,
          status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode)
       VALUES ($1,$2,$3,$4,'Asha Rao',$5,'confirmed','cod',350,0,0,0,350,'delivery')`,
      [id, B, BR, `FO-${tag}-${seq}`, phone],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1,$2,'Shirt',3,'PCS',100,0,300), ($1,$3,'Cap',1,'PCS',50,0,50)`,
      [id, SHIRT, CAP],
    );
    const invoiceId = (await createInvoiceForStoreOrder(id, B, A))!;
    const fulfilmentId = await tx(async (c) => {
      const { row } = await ensureFulfilment(c, {
        businessId: B,
        channel: 'online_store',
        storeOrderId: id,
        invoiceId,
        branchId: BR,
        buyerName: 'Asha Rao',
        buyerPhone: phone,
        status: 'confirmed',
        method,
        codAmount: 350,
        actorType: 'staff',
        actorUserId: A,
      });
      // The bill already created the parcel from the store order; set how it travels for this test.
      await c.query(
        `UPDATE order_fulfilments SET ship_address = '12 MG Road, Pune', ship_pincode = '411001', method = $2, cod_amount = 350 WHERE id = $1`,
        [row.id, method],
      );
      return row.id;
    });
    return { id, invoiceId, fulfilmentId };
  }

  const move = (fulfilmentId: string, to: Parameters<typeof transitionFulfilment>[1]['to']) =>
    tx((c) => transitionFulfilment(c, { businessId: B, fulfilmentId, to, actorType: 'staff', actorUserId: A, skipPaymentGate: true }));

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `Fulfil ops ${tag}`, `27AABCF${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Clerk', $3, true)`, [A, B, `95${phone}`]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock, code)
       VALUES ($1, $3, 'Shirt', 'goods', 'PCS', 100, 40, 0, '6205', 50, 'SH-01'),
              ($2, $3, 'Cap', 'goods', 'PCS', 50, 20, 0, '6505', 50, 'CP-01')`,
      [SHIRT, CAP, B],
    );
    for (const it of [SHIRT, CAP]) {
      await pool.query(`INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,50)`, [B, BR, it]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM credit_note_refunds WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM order_returns WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM order_fulfilments WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM cod_remittances WHERE business_id = $1`, [B]);
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

  test('a parcel can carry only some items; the next parcel gets the rest', async () => {
    const o = await order();
    const lines = await loadOrderLineRefs(pool, B, { kind: 'store_order', id: o.id });
    const shirt = lines.find((l) => l.name === 'Shirt')!;
    await tx((c) => setParcelItems(c, { businessId: B, fulfilmentId: o.fulfilmentId, items: [{ line_id: shirt.line_id, quantity: 2 }] }));
    await expect(
      tx((c) => setParcelItems(c, { businessId: B, fulfilmentId: o.fulfilmentId, items: [{ line_id: shirt.line_id, quantity: 4 }] })),
    ).rejects.toBeInstanceOf(ParcelItemsError);

    const pick = await buildPickList({ businessId: B, branchIds: null }, [{ source: 'store_order', id: o.id }]);
    expect(pick.items).toEqual([expect.objectContaining({ name: 'Shirt', quantity: 2, sku: 'SH-01' })]);

    await move(o.fulfilmentId, 'packed');
    await move(o.fulfilmentId, 'shipped');
    const second = await tx(async (c) => {
      const { addShipment } = await import('@/lib/fulfilment/service');
      const out = await addShipment(c, { businessId: B, fulfilmentId: o.fulfilmentId, actorUserId: A });
      if (!out.ok) throw new Error(out.error);
      return out.row.id;
    });
    const parcels = (await pool.query(`SELECT id, seq, status FROM order_fulfilments WHERE store_order_id = $1`, [o.id])).rows;
    const contents = await loadParcelContents(pool, B, { kind: 'store_order', id: o.id }, parcels);
    expect(contents.get(second)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Shirt', quantity: 1 }), expect.objectContaining({ name: 'Cap', quantity: 1 })]),
    );
  });

  test('the rider link shows the drop and needs the cash before "delivered"', async () => {
    const o = await order();
    await move(o.fulfilmentId, 'packed');
    await move(o.fulfilmentId, 'shipped');
    const token = (await tx((c) => ensureRiderToken(c, B, o.fulfilmentId)))!;
    expect(await tx((c) => ensureRiderToken(c, B, o.fulfilmentId))).toBe(token);

    const drop = await loadRiderDrop(token);
    expect(drop).toMatchObject({ codDue: 350, address: '12 MG Road, Pune', canUpdate: true });
    expect(drop!.items).toHaveLength(2);

    const blocked = await applyRiderUpdate(token, { action: 'delivered' });
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    const done = await applyRiderUpdate(token, { action: 'delivered', cashCollected: true });
    expect(done).toMatchObject({ ok: true, to: 'delivered' });
    const f = (await pool.query(`SELECT status, cod_collected_at FROM order_fulfilments WHERE id = $1`, [o.fulfilmentId])).rows[0];
    expect(f.status).toBe('delivered');
    expect(f.cod_collected_at).not.toBeNull();
    const ev = (await pool.query(`SELECT actor_type FROM order_fulfilment_events WHERE fulfilment_id = $1 AND status = 'delivered'`, [o.fulfilmentId])).rows;
    expect(ev[0].actor_type).toBe('rider');
    expect((await loadRiderDrop(token))!.canUpdate).toBe(false);
  });

  test('failed delivery: re-attempt puts an own-rider parcel back on the road; bring back opens a return', async () => {
    const o = await order();
    await move(o.fulfilmentId, 'packed');
    await move(o.fulfilmentId, 'shipped');
    await move(o.fulfilmentId, 'delivery_failed');
    await actOnFailedDelivery({ businessId: B, fulfilmentId: o.fulfilmentId, userId: A, action: 'reattempt', reattemptDate: '2026-10-20' });
    let f = (await pool.query(`SELECT status, ndr_action, ndr_attempts FROM order_fulfilments WHERE id = $1`, [o.fulfilmentId])).rows[0];
    expect(f).toMatchObject({ status: 'shipped', ndr_action: 'reattempt', ndr_attempts: 1 });

    await move(o.fulfilmentId, 'delivery_failed');
    const out = await actOnFailedDelivery({ businessId: B, fulfilmentId: o.fulfilmentId, userId: A, action: 'return_to_origin' });
    f = (await pool.query(`SELECT status FROM order_fulfilments WHERE id = $1`, [o.fulfilmentId])).rows[0];
    expect(f.status).toBe('returned');
    expect(out.returnId).toBeTruthy();
    const r = (await pool.query(`SELECT reason, initiated_by FROM order_returns WHERE id = $1`, [out.returnId])).rows[0];
    expect(r).toMatchObject({ reason: 'not_delivered', initiated_by: 'courier' });
  });

  test('removing an item before packing credits it, restocks it and drops it from the parcel', async () => {
    const o = await order();
    const capBefore = await stock(CAP);
    const capLine = (await pool.query(`SELECT id FROM invoice_items WHERE invoice_id = $1 AND item_id = $2`, [o.invoiceId, CAP])).rows[0].id;
    const out = await tx((c) =>
      removeItemsBeforePacking(c, {
        businessId: B,
        userId: A,
        invoiceId: o.invoiceId,
        fulfilmentIds: [o.fulfilmentId],
        lines: [{ invoice_item_id: capLine, quantity: 1 }],
      }),
    );
    expect(out.creditAmount).toBe(50);
    expect(await stock(CAP)).toBe(capBefore + 1);
    const lines = await loadOrderLineRefs(pool, B, { kind: 'store_order', id: o.id });
    expect(lines.map((l) => l.name)).toEqual(['Shirt']);
    const pick = await buildPickList({ businessId: B, branchIds: null }, [{ source: 'store_order', id: o.id }]);
    expect(pick.items.map((i) => i.name)).toEqual(['Shirt']);

    await move(o.fulfilmentId, 'packed');
    await expect(
      tx((c) =>
        removeItemsBeforePacking(c, { businessId: B, userId: A, invoiceId: o.invoiceId, fulfilmentIds: [o.fulfilmentId], lines: [{ invoice_item_id: capLine, quantity: 1 }] }),
      ),
    ).rejects.toThrow(/already packed/);
  });

  test('COD remittance matches delivered courier parcels and records the shortfall as charges', async () => {
    const a = await order('courier');
    const b = await order('courier');
    for (const o of [a, b]) {
      await move(o.fulfilmentId, 'packed');
      await move(o.fulfilmentId, 'shipped');
      await move(o.fulfilmentId, 'delivered');
    }
    const open = await listOpenCod(pool, B, null);
    expect(open.map((p) => p.id)).toEqual(expect.arrayContaining([a.fulfilmentId, b.fulfilmentId]));

    const rec = await tx((c) =>
      recordRemittance(c, {
        businessId: B,
        userId: A,
        source: 'courier',
        remittedOn: '2026-10-14',
        receivedAmount: 680,
        fulfilmentIds: [a.fulfilmentId, b.fulfilmentId],
      }),
    );
    expect(rec).toMatchObject({ expected: 700, deductions: 20 });
    const after = await listOpenCod(pool, B, null);
    expect(after.some((p) => p.id === a.fulfilmentId || p.id === b.fulfilmentId)).toBe(false);
    await expect(
      tx((c) => recordRemittance(c, { businessId: B, userId: A, source: 'courier', remittedOn: '2026-10-14', receivedAmount: 1, fulfilmentIds: [a.fulfilmentId] })),
    ).rejects.toThrow(/already matched/);
  });
});
