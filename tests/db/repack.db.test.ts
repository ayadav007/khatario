/**
 * Repack on a real database (docs/REPACK_STOCK_DESIGN.md): a retailer opens a 26 kg rice bag and
 * fills 25 one-kg packets. Stock moves at the branch (or warehouse), the 1 kg wastage is recorded
 * with a reason, the whole ₹1,040 goes into the packets (₹41.60 each), no voucher is posted, history
 * names both legs, a repack can be undone while the packets are on the shelf, and packet sales are
 * credited to the rice for the supplier's sold-onward report.
 * Opt-in, disposable DB only:
 *   REPACK_DB_TEST=1 npx jest tests/db/repack.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migrations 391 and 398 are applied in beforeAll.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.REPACK_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/warehouse-access', () => ({
  checkUserWarehouseAccess: jest.fn().mockResolvedValue({ can_create_transactions: true }),
}));
jest.mock('@/lib/branch-access', () => ({
  ...jest.requireActual('@/lib/branch-access'),
  getUserAccessibleBranchIds: jest.fn().mockResolvedValue([]),
}));

import { NextRequest } from 'next/server';
import { closePool, getPool, query, queryOne, queryRows } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { recostItems } from '@/lib/inventory/fifo-recost';
import { SOLD_LINES_SQL } from '@/lib/supplier-sold-lines';
import { repackWastage } from '@/lib/repack-service';
import { GET as repacksGET, POST as repacksPOST } from '@/app/api/inventory-adjustments/repacks/route';
import { GET as repackGET } from '@/app/api/inventory-adjustments/repacks/[id]/route';
import { POST as cancelPOST } from '@/app/api/inventory-adjustments/repacks/[id]/cancel/route';
import { GET as prefillGET } from '@/app/api/inventory-adjustments/repacks/prefill/route';
import { POST as adjustmentPOST } from '@/app/api/inventory-adjustments/route';
import { GET as movementsGET } from '@/app/api/items/[id]/movements/route';

const migration = (file: string) =>
  fs.readFileSync(path.join(__dirname, '../../database/migrations', file), 'utf8');

const run = enabled ? describe : describe.skip;

describe('repackWastage', () => {
  it('is taken out minus packed times content, in source units', () => {
    expect(repackWastage(26, 25, 1)).toEqual({ wastage: 1, percent: 3.8 });
    expect(repackWastage(10, 20, 0.5)).toEqual({ wastage: 0, percent: 0 });
    expect(repackWastage(5, 6, 1).wastage).toBe(-1);
  });
});

run('Repack (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const [A, W, X] = [randomUUID(), randomUUID(), randomUUID()];
  const [UA, UW, UX] = [randomUUID(), randomUUID(), randomUUID()];
  const [BRA, BRW, BRX] = [randomUUID(), randomUUID(), randomUUID()];
  const WH = randomUUID();
  const RICE = randomUUID();
  const PACK = randomUUID();
  const BUNDLE = randomUUID();
  const W_RICE = randomUUID();
  const W_PACK = randomUUID();
  const X_ITEM = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  const headers = (user: string, biz: string) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': user,
    'x-authenticated-business-id': biz,
  });
  const req = (method: string, url: string, user: string, biz: string, body?: object) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: headers(user, biz),
      body: body ? JSON.stringify(body) : undefined,
    });
  const repack = (body: object, user = UA, biz = A) =>
    repacksPOST(req('POST', '/api/inventory-adjustments/repacks', user, biz, body));
  const branchQty = async (item: string, branch = BRA, biz = A) =>
    Number(
      (await queryOne<{ q: string }>(
        `SELECT quantity AS q FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
        [biz, branch, item]
      ))?.q ?? 0
    );

  beforeAll(async () => {
    await query(migration('391_supplier_item_links.sql'));
    await query(migration('398_stock_repacks.sql'));
    for (const [biz, user, branch, name] of [
      [A, UA, BRA, `Repack Grocer ${tag}`],
      [W, UW, BRW, `Repack Depot ${tag}`],
      [X, UX, BRX, `Repack Stranger ${tag}`],
    ] as const) {
      await query(
        `INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '29', 'regular')`,
        [biz, name]
      );
      await query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
         VALUES ($1, $2, 'Main', '29', true, true, true)`,
        [branch, biz]
      );
      await query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
        [user, biz, `9${randomUUID().replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`]
      );
      await query(`SELECT create_default_chart_of_accounts($1)`, [biz]);
    }

    // A: 52 kg of rice opened at ₹40/kg, a counted 1 kg packet item, and a bundle packet.
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, selling_price, purchase_price,
                          opening_stock, opening_stock_rate, current_stock, is_active)
       VALUES ($1, $3, 'Rice', 'KG', 'goods', 50, 40, 52, 40, 52, true),
              ($2, $3, 'Rice 1 kg pack', 'PCS', 'goods', 55, 0, 0, NULL, 0, true)`,
      [RICE, PACK, A]
    );
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, selling_price, is_bundle, is_active)
       VALUES ($1, $2, 'Rice 5 kg combo', 'PCS', 'goods', 260, true, true)`,
      [BUNDLE, A]
    );
    await query(`INSERT INTO bundle_items (bundle_id, item_id, quantity) VALUES ($1, $2, 5)`, [BUNDLE, RICE]);
    await query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 52)`,
      [A, BRA, RICE]
    );

    // W keeps stock in a warehouse.
    await query(
      `INSERT INTO business_settings (business_id, warehouses_enabled) VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = true`,
      [W]
    );
    await query(`INSERT INTO warehouses (id, business_id, name, branch_id) VALUES ($1, $2, 'Godown', $3)`, [WH, W, BRW]);
    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, purchase_price, opening_stock, opening_stock_rate, is_active)
       VALUES ($1, $3, 'Sugar', 'KG', 'goods', 42, 50, 42, true),
              ($2, $3, 'Sugar 500 g pack', 'PCS', 'goods', 0, 0, NULL, true)`,
      [W_RICE, W_PACK, W]
    );
    await query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 50)`, [WH, W_RICE]);

    await query(
      `INSERT INTO items (id, business_id, name, unit, item_type, current_stock, is_active)
       VALUES ($1, $2, 'Not yours', 'KG', 'goods', 100, true)`,
      [X_ITEM, X]
    );
  });

  afterAll(async () => {
    try {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await withLedgerDelete(client, 'tenant_purge', UA, async () => {
          await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[A, W, X]]);
        });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      await query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[A, W, X]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  let firstRepackId = '';

  it('refuses bad input before touching stock', async () => {
    const base = { source_item_id: RICE, packed_item_id: PACK, source_qty: 26, packed_qty: 25, content_per_unit: 1 };

    const noReason = await repack(base);
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).code).toBe('WASTAGE_REASON_REQUIRED');

    const tooMany = await repack({ ...base, packed_qty: 27 });
    expect((await tooMany.json()).code).toBe('NEGATIVE_WASTAGE');

    const short = await repack({ ...base, source_qty: 60, packed_qty: 60 });
    expect((await short.json()).code).toBe('INSUFFICIENT_STOCK');

    const bundle = await repack({ ...base, packed_item_id: BUNDLE, wastage_reason: 'SPILLAGE' });
    expect((await bundle.json()).code).toBe('IS_BUNDLE');

    const noContent = await repack({ ...base, content_per_unit: null, wastage_reason: 'SPILLAGE' });
    expect((await noContent.json()).code).toBe('CONTENT_REQUIRED');

    // Another business's item is not found, whatever business_id the body claims.
    const foreign = await repack({ ...base, source_item_id: X_ITEM, wastage_reason: 'SPILLAGE', business_id: X });
    expect(foreign.status).toBe(404);

    // Repack legs cannot be made through the plain adjustment endpoint.
    const sneaky = await adjustmentPOST(
      req('POST', '/api/inventory-adjustments', UA, A, {
        adjustment_type: 'QUANTITY', item_id: RICE, direction: 'DECREASE', quantity: 1,
        reason_code: 'REPACK_OUT', adjustment_date: today,
      })
    );
    expect(sneaky.status).toBe(400);

    expect(await branchQty(RICE)).toBe(52);
    expect(await queryOne(`SELECT id FROM stock_repacks WHERE business_id = $1`, [A])).toBeNull();
  });

  it('26 kg of rice becomes 25 packets, with 1 kg spillage and the whole cost in the packets', async () => {
    const res = await repack({
      source_item_id: RICE,
      packed_item_id: PACK,
      source_qty: 26,
      packed_qty: 25,
      content_per_unit: 1,
      wastage_reason: 'SPILLAGE',
      business_id: X, // ignored: the session decides the business
      created_by: UX, // ignored
    });
    expect(res.status).toBe(201);
    const { repack: made } = await res.json();
    firstRepackId = made.id;
    expect(made).toMatchObject({ repackNumber: 'RPK-0001', wastageQty: 1, totalCost: 1040, unitCost: 41.6 });

    expect(await branchQty(RICE)).toBe(26);
    expect(await branchQty(PACK)).toBe(25);
    const items = await queryRows<{ id: string; current_stock: string; purchase_price: string; pack_source_item_id: string | null; pack_source_qty: string | null }>(
      `SELECT id, current_stock, purchase_price, pack_source_item_id, pack_source_qty FROM items WHERE id = ANY($1::uuid[])`,
      [[RICE, PACK]]
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(Number(byId.get(RICE)!.current_stock)).toBe(26);
    expect(Number(byId.get(PACK)!.current_stock)).toBe(25);
    expect(Number(byId.get(PACK)!.purchase_price)).toBe(41.6);
    // The packet now remembers what it is packed from.
    expect(byId.get(PACK)!.pack_source_item_id).toBe(RICE);
    expect(Number(byId.get(PACK)!.pack_source_qty)).toBe(1);

    const row = await queryOne<any>(
      `SELECT business_id, created_by, branch_id, status, wastage_qty, wastage_reason, total_cost FROM stock_repacks WHERE id = $1`,
      [made.id]
    );
    expect(row).toMatchObject({ business_id: A, created_by: UA, branch_id: BRA, status: 'posted', wastage_reason: 'SPILLAGE' });

    const legs = await queryRows<{ id: string; reason_code: string; direction: string; quantity_change: string; value_change: string; gst_impact: string }>(
      `SELECT id, reason_code, direction, quantity_change, value_change, gst_impact
         FROM inventory_adjustments WHERE repack_id = $1 ORDER BY reason_code DESC`,
      [made.id]
    );
    expect(legs.map((l) => [l.reason_code, l.direction, Number(l.quantity_change), Number(l.value_change)])).toEqual([
      ['REPACK_OUT', 'DECREASE', -26, -1040],
      ['REPACK_IN', 'INCREASE', 25, 1040],
    ]);
    expect(legs.every((l) => Number(l.gst_impact) === 0)).toBe(true);

    // Inventory moved between items: no voucher, no ITC reversal.
    const lines = await queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_id = ANY($2::uuid[])`,
      [A, legs.map((l) => l.id)]
    );
    expect(Number(lines?.n)).toBe(0);

    // FIFO: the packets hold one lot at ₹41.60; the rice left is still ₹40.
    const costs = await currentUnitCosts(undefined, A, [RICE, PACK], today);
    expect(costs.get(PACK)).toBeCloseTo(41.6, 2);
    expect(costs.get(RICE)).toBeCloseTo(40, 2);

    // A FIFO recost does not invent a correcting entry for the repack's missing voucher.
    const client = await getPool().connect();
    try {
      const report = await recostItems(client, A, [RICE, PACK], { dryRun: true });
      expect(report.changed.filter((c) => legs.some((l) => l.id === c.voucherId))).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('history names both legs and links the repack; the screen opens filled in', async () => {
    const rice = await (await movementsGET(req('GET', `/api/items/${RICE}/movements`, UA, A), { params: { id: RICE } })).json();
    expect(rice.movements[0]).toMatchObject({
      label: 'Repacked into Rice 1 kg pack',
      document_number: 'RPK-0001',
      href: `/inventory-adjustments/repacks/${firstRepackId}`,
      signed_quantity: -26,
    });
    const pack = await (await movementsGET(req('GET', `/api/items/${PACK}/movements`, UA, A), { params: { id: PACK } })).json();
    expect(pack.movements[0]).toMatchObject({ label: 'Repacked from Rice', signed_quantity: 25 });

    const prefill = await (
      await prefillGET(req('GET', `/api/inventory-adjustments/repacks/prefill?item_id=${PACK}&branch_id=${BRA}`, UA, A))
    ).json();
    expect(prefill.source).toMatchObject({ id: RICE, stock: 26 });
    expect(prefill.packed).toMatchObject({ id: PACK, stock: 25 });
    expect(prefill.content_per_unit).toBe(1);
    expect(prefill.last).toMatchObject({ source_qty: 26, packed_qty: 25, wastage_reason: 'SPILLAGE' });

    // From the rice's side the packet is found too.
    const fromRice = await (await prefillGET(req('GET', `/api/inventory-adjustments/repacks/prefill?item_id=${RICE}`, UA, A))).json();
    expect(fromRice.packed?.id).toBe(PACK);

    const list = await (await repacksGET(req('GET', `/api/inventory-adjustments/repacks?item_id=${RICE}`, UA, A))).json();
    expect(list.repacks.map((r: { id: string }) => r.id)).toEqual([firstRepackId]);

    // Another business cannot read it.
    const peek = await repackGET(req('GET', `/api/inventory-adjustments/repacks/${firstRepackId}`, UX, X), {
      params: { id: firstRepackId },
    });
    expect(peek.status).toBe(404);
  });

  it('packet sales are credited to the rice for the supplier', async () => {
    const inv = randomUUID();
    await query(
      `INSERT INTO invoices (id, business_id, invoice_number, invoice_date, status, branch_id, grand_total)
       VALUES ($1, $2, $3, CURRENT_DATE, 'final', $4, 275)`,
      [inv, A, `RPK-INV-${tag}`, BRA]
    );
    await query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit_price, line_total)
       VALUES ($1, $2, 'Rice 1 kg pack', 5, 55, 275)`,
      [inv, PACK]
    );
    const credited = await queryRows<{ item_id: string; amount: string }>(
      `WITH linked AS (SELECT $1::uuid AS customer_id),
            supplied_items AS (SELECT $4::uuid AS item_id, $1::uuid AS customer_id),
            ${SOLD_LINES_SQL}
       SELECT sl.item_id, SUM(sl.amount) AS amount
         FROM sold_lines sl
         JOIN supplied_items si ON si.item_id = sl.item_id AND si.customer_id = sl.customer_id
        GROUP BY sl.item_id`,
      [A, today, today, RICE]
    );
    expect(credited.map((c) => [c.item_id, Number(c.amount)])).toEqual([[RICE, 275]]);
  });

  it('a repack is undone while the packets are on the shelf, and not after they are sold', async () => {
    const res = await cancelPOST(req('POST', `/api/inventory-adjustments/repacks/${firstRepackId}/cancel`, UA, A), {
      params: { id: firstRepackId },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).repack.status).toBe('cancelled');
    expect(await branchQty(RICE)).toBe(52);
    expect(await branchQty(PACK)).toBe(0);
    const costs = await currentUnitCosts(undefined, A, [RICE], today);
    expect(costs.get(RICE)).toBeCloseTo(40, 2);

    const again = await cancelPOST(req('POST', `/api/inventory-adjustments/repacks/${firstRepackId}/cancel`, UA, A), {
      params: { id: firstRepackId },
    });
    expect(again.status).toBe(409);

    const pack = await (await movementsGET(req('GET', `/api/items/${PACK}/movements`, UA, A), { params: { id: PACK } })).json();
    expect(pack.movements[0]).toMatchObject({ label: 'Repack cancelled', signed_quantity: -25 });

    // Second repack, with the saved content; then most packets leave the shelf.
    const second = await repack({ source_item_id: RICE, packed_item_id: PACK, source_qty: 10, packed_qty: 10 });
    expect(second.status).toBe(201);
    const { repack: made } = await second.json();
    expect(made).toMatchObject({ repackNumber: 'RPK-0002', wastageQty: 0, totalCost: 400 });
    await query(
      `UPDATE branch_item_stock SET quantity = 3 WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
      [A, BRA, PACK]
    );
    const late = await cancelPOST(req('POST', `/api/inventory-adjustments/repacks/${made.id}/cancel`, UA, A), {
      params: { id: made.id },
    });
    expect(late.status).toBe(409);
    expect((await late.json()).code).toBe('PACKED_STOCK_SHORT');
  });

  it('works in a warehouse, and asks for the warehouse', async () => {
    const body = { source_item_id: W_RICE, packed_item_id: W_PACK, source_qty: 10, packed_qty: 19, content_per_unit: 0.5, wastage_reason: 'PACKAGING' };
    const noPlace = await repack(body, UW, W);
    expect((await noPlace.json()).code).toBe('LOCATION_REQUIRED');

    const res = await repack({ ...body, location_id: WH }, UW, W);
    expect(res.status).toBe(201);
    const { repack: made } = await res.json();
    expect(made).toMatchObject({ wastageQty: 0.5, totalCost: 420 });
    expect(made.unitCost).toBeCloseTo(22.11, 2);

    const stock = await queryRows<{ item_id: string; q: string }>(
      `SELECT item_id, current_stock_qty AS q FROM location_stock WHERE location_id = $1`,
      [WH]
    );
    const q = new Map(stock.map((s) => [s.item_id, Number(s.q)]));
    expect(q.get(W_RICE)).toBe(40);
    expect(q.get(W_PACK)).toBe(19);
    const row = await queryOne<{ location_id: string; branch_id: string }>(
      `SELECT location_id, branch_id FROM stock_repacks WHERE id = $1`,
      [made.id]
    );
    expect(row).toEqual({ location_id: WH, branch_id: BRW });
  });
});
