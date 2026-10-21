/**
 * Phase 3I: first write-isolation batch after Phase 3H.
 * Does not stub authorize. Connects only after current_database() is kh_phase2_test on localhost.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing Phase 3I tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) throw new Error('Refusing Phase 3I tests: local database credentials are missing');
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __p3iHeaders: typeof headerBag }).__p3iHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __p3iHeaders: { current: Record<string, string> } }).__p3iHeaders.current[name.toLowerCase()] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn(async () => undefined) }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { middleware } from '../../middleware';
import { POST as postSupplier } from '@/app/api/suppliers/route';
import { POST as postItem } from '@/app/api/items/route';
import { POST as postPurchaseOrder } from '@/app/api/purchase-orders/route';
import { POST as postAdjustment } from '@/app/api/inventory-adjustments/route';
import { PUT as putCustomer } from '@/app/api/customers/[id]/route';

describe('Phase 3I write identity', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const staffA = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();
  const tag = A.slice(0, 8);
  const markA = `P3I-A-${tag}`;
  const markB = `P3I-B-${tag}`;

  function session(userId: string, businessId: string, version = '1') {
    return {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': version,
    };
  }

  async function send(
    handler: (request: NextRequest, context?: { params: { id: string } }) => Promise<Response>,
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
    method: 'POST' | 'PUT' = 'POST',
  ) {
    headerBag.current = headers;
    let res: Response;
    try {
      res = await handler(
      new NextRequest(
        `http://localhost/api/${path}?business_id=${encodeURIComponent(String(body.business_id || ''))}&user_id=${encodeURIComponent(String(body.user_id || ''))}`,
        {
          method,
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
      path.startsWith('customers/') ? { params: { id: path.split('/')[1] } } : undefined,
    );
    } catch (error) {
      return { status: 0, text: error instanceof Error ? error.message : String(error) };
    }
    return { status: res.status, text: await res.text() };
  }

  function bodyFor(kind: string, businessId: string, userId: string, mark: string) {
    const common = { business_id: businessId, user_id: userId, created_by: userId, created_by_user_id: userId };
    if (kind === 'suppliers') return { ...common, name: mark };
    if (kind === 'items') return { ...common, name: mark, selling_price: 10 };
    if (kind === 'purchase-orders') {
      return {
        ...common,
        supplier_id: businessId === A ? supplierA : supplierB,
        order_number: `${mark}-${randomUUID().slice(0, 6)}`,
        order_date: '2026-10-19',
        items: [{ item_name: mark, qty: 1, unit_price: 5 }],
      };
    }
    return {
      ...common,
      adjustment_type: 'QUANTITY',
      item_id: businessId === A ? itemA : itemB,
      branch_id: businessId === A ? branchA : branchB,
      direction: 'INCREASE',
      quantity: 1,
      reason_code: 'STOCK_TAKE',
      adjustment_date: '2026-10-19',
    };
  }

  async function counts(businessId: string) {
    const row = await pool.query<{
      suppliers: string;
      items: string;
      orders: string;
      adjustments: string;
      stock: string;
      ledger: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM suppliers WHERE business_id = $1)::text AS suppliers,
         (SELECT COUNT(*) FROM items WHERE business_id = $1)::text AS items,
         (SELECT COUNT(*) FROM purchase_orders WHERE business_id = $1)::text AS orders,
         (SELECT COUNT(*) FROM inventory_adjustments WHERE business_id = $1)::text AS adjustments,
         (SELECT COUNT(*) FROM stock_movements WHERE business_id = $1)::text AS stock,
         (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1)::text AS ledger`,
      [businessId],
    );
    return row.rows[0];
  }

  async function customerName() {
    const row = await pool.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerB]);
    return row.rows[0]?.name ?? '';
  }

  async function purge(ids: string[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'admin:seed_demo', null, async () => {
        await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
      });
      await client.query(`DELETE FROM stock_movements WHERE business_id = ANY($1::uuid[]) OR created_by IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[]))`, [ids]);
      await client.query(`DELETE FROM inventory_adjustments WHERE business_id = ANY($1::uuid[]) OR created_by IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[]))`, [ids]);
      await client.query(
        `DELETE FROM purchase_order_items WHERE purchase_order_id IN (
           SELECT id FROM purchase_orders
            WHERE business_id = ANY($1::uuid[])
               OR created_by IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[]))
         )`,
        [ids],
      );
      await client.query(
        `DELETE FROM purchase_orders
          WHERE business_id = ANY($1::uuid[])
             OR created_by IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[]))`,
        [ids],
      );
      for (const id of ids) {
        await client.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await client.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM accounts WHERE business_id = $1`, [id]).catch(() => undefined);
        await client.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))) {
      throw new Error(`Refusing Phase 3I tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN (
          'purchase_suppliers','purchase_management','purchase_inventory_adjustments','item_management'
        )
        GROUP BY plan_id
        ORDER BY COUNT(DISTINCT feature_id) DESC
        LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No subscription plan');
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'P3I %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
    const planId = plan.rows[0].plan_id;
    for (const [id, name] of [
      [A, `P3I A ${tag}`],
      [B, `P3I B ${tag}`],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
        [id, name],
      );
      await pool.query(
        `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
        [id],
      );
      await pool.query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
         VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
        [id, planId],
      );
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, is_default, is_active) VALUES
         ($1, $3, 'Main', true, true), ($2, $4, 'Main', true, true)`,
      [branchA, branchB, A, B],
    );
    const phone = Date.now().toString().slice(-7);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $3, 'Owner A', $4, true, 1, true), ($2, $5, 'Owner B', $6, true, 1, true),
              ($7, $3, 'Staff A', $8, false, 1, true)`,
      [ownerA, ownerB, A, `76${phone}1`, B, `76${phone}2`, staffA, `76${phone}3`],
    );
    await pool.query(
      `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
       VALUES ($1, $2, true, true, true, true), ($3, $4, true, true, true, true)`,
      [ownerA, branchA, ownerB, branchB],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, is_active) VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
      [customerB, B, markB, customerA, A, markA],
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, is_active) VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
      [supplierA, A, markA, supplierB, B, markB],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active)
       VALUES ($1, $2, $3, 'goods', 'PCS', 8, true), ($4, $5, $6, 'goods', 'PCS', 9, true)`,
      [itemA, A, markA, itemB, B, markB],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await purge([A, B]);
    } finally {
      await closePool();
    }
  });

  const writers = [
    ['suppliers', postSupplier],
    ['items', postItem],
    ['purchase-orders', postPurchaseOrder],
    ['inventory-adjustments', postAdjustment],
  ] as const;

  test('middleware rejects these writes without a cookie', async () => {
    headerBag.current = {};
    for (const [name] of writers) {
      const res = await middleware(
        new NextRequest(`https://app.khatario.test/api/${name}`, {
          method: 'POST',
          headers: {
            host: 'app.khatario.test',
            'content-type': 'application/json',
            'x-authenticated-user-id': ownerB,
            'x-authenticated-business-id': B,
          },
          body: JSON.stringify({ business_id: B, user_id: ownerB }),
        }),
      );
      expect(res.status).toBe(401);
    }
    const patch = await middleware(
      new NextRequest(`https://app.khatario.test/api/customers/${customerB}`, {
        method: 'PUT',
        headers: { host: 'app.khatario.test', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'changed', business_id: B, user_id: ownerB }),
      }),
    );
    expect(patch.status).toBe(401);
  });

  test('forged identity does not create or change business B', async () => {
    const before = await counts(B);
    const nameBefore = await customerName();
    const created: string[] = [];
    const seen: string[] = [];
    const attacks: Array<[string, Record<string, string>, string]> = [
      ['no session, user B body', {}, ownerB],
      ['user A headers with business B', session(ownerA, B), ownerA],
      ['user A header only', { 'x-authenticated-user-id': ownerA, 'x-authenticated-session-version': '1' }, ownerA],
      ['user B header only', { 'x-authenticated-user-id': ownerB, 'x-authenticated-session-version': '1' }, ownerB],
    ];
    for (const [label, headers, userId] of attacks) {
      for (const [name, handler] of writers) {
        const beforeOne = await counts(B);
        const res = await send(handler, name, bodyFor(name, B, userId, markB), headers);
        const afterOne = await counts(B);
        const denied = res.status === 401 || res.status === 403;
        const wrote = JSON.stringify(beforeOne) !== JSON.stringify(afterOne) || res.status === 201;
        const line = `${label} | ${name} HTTP ${res.status}${wrote ? ' WROTE ' + JSON.stringify(afterOne) : ''}`;
        seen.push(line);
        if (!denied || wrote) created.push(line);
      }
      const patch = await send(
        putCustomer,
        `customers/${customerB}`,
        { name: `${markB}-hacked`, business_id: B, user_id: userId, updated_by: userId },
        headers,
        'PUT',
      );
      const renamed = (await customerName()) !== nameBefore;
      const denied = patch.status === 401 || patch.status === 403;
      const line = `${label} | PUT customers HTTP ${patch.status}${renamed ? ' RENAMED' : ''}`;
      seen.push(line);
      if (!denied || renamed) created.push(line);
    }
    if (created.length || JSON.stringify(await counts(B)) !== JSON.stringify(before) || (await customerName()) !== nameBefore) {
      throw new Error(`${created.join('\n')}\n---\n${seen.join('\n')}`);
    }
  });

  test('a valid session for A with a forged body does not write business B', async () => {
    const beforeB = await counts(B);
    const nameBefore = await customerName();
    for (const [name, handler] of writers) {
      await send(handler, name, bodyFor(name, B, ownerB, markB), session(ownerA, A));
    }
    await send(
      putCustomer,
      `customers/${customerB}`,
      { name: `${markB}-hacked`, business_id: B, user_id: ownerB },
      session(ownerA, A),
      'PUT',
    );
    expect(await counts(B)).toEqual(beforeB);
    expect(await customerName()).toBe(nameBefore);
  });

  test('a stale session does not write', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    for (const [name, handler] of writers) {
      const res = await send(handler, name, bodyFor(name, A, ownerA, markA), session(ownerA, A, '999'));
      expect(res.status).toBe(401);
    }
    const put = await send(
      putCustomer,
      `customers/${customerB}`,
      { name: `${markB}-stale`, business_id: B, user_id: ownerB },
      session(ownerA, A, '999'),
      'PUT',
    );
    expect(put.status).toBe(401);
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a valid session can create a supplier and an item for its own business', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const supplier = await send(
      postSupplier,
      'suppliers',
      { name: `${markA}-new`, business_id: B, user_id: ownerA, created_by: ownerA },
      session(ownerA, A),
    );
    const item = await send(
      postItem,
      'items',
      { name: `${markA}-item`, business_id: B, user_id: ownerA, created_by: ownerA, selling_price: 4 },
      session(ownerA, A),
    );
    expect(supplier.status).toBe(201);
    expect(item.status).toBe(201);
    const afterA = await counts(A);
    expect(Number(afterA.suppliers)).toBe(Number(beforeA.suppliers) + 1);
    expect(Number(afterA.items)).toBe(Number(beforeA.items) + 1);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a purchase order does not keep another business supplier', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const res = await send(
      postPurchaseOrder,
      'purchase-orders',
      {
        ...bodyFor('purchase-orders', A, ownerA, `${markA}-po`),
        supplier_id: supplierB,
        business_id: A,
      },
      session(ownerA, A),
    );
    const linked = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2`,
      [A, supplierB],
    );
    expect(res.status).toBe(400);
    expect(linked.rows[0].n).toBe('0');
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('an adjustment does not use another business item', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const res = await send(
      postAdjustment,
      'inventory-adjustments',
      { ...bodyFor('inventory-adjustments', A, ownerA, markA), item_id: itemB },
      session(ownerA, A),
    );
    expect(res.status).toBe(400);
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a valid session can create a purchase order, an adjustment, and update its own customer', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const order = await send(
      postPurchaseOrder,
      'purchase-orders',
      { ...bodyFor('purchase-orders', A, ownerA, `${markA}-own`), business_id: B, supplier_id: supplierA },
      session(ownerA, A),
    );
    const adjustment = await send(
      postAdjustment,
      'inventory-adjustments',
      { ...bodyFor('inventory-adjustments', A, ownerA, markA), business_id: B, item_id: itemA },
      session(ownerA, A),
    );
    const updated = await send(
      putCustomer,
      `customers/${customerA}`,
      { name: `${markA}-renamed`, business_id: B, user_id: ownerB },
      session(ownerA, A),
      'PUT',
    );
    expect(order.status).toBe(201);
    expect(adjustment.status).toBe(201);
    expect(updated.status).toBe(200);
    const afterA = await counts(A);
    expect(Number(afterA.orders)).toBe(Number(beforeA.orders) + 1);
    expect(Number(afterA.adjustments)).toBe(Number(beforeA.adjustments) + 1);
    expect(Number(afterA.stock)).toBeGreaterThan(Number(beforeA.stock));
    const name = await pool.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerA]);
    expect(name.rows[0].name).toBe(`${markA}-renamed`);
    expect(await counts(B)).toEqual(beforeB);
    expect(await customerName()).toBe(markB);
  });

  test('a user without create permission cannot write', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const nameBefore = await customerName();
    for (const [name, handler] of writers) {
      const res = await send(handler, name, bodyFor(name, A, staffA, `${markA}-staff`), session(staffA, A));
      expect(res.status).toBe(403);
    }
    const put = await send(
      putCustomer,
      `customers/${customerA}`,
      { name: `${markA}-staff`, business_id: A },
      session(staffA, A),
      'PUT',
    );
    expect(put.status).toBe(403);
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
    expect(await customerName()).toBe(nameBefore);
  });

  test('a cancelled billing subscription cannot create a supplier', async () => {
    const beforeA = await counts(A);
    await pool.query(
      `UPDATE business_module_subscriptions SET status = 'cancelled' WHERE business_id = $1 AND module_key = 'billing'`,
      [A],
    );
    try {
      const res = await send(
        postSupplier,
        'suppliers',
        { name: `${markA}-plan`, business_id: A, created_by: ownerA },
        session(ownerA, A),
      );
      expect(res.status).toBe(403);
      expect(await counts(A)).toEqual(beforeA);
    } finally {
      await pool.query(
        `UPDATE business_module_subscriptions SET status = 'active' WHERE business_id = $1 AND module_key = 'billing'`,
        [A],
      );
    }
  });
});
