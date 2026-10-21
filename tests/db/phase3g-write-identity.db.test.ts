/**
 * Phase 3G POST identity checks, kept as regression after the Phase 3H fix.
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
    throw new Error('Refusing Phase 3G tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) throw new Error('Refusing Phase 3G tests: local database credentials are missing');
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __p3gHeaders: typeof headerBag }).__p3gHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __p3gHeaders: { current: Record<string, string> } }).__p3gHeaders.current[name.toLowerCase()] ?? null,
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
import { POST as postCreditNote } from '@/app/api/credit-notes/route';
import { POST as postExpense } from '@/app/api/expenses/route';
import { POST as postDebitNote } from '@/app/api/debit-notes/route';
import { POST as postEstimate } from '@/app/api/estimates/route';
import { POST as postSalesOrder } from '@/app/api/sales-orders/route';
import { POST as postCustomer } from '@/app/api/customers/route';

const writers = [
  ['credit-notes', postCreditNote],
  ['expenses', postExpense],
  ['debit-notes', postDebitNote],
  ['estimates', postEstimate],
  ['sales-orders', postSalesOrder],
  ['customers', postCustomer],
] as const;

describe('Phase 3G POST identity', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const supplierB = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();
  const staffA = randomUUID();
  const invoiceB = randomUUID();
  const categoryA = randomUUID();
  const categoryB = randomUUID();
  const tag = A.slice(0, 8);
  const markA = `P3G-A-${tag}`;
  const markB = `P3G-B-${tag}`;

  function session(userId: string, businessId: string, version = '1') {
    return {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': version,
    };
  }

  async function send(
    handler: (request: NextRequest) => Promise<Response>,
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) {
    headerBag.current = headers;
    const res = await handler(
        new NextRequest(`http://localhost/api/${path}?business_id=${encodeURIComponent(String(body.business_id || ''))}&user_id=${encodeURIComponent(String(body.user_id || ''))}&created_by=${encodeURIComponent(String(body.created_by || ''))}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, text: await res.text() };
  }

  function bodyFor(path: string, businessId: string, userId: string, customerId: string, mark: string) {
    const common = { business_id: businessId, user_id: userId, created_by: userId };
    if (path === 'customers') return { ...common, name: mark };
    if (path === 'expenses') {
      return {
        ...common,
        branch_id: businessId === B ? branchB : branchA,
        category_id: businessId === B ? categoryB : categoryA,
        idempotency_key: randomUUID(),
        amount: 12,
        expense_date: '2026-10-19',
        payment_mode: 'cash',
        description: mark,
        supplier_id: supplierB,
      };
    }
    if (path === 'estimates') {
      return {
        ...common,
        customer_id: customerId,
        estimate_number: `${mark}-${randomUUID().slice(0, 6)}`,
        estimate_date: '2026-10-19',
        items: [{ description: mark, qty: 1, unit_price: 10, line_total: 10 }],
        subtotal: 10,
        grand_total: 10,
      };
    }
    if (path === 'sales-orders') {
      return {
        ...common,
        branch_id: businessId === B ? branchB : branchA,
        customer_id: customerId,
        order_number: `${mark}-${randomUUID().slice(0, 6)}`,
        order_date: '2026-10-19',
        items: [{ item_id: itemB, item_name: mark, description: mark, qty: 1, unit_price: 9 }],
      };
    }
    if (path === 'credit-notes') {
      return {
        ...common,
        branch_id: businessId === B ? branchB : branchA,
        customer_id: customerId,
        invoice_id: invoiceB,
        credit_note_number: `${mark}-${randomUUID().slice(0, 6)}`,
        credit_note_date: '2026-10-19',
        items: [{ item_id: itemB, description: mark, qty: 1, unit_price: 10 }],
      };
    }
    return {
      ...common,
      branch_id: businessId === B ? branchB : branchA,
      customer_id: customerId,
      invoice_id: invoiceB,
      debit_note_date: '2026-10-19',
      items: [{ item_id: itemB, description: mark, qty: 1, unit_price: 10 }],
    };
  }

  async function counts(businessId: string) {
    const row = await pool.query<{
      customers: string;
      expenses: string;
      estimates: string;
      orders: string;
      credits: string;
      debits: string;
      ledger: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM customers WHERE business_id = $1)::text AS customers,
         (SELECT COUNT(*) FROM expenses WHERE business_id = $1)::text AS expenses,
         (SELECT COUNT(*) FROM estimates WHERE business_id = $1)::text AS estimates,
         (SELECT COUNT(*) FROM sales_orders WHERE business_id = $1)::text AS orders,
         (SELECT COUNT(*) FROM credit_notes WHERE business_id = $1)::text AS credits,
         (SELECT COUNT(*) FROM debit_notes WHERE business_id = $1)::text AS debits,
         (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1)::text AS ledger`,
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
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))) {
      throw new Error(`Refusing Phase 3G tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN (
          'sales_estimates','sales_credit_notes','sales_debit_notes','sales_sales_orders','purchase_expenses','reports_basic'
        )
        GROUP BY plan_id
        ORDER BY COUNT(DISTINCT feature_id) DESC
        LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No subscription plan');
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'P3G %'`);
    const orphanIds = orphans.rows.map((row) => row.id);
    if (orphanIds.length) await purge(orphanIds);
    const planId = plan.rows[0].plan_id;
    for (const [id, name] of [
      [A, `P3G A ${tag}`],
      [B, `P3G B ${tag}`],
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
       VALUES ($1, $3, 'Owner A', $4, true, 1, true), ($2, $5, 'Owner B', $6, true, 1, true)`,
      [ownerA, ownerB, A, `75${phone}1`, B, `75${phone}2`],
    );
    await pool.query(
      `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
       VALUES ($1, $2, true, true, true, true), ($3, $4, true, true, true, true)`,
      [ownerA, branchA, ownerB, branchB],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, is_active) VALUES ($1, $3, $4, true), ($2, $5, $6, true)`,
      [customerA, customerB, A, markA, B, markB],
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, is_active) VALUES ($1, $2, $3, true)`,
      [supplierB, B, markB],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active)
       VALUES ($1, $2, $3, 'goods', 'PCS', 10, true), ($4, $5, $6, 'goods', 'PCS', 8, true)`,
      [itemB, B, markB, itemA, A, markA],
    );
    await pool.query(
      `INSERT INTO accounts (business_id, account_code, account_name, account_type, nature, is_active, pl_section)
       VALUES ($1, '5201', 'Administrative Expenses', 'expense', 'debit', true, 'operating_expense'),
              ($1, '1101', 'Cash', 'asset', 'debit', true, NULL),
              ($2, '5201', 'Administrative Expenses', 'expense', 'debit', true, 'operating_expense'),
              ($2, '1101', 'Cash', 'asset', 'debit', true, NULL)`,
      [A, B],
    );
    await pool.query(
      `INSERT INTO expense_categories (id, business_id, name, account_id)
       SELECT $1, $2, 'Office', id FROM accounts WHERE business_id = $2 AND account_code = '5201'`,
      [categoryA, A],
    );
    await pool.query(
      `INSERT INTO expense_categories (id, business_id, name, account_id)
       SELECT $1, $2, 'Office', id FROM accounts WHERE business_id = $2 AND account_code = '5201'`,
      [categoryB, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Staff A', $3, false, 1, true)`,
      [staffA, A, `75${phone}3`],
    );
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
          payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '27', 20, 0, 20, 0, 20, 'unpaid', $5)`,
      [invoiceB, B, customerB, markB, branchB],
    );
  });

  async function purge(ids: string[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'admin:seed_demo', null, async () => {
        await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
      });
      for (const id of ids) {
          await client.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
          await client.query(
            `DELETE FROM estimate_items WHERE estimate_id IN (
               SELECT id FROM estimates WHERE business_id = $1
                  OR created_by IN (SELECT id FROM users WHERE business_id = $1)
             )`,
            [id],
          );
          await client.query(
            `DELETE FROM estimates WHERE business_id = $1
                OR created_by IN (SELECT id FROM users WHERE business_id = $1)`,
            [id],
          );
          await client.query(`DELETE FROM sales_order_items WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE business_id = $1)`, [id]).catch(() => undefined);
          await client.query(`DELETE FROM sales_orders WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM expenses WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM expense_categories WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM debit_note_items WHERE debit_note_id IN (SELECT id FROM debit_notes WHERE business_id = $1)`, [id]).catch(() => undefined);
          await client.query(`DELETE FROM debit_notes WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE business_id = $1)`, [id]).catch(() => undefined);
          await client.query(`DELETE FROM credit_notes WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [id]);
          await client.query(`DELETE FROM invoices WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM items WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM users WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
          await client.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
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

  afterAll(async () => {
    if (!pool) return;
    try {
      await purge([A, B]);
    } finally {
      await closePool();
    }
  });

  test('middleware rejects these POSTs without a cookie', async () => {
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
  });

  test('forged identity does not create business B rows', async () => {
    const before = await counts(B);
    const created: string[] = [];
    const seen: string[] = [];
    const attacks: Array<[string, Record<string, string>, string, string]> = [
      ['no session, user A body', {}, ownerA, customerB],
      ['no session, user B body', {}, ownerB, customerB],
      ['user A headers with business B', session(ownerA, B), ownerA, customerB],
      ['user A header only', { 'x-authenticated-user-id': ownerA, 'x-authenticated-session-version': '1' }, ownerA, customerB],
      ['user B header only', { 'x-authenticated-user-id': ownerB, 'x-authenticated-session-version': '1' }, ownerB, customerB],
    ];
    for (const [label, headers, userId] of attacks) {
      for (const [name, handler] of writers) {
        const beforeOne = await counts(B);
        const res = await send(handler, name, bodyFor(name, B, userId, customerB, markB), headers);
        const afterOne = await counts(B);
        const wrote = JSON.stringify(beforeOne) !== JSON.stringify(afterOne) || res.status === 201;
        const line = `${label} | ${name} HTTP ${res.status}${wrote ? ' WROTE ' + JSON.stringify(afterOne) : ''}`;
        seen.push(line);
        if (wrote) created.push(line);
      }
    }
    if (created.length || JSON.stringify(await counts(B)) !== JSON.stringify(before)) {
      throw new Error(`${created.join('\n')}\n---\n${seen.join('\n')}`);
    }
  });

  test('a valid session for A with a forged body does not write business B', async () => {
    const beforeB = await counts(B);
    const wroteB: string[] = [];
    for (const [name, handler] of writers) {
      const res = await send(handler, name, bodyFor(name, B, ownerB, customerB, markB), session(ownerA, A));
      const nowB = await counts(B);
      if (JSON.stringify(nowB) !== JSON.stringify(beforeB)) wroteB.push(`${name} HTTP ${res.status}`);
    }
    expect(wroteB).toEqual([]);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a stale session does not write', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    for (const [name, handler] of writers) {
      const res = await send(handler, name, bodyFor(name, A, ownerA, customerA, markA), session(ownerA, A, '999'));
      expect(res.status).not.toBe(201);
    }
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a valid session can create a customer for its own business', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const res = await send(
      postCustomer,
      'customers',
      { name: `${markA}-new`, business_id: B, user_id: ownerB, created_by: ownerB },
      session(ownerA, A),
    );
    expect(res.status).toBe(201);
    expect(res.text).toContain(`${markA}-new`);
    expect(res.text).not.toContain(B);
    const afterA = await counts(A);
    expect(Number(afterA.customers)).toBe(Number(beforeA.customers) + 1);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a foreign customer or invoice is not attached', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const headers = session(ownerA, A);
    const credit = await send(postCreditNote, 'credit-notes', bodyFor('credit-notes', A, ownerA, customerB, markA), headers);
    const debit = await send(postDebitNote, 'debit-notes', bodyFor('debit-notes', A, ownerA, customerB, markA), headers);
    const estimate = await send(
      postEstimate,
      'estimates',
      {
        ...bodyFor('estimates', A, ownerA, customerB, markA),
        items: [{ item_id: itemB, description: markA, qty: 1, unit_price: 10, line_total: 10 }],
      },
      headers,
    );
    const order = await send(postSalesOrder, 'sales-orders', bodyFor('sales-orders', A, ownerA, customerB, markA), headers);
    const supplierBefore = await pool.query<{ balance: string }>(
      `SELECT current_balance::text AS balance FROM suppliers WHERE id = $1`,
      [supplierB],
    );
    const expense = await send(
      postExpense,
      'expenses',
      { ...bodyFor('expenses', A, ownerA, customerA, markA), payment_mode: 'on_account', supplier_id: supplierB },
      headers,
    );
    const supplierAfter = await pool.query<{ balance: string }>(
      `SELECT current_balance::text AS balance FROM suppliers WHERE id = $1`,
      [supplierB],
    );
    const linked = await pool.query<{ n: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM sales_orders WHERE business_id = $1 AND customer_id = $2) +
         (SELECT COUNT(*) FROM estimates WHERE business_id = $1 AND customer_id = $2) +
         (SELECT COUNT(*) FROM credit_notes WHERE business_id = $1 AND customer_id = $2) +
         (SELECT COUNT(*) FROM debit_notes WHERE business_id = $1 AND customer_id = $2)
       )::text AS n`,
      [A, customerB],
    );
    const attached = [
      ['credit-notes', credit.status],
      ['debit-notes', debit.status],
      ['estimates', estimate.status],
      ['sales-orders', order.status],
      ['expenses', expense.status],
    ].filter(([, status]) => status === 201);
    if (attached.length) {
      throw new Error(attached.map(([name, status]) => `${name} HTTP ${status}`).join('\n'));
    }
    expect(linked.rows[0].n).toBe('0');
    expect(supplierAfter.rows[0].balance).toBe(supplierBefore.rows[0].balance);
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a valid session creates an estimate, sales order, and expense for its own business', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    const headers = session(ownerA, A);
    const estimate = await send(
      postEstimate,
      'estimates',
      bodyFor('estimates', B, ownerB, customerA, `${markA}-est`),
      headers,
    );
    const order = await send(
      postSalesOrder,
      'sales-orders',
      {
        ...bodyFor('sales-orders', B, ownerB, customerA, `${markA}-so`),
        branch_id: branchA,
        items: [{ item_id: itemA, item_name: markA, qty: 1, unit_price: 8 }],
      },
      headers,
    );
    const expense = await send(
      postExpense,
      'expenses',
      { ...bodyFor('expenses', A, ownerA, customerA, `${markA}-exp`), branch_id: branchA, supplier_id: null, category_id: categoryA },
      headers,
    );
    expect(estimate.status).toBe(201);
    expect(order.status).toBe(201);
    expect(expense.status).toBe(201);
    const afterA = await counts(A);
    expect(Number(afterA.estimates)).toBe(Number(beforeA.estimates) + 1);
    expect(Number(afterA.orders)).toBe(Number(beforeA.orders) + 1);
    expect(Number(afterA.expenses)).toBe(Number(beforeA.expenses) + 1);
    expect(Number(afterA.ledger)).toBeGreaterThan(Number(beforeA.ledger));
    expect(await counts(B)).toEqual(beforeB);
    const owner = await pool.query<{ created_by: string; business_id: string }>(
      `SELECT created_by, business_id FROM estimates WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [A],
    );
    expect(owner.rows[0].business_id).toBe(A);
    expect(owner.rows[0].created_by).toBe(ownerA);
  });

  test('a user without create permission cannot write', async () => {
    const beforeA = await counts(A);
    const beforeB = await counts(B);
    for (const [name, handler] of [
      ['estimates', postEstimate],
      ['sales-orders', postSalesOrder],
      ['customers', postCustomer],
      ['expenses', postExpense],
    ] as const) {
      const res = await send(handler, name, bodyFor(name, A, staffA, customerA, `${markA}-staff`), session(staffA, A));
      expect(res.status).toBe(403);
    }
    expect(await counts(A)).toEqual(beforeA);
    expect(await counts(B)).toEqual(beforeB);
  });

  test('a cancelled billing subscription cannot create an estimate', async () => {
    const beforeA = await counts(A);
    await pool.query(
      `UPDATE business_module_subscriptions SET status = 'cancelled' WHERE business_id = $1 AND module_key = 'billing'`,
      [A],
    );
    try {
      const res = await send(
        postEstimate,
        'estimates',
        bodyFor('estimates', A, ownerA, customerA, `${markA}-plan`),
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
