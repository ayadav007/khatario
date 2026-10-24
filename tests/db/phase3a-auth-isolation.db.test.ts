/**
 * Phase 3A baseline: authentication, tenant isolation, role permission, and subscription gates
 * for invoices, customers, items, suppliers, purchases, payments, inventory adjustments,
 * and stock transfers. Does not stub authorize or module access.
 * Connects only after current_database() is kh_phase2_test on localhost.
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing Phase 3A tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing Phase 3A tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __p3aHeaders: typeof headerBag }).__p3aHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __p3aHeaders: { current: Record<string, string> } }).__p3aHeaders.current[
        name.toLowerCase()
      ] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn(async () => undefined) }));

import { getPool, closePool } from '@/lib/db';
import { middleware } from '../../middleware';
import { GET as listInvoices, POST as postInvoice } from '@/app/api/invoices/route';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';
import { GET as listCustomers } from '@/app/api/customers/route';
import { GET as getCustomer, PUT as putCustomer } from '@/app/api/customers/[id]/route';
import { GET as listItems } from '@/app/api/items/route';
import { GET as getItem, DELETE as deleteItem } from '@/app/api/items/[id]/route';
import { GET as listSuppliers } from '@/app/api/suppliers/route';
import { GET as getSupplier } from '@/app/api/suppliers/[id]/route';
import { GET as listPurchases } from '@/app/api/purchases/route';
import { GET as getPurchase } from '@/app/api/purchases/[id]/route';
import { GET as listPayments } from '@/app/api/payments/route';
import { GET as getPayment } from '@/app/api/payments/[id]/route';
import { GET as listAdjustments } from '@/app/api/inventory-adjustments/route';
import { GET as getAdjustment } from '@/app/api/inventory-adjustments/[id]/route';
import { GET as listTransfers } from '@/app/api/stock-transfers/route';

const lists = [
  ['invoices', listInvoices],
  ['customers', listCustomers],
  ['items', listItems],
  ['suppliers', listSuppliers],
  ['purchases', listPurchases],
  ['payments', listPayments],
  ['inventory-adjustments', listAdjustments],
  ['stock-transfers', listTransfers],
] as const;

describe('Phase 3A auth, isolation, permission, and subscription', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const ownerA = randomUUID();
  const readerA = randomUUID();
  const ownerB = randomUUID();
  const ownerC = randomUUID();
  const roleRead = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const invoiceA = randomUUID();
  const invoiceB = randomUUID();
  const purchaseA = randomUUID();
  const purchaseB = randomUUID();
  const paymentA = randomUUID();
  const paymentB = randomUUID();
  const tag = A.slice(0, 8);
  const markA = `P3A-A-${tag}`;
  const markB = `P3A-B-${tag}`;
  let adjustmentFeature = false;
  let warehouseFeature = false;

  function session(userId: string, businessId: string, version = '1') {
    headerBag.current = {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': version,
    };
  }

  function clearSession() {
    headerBag.current = {};
  }

  async function call(res: Response) {
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json, text };
  }

  async function effects(businessId: string) {
    const row = await pool.query<{ invoices: string; ledger: string; moves: string }>(
      `SELECT
         (SELECT COUNT(*) FROM invoices WHERE business_id = $1) AS invoices,
         (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1) AS ledger,
         (SELECT COUNT(*) FROM stock_movements WHERE business_id = $1) AS moves`,
      [businessId],
    );
    return row.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (
      info.db !== 'kh_phase2_test' ||
      info.port !== 5433 ||
      (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))
    ) {
      throw new Error(`Refusing Phase 3A tests against ${info.db} at ${info.addr}:${info.port}`);
    }

    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE feature_id = 'reports_basic' AND enabled = true
        ORDER BY plan_id LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No enabled reports_basic plan in kh_phase2_test');
    const planId = plan.rows[0].plan_id;
    adjustmentFeature = (
      await pool.query(
        `SELECT 1 FROM subscription_plan_features
          WHERE plan_id = $1 AND feature_id = 'purchase_inventory_adjustments' AND enabled = true`,
        [planId],
      )
    ).rowCount > 0;
    warehouseFeature = (
      await pool.query(
        `SELECT 1 FROM subscription_plan_features
          WHERE plan_id = $1 AND feature_id = 'settings_multi_warehouse' AND enabled = true`,
        [planId],
      )
    ).rowCount > 0;

    for (const key of ['items', 'customers', 'invoices', 'purchases', 'payments', 'suppliers']) {
      await pool.query(
        `INSERT INTO permission_modules (module_key, module_name, is_active)
         VALUES ($1, $1, true) ON CONFLICT (module_key) DO NOTHING`,
        [key],
      );
    }

    for (const [id, name] of [
      [A, `P3A A ${tag}`],
      [B, `P3A B ${tag}`],
      [C, `P3A C ${tag}`],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
        [id, name],
      );
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, is_default, is_active) VALUES
         ($1, $3, 'Main', true, true),
         ($2, $4, 'Main', true, true)`,
      [branchA, branchB, A, B],
    );
    for (const id of [A, B]) {
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
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role)
       VALUES ($1, $2, 'Read only', 'p3a_read', false)`,
      [roleRead, A],
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, 'items', true, false, false, false, false),
              ($1, 'customers', true, false, false, false, false)`,
      [roleRead],
    );
    const phone = Date.now().toString().slice(-7);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, auth_session_version, is_active)
       VALUES ($1, $5, 'Owner A', $6, true, NULL, 1, true),
              ($2, $5, 'Reader A', $7, false, $8, 1, true),
              ($3, $9, 'Owner B', $10, true, NULL, 1, true),
              ($4, $11, 'Owner C', $12, true, NULL, 1, true)`,
      [ownerA, readerA, ownerB, ownerC, A, `71${phone}1`, `71${phone}2`, roleRead, B, `71${phone}3`, C, `71${phone}4`],
    );
    await pool.query(
      `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
       VALUES ($1, $2, true, false, false, false)`,
      [readerA, branchA],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, is_active) VALUES
         ($1, $3, $4, true),
         ($2, $5, $6, true)`,
      [customerA, customerB, A, markA, B, markB],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active) VALUES
         ($1, $3, $4, 'goods', 'PCS', 10, true),
         ($2, $5, $6, 'goods', 'PCS', 10, true)`,
      [itemA, itemB, A, markA, B, markB],
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name) VALUES ($1, $3, $4), ($2, $5, $6)`,
      [supplierA, supplierB, A, markA, B, markB],
    );
    for (const [id, biz, branch, num] of [
      [invoiceA, A, branchA, `A-${tag}`],
      [invoiceB, B, branchB, `B-${tag}`],
    ] as const) {
      await pool.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
            payment_status, branch_id)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '27', 10, 0, 10, 0, 10, 'unpaid', $5)`,
        [id, biz, biz === A ? customerA : customerB, num, branch],
      );
    }
    for (const [id, biz, branch, supplier, num] of [
      [purchaseA, A, branchA, supplierA, `PA-${tag}`],
      [purchaseB, B, branchB, supplierB, `PB-${tag}`],
    ] as const) {
      await pool.query(
        `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status,
            place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
            payment_status, branch_id)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', '27', 10, 0, 10, 0, 10, 'unpaid', $5)`,
        [id, biz, supplier, num, branch],
      );
    }
    for (const [id, biz, branch, customer] of [
      [paymentA, A, branchA, customerA],
      [paymentB, B, branchB, customerB],
    ] as const) {
      await pool.query(
        `INSERT INTO payments (id, business_id, branch_id, type, customer_id, amount, payment_mode, payment_date)
         VALUES ($1, $2, $3, 'receivable', $4, 10, 'cash', CURRENT_DATE)`,
        [id, biz, branch, customer],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      for (const id of [A, B, C]) {
        await pool.query(`DELETE FROM payments WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM purchases WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await pool.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM user_roles WHERE business_id = $1)`, [id]);
        await pool.query(`DELETE FROM user_roles WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
    } finally {
      await closePool();
    }
  });

  test('middleware rejects unauthenticated calls and ignores spoofed identity headers', async () => {
    for (const [name] of lists) {
      const req = new NextRequest(`https://app.khatario.test/api/${name}`, {
        headers: {
          host: 'app.khatario.test',
          'x-authenticated-user-id': ownerA,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
      });
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).not.toContain(markB);
    }
  });

  test('handlers without a session do not return business data', async () => {
    clearSession();
    for (const [name, handler] of lists) {
      const res = await call(await handler(new NextRequest(`http://localhost/api/${name}`)));
      expect(res.status).not.toBe(200);
      expect(res.text).not.toContain(markA);
      expect(res.text).not.toContain(markB);
    }
  });

  test('a session for business A ignores a client business_id for business B', async () => {
    session(ownerA, A);
    const beforeA = await effects(A);
    const beforeB = await effects(B);
    for (const [name, handler] of lists) {
      const res = await call(
        await handler(
          new NextRequest(`http://localhost/api/${name}?business_id=${B}&user_id=${ownerB}`, {
            headers: headerBag.current,
          }),
        ),
      );
      expect(res.text).not.toContain(markB);
      if (res.status === 200 && (name === 'customers' || name === 'items' || name === 'invoices' || name === 'suppliers')) {
        expect(res.text).toContain(markA);
      }
    }
    expect(await effects(A)).toEqual(beforeA);
    expect(await effects(B)).toEqual(beforeB);
  });

  test('legacy query identity without a session cannot read the other business', async () => {
    clearSession();
    const sessionRequired = new Set(['invoices', 'items', 'purchases', 'payments']);
    for (const [name, handler] of lists) {
      const res = await call(
        await handler(
          new NextRequest(`http://localhost/api/${name}?business_id=${B}&user_id=${ownerA}`, {
            headers: { 'x-user-id': ownerB, 'x-authenticated-user-id': '' },
          }),
        ),
      );
      if (sessionRequired.has(name)) {
        expect(res.status).toBe(401);
      }
      expect(res.text).not.toContain(markB);
    }
    headerBag.current = {
      'x-authenticated-user-id': ownerA,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
    for (const name of sessionRequired) {
      const handler = lists.find(([route]) => route === name)?.[1];
      if (!handler) throw new Error(name);
      const res = await call(
        await handler(
          new NextRequest(`http://localhost/api/${name}?business_id=${B}&user_id=${ownerB}&page=1&limit=5`, {
            headers: headerBag.current,
          }),
        ),
      );
      expect(res.status).toBe(403);
      expect(res.text).not.toContain(markB);
    }
    const item = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at::text FROM items WHERE id = $1`,
      [itemB],
    );
    expect(item.rows[0].deleted_at).toBeNull();
  });

  test('opening another business record by id does not return it', async () => {
    session(ownerA, A);
    const reads: Array<[string, () => Promise<Response>]> = [
      ['invoice', () => getInvoice(new NextRequest(`http://localhost/api/invoices/${invoiceB}`, { headers: headerBag.current }), { params: { id: invoiceB } })],
      ['customer', () => getCustomer(new NextRequest(`http://localhost/api/customers/${customerB}`, { headers: headerBag.current }), { params: { id: customerB } })],
      ['item', () => getItem(new NextRequest(`http://localhost/api/items/${itemB}`, { headers: headerBag.current }), { params: { id: itemB } })],
      ['supplier', () => getSupplier(new NextRequest(`http://localhost/api/suppliers/${supplierB}`, { headers: headerBag.current }), { params: { id: supplierB } })],
      ['purchase', () => getPurchase(new NextRequest(`http://localhost/api/purchases/${purchaseB}`, { headers: headerBag.current }), { params: { id: purchaseB } })],
      ['payment', () => getPayment(new NextRequest(`http://localhost/api/payments/${paymentB}`, { headers: headerBag.current }), { params: { id: paymentB } })],
    ];
    for (const [, run] of reads) {
      const res = await call(await run());
      expect(res.status).not.toBe(200);
      expect(res.text).not.toContain(markB);
    }
    const own = await call(
      await getCustomer(new NextRequest(`http://localhost/api/customers/${customerA}`, { headers: headerBag.current }), {
        params: { id: customerA },
      }),
    );
    expect(own.status).toBe(200);
    expect(own.text).toContain(markA);
  });

  test('a stale session version is rejected and a foreign customer update does not apply', async () => {
    const before = await pool.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerB]);
    session(ownerA, A, '999');
    const stale = await call(
      await getCustomer(new NextRequest(`http://localhost/api/customers/${customerA}`, { headers: headerBag.current }), {
        params: { id: customerA },
      }),
    );
    expect(stale.status).toBe(401);
    expect(stale.json.code).toBe('SESSION_REVOKED');

    session(ownerA, A);
    const foreign = await call(
      await putCustomer(
        new NextRequest(`http://localhost/api/customers/${customerB}`, {
          method: 'PUT',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'stolen', business_id: B, user_id: ownerB }),
        }),
        { params: { id: customerB } },
      ),
    );
    expect(foreign.status).not.toBe(200);
    expect((await pool.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerB])).rows[0].name).toBe(
      before.rows[0].name,
    );
  });

  test('deleting another business item does not change it, including a body business_id', async () => {
    session(ownerA, A);
    const res = await call(
      await deleteItem(
        new NextRequest(`http://localhost/api/items/${itemB}`, {
          method: 'DELETE',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({ business_id: B, user_id: ownerA }),
        }),
        { params: { id: itemB } },
      ),
    );
    expect(res.status).not.toBe(200);
    const row = await pool.query<{ deleted_at: string | null; name: string }>(
      `SELECT name, deleted_at::text FROM items WHERE id = $1`,
      [itemB],
    );
    expect(row.rows[0].name).toBe(markB);
    expect(row.rows[0].deleted_at).toBeNull();
  });

  test('posting an invoice for the other business customer creates nothing', async () => {
    session(ownerA, A);
    const before = await effects(A);
    const beforeB = await effects(B);
    const res = await call(
      await postInvoice(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({
            business_id: B,
            customer_id: customerB,
            created_by: ownerB,
            invoice_date: '2026-10-15',
            items: [{ item_id: itemB, quantity: 1, unit_price: 10 }],
          }),
        }),
      ),
    );
    expect(res.status).not.toBe(201);
    expect(res.text).not.toContain(markB);
    expect(await effects(A)).toEqual(before);
    expect(await effects(B)).toEqual(beforeB);
  });

  test('a read-only user can read items and cannot change a customer or post an invoice', async () => {
    session(readerA, A);
    const items = await call(
      await listItems(
        new NextRequest(
          `http://localhost/api/items?search=${encodeURIComponent(markA)}&item_type=goods&page=1&limit=5`,
          { headers: headerBag.current },
        ),
      ),
    );
    expect(items.status).toBe(200);
    expect(items.text).toContain(markA);
    expect(items.text).not.toContain(markB);

    const invoices = await call(
      await listInvoices(new NextRequest('http://localhost/api/invoices', { headers: headerBag.current })),
    );
    expect(invoices.status).toBe(403);

    const before = await pool.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerA]);
    const update = await call(
      await putCustomer(
        new NextRequest(`http://localhost/api/customers/${customerA}`, {
          method: 'PUT',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'renamed by reader', user_id: ownerA }),
        }),
        { params: { id: customerA } },
      ),
    );
    expect(update.status).toBe(403);
    expect((await pool.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerA])).rows[0].name).toBe(
      before.rows[0].name,
    );

    const beforeEffects = await effects(A);
    const post = await call(
      await postInvoice(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({
            customer_id: customerA,
            invoice_date: '2026-10-15',
            items: [{ item_id: itemA, quantity: 1, unit_price: 10 }],
          }),
        }),
      ),
    );
    expect(post.status).not.toBe(201);
    expect(await effects(A)).toEqual(beforeEffects);
  });

  test('a primary admin without a billing subscription cannot list items', async () => {
    session(ownerC, C);
    const res = await call(await listItems(new NextRequest('http://localhost/api/items', { headers: headerBag.current })));
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain(markA);
    expect(res.text).not.toContain(markB);
  });

  test('inventory adjustment and stock transfer reads follow the plan feature', async () => {
    session(ownerA, A);
    const adjustment = await call(
      await listAdjustments(new NextRequest('http://localhost/api/inventory-adjustments', { headers: headerBag.current })),
    );
    const transfer = await call(
      await listTransfers(new NextRequest('http://localhost/api/stock-transfers', { headers: headerBag.current })),
    );
    const foreignAdjustment = await call(
      await getAdjustment(
        new NextRequest(`http://localhost/api/inventory-adjustments/${randomUUID()}?business_id=${B}`, {
          headers: headerBag.current,
        }),
        { params: { id: randomUUID() } },
      ),
    );
    expect(adjustment.text).not.toContain(markB);
    expect(transfer.text).not.toContain(markB);
    expect(foreignAdjustment.text).not.toContain(markB);
    if (!adjustmentFeature) expect(adjustment.status).not.toBe(200);
    if (!warehouseFeature) expect(transfer.status).not.toBe(200);
    if (adjustmentFeature) expect(adjustment.status).toBe(200);
    if (warehouseFeature) expect(transfer.status).toBe(200);
  });
});
