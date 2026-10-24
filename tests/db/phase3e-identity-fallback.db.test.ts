/**
 * Phase 3E: remaining dashboard and list handlers that still read identity from the query.
 * Does not stub authorize. Does not change application code.
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
    throw new Error('Refusing Phase 3E tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing Phase 3E tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __p3eHeaders: typeof headerBag }).__p3eHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __p3eHeaders: { current: Record<string, string> } }).__p3eHeaders.current[
        name.toLowerCase()
      ] ?? null,
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
import { middleware } from '../../middleware';
import { GET as topProducts } from '@/app/api/dashboard/top-products/route';
import { GET as receivables } from '@/app/api/dashboard/receivables/route';
import { GET as cashFlow } from '@/app/api/dashboard/cash-flow/route';
import { GET as listCreditNotes } from '@/app/api/credit-notes/route';
import { GET as listExpenses } from '@/app/api/expenses/route';
import { GET as listDebitNotes } from '@/app/api/debit-notes/route';
import { GET as listEstimates } from '@/app/api/estimates/route';
import { GET as listSalesOrders } from '@/app/api/sales-orders/route';
import { GET as listCustomers } from '@/app/api/customers/route';

const reads = [
  ['dashboard/top-products', topProducts],
  ['dashboard/receivables', receivables],
  ['dashboard/cash-flow', cashFlow],
  ['credit-notes', listCreditNotes],
  ['expenses', listExpenses],
  ['debit-notes', listDebitNotes],
  ['estimates', listEstimates],
  ['sales-orders', listSalesOrders],
  ['customers', listCustomers],
] as const;

describe('Phase 3E remaining identity fallbacks', () => {
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
  const itemA = randomUUID();
  const itemB = randomUUID();
  const invoiceA = randomUUID();
  const invoiceB = randomUUID();
  const tag = A.slice(0, 8);
  const markA = `P3E-A-${tag}`;
  const markB = `P3E-B-${tag}`;
  const cashB = '88.88';

  function session(userId: string, businessId: string) {
    headerBag.current = {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': '1',
    };
  }

  async function call(handler: (request: NextRequest) => Promise<Response>, url: string) {
    const res = await handler(new NextRequest(url, { headers: headerBag.current }));
    return { status: res.status, text: await res.text() };
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
      throw new Error(`Refusing Phase 3E tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE feature_id = 'reports_basic' AND enabled = true ORDER BY plan_id LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No enabled reports_basic plan');
    const planId = plan.rows[0].plan_id;
    for (const [id, name] of [
      [A, `P3E A ${tag}`],
      [B, `P3E B ${tag}`],
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
      [ownerA, ownerB, A, `74${phone}1`, B, `74${phone}2`],
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
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active)
       VALUES ($1, $3, $4, 'goods', 'PCS', 10, true), ($2, $5, $6, 'goods', 'PCS', 10, true)`,
      [itemA, itemB, A, markA, B, markB],
    );
    for (const [id, biz, branch, customer, num, total] of [
      [invoiceA, A, branchA, customerA, `A-${tag}`, '10'],
      [invoiceB, B, branchB, customerB, `B-${tag}`, '20'],
    ] as const) {
      await pool.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
            payment_status, branch_id)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '27', $6, 0, $6, 0, $6, 'unpaid', $5)`,
        [id, biz, customer, num, branch, total],
      );
      await pool.query(
        `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit_price, tax_rate, tax_amount, line_total)
         VALUES ($1, $2, $3, 1, $4, 0, 0, $4)`,
        [randomUUID() && id, biz === A ? itemA : itemB, biz === A ? markA : markB, total],
      );
    }
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
          payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 'proforma_invoice', '27', 5, 0, 5, 0, 5, 'unpaid', $5),
              ($6, $7, $8, $9, CURRENT_DATE, 'draft', 'proforma_invoice', '27', 6, 0, 6, 0, 6, 'unpaid', $10)`,
      [randomUUID(), A, customerA, markA, branchA, randomUUID(), B, customerB, markB, branchB],
    );
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, amount, payment_mode, payment_date, status)
       VALUES ($1, $2, $3, 'receivable', $4, 11.11, 'cash', CURRENT_DATE, 'active'),
              ($5, $6, $7, 'receivable', $8, 88.88, 'cash', CURRENT_DATE, 'active')`,
      [randomUUID(), A, branchA, customerA, randomUUID(), B, branchB, customerB],
    );
    for (const [biz, branch, customer, owner, mark] of [
      [A, branchA, customerA, ownerA, markA],
      [B, branchB, customerB, ownerB, markB],
    ] as const) {
      await pool.query(
        `INSERT INTO credit_notes (id, business_id, branch_id, customer_id, credit_note_number, credit_note_date,
            subtotal, grand_total, status, created_by)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 10, 10, 'active', $6)`,
        [randomUUID(), biz, branch, customer, mark, owner],
      );
      await pool.query(
        `INSERT INTO expenses (id, business_id, branch_id, amount, description, expense_date, payment_mode, created_by)
         VALUES ($1, $2, $3, 25, $4, CURRENT_DATE, 'cash', $5)`,
        [randomUUID(), biz, branch, mark, owner],
      );
      await pool.query(
        `INSERT INTO debit_notes (id, business_id, branch_id, customer_id, debit_note_number, debit_note_date,
            subtotal, grand_total, status, created_by)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 10, 10, 'active', $6)`,
        [randomUUID(), biz, branch, customer, mark, owner],
      );
      await pool.query(
        `INSERT INTO sales_orders (id, business_id, customer_id, branch_id, order_number, order_date, status, subtotal, grand_total, payment_status)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'confirmed', 9, 9, 'unpaid')`,
        [randomUUID(), biz, customer, branch, mark],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      for (const id of [A, B]) {
        await pool.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await pool.query(`DELETE FROM sales_orders WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM payments WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [id]);
        await pool.query(`DELETE FROM expenses WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM debit_notes WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM credit_notes WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
    } finally {
      await closePool();
    }
  });

  test('middleware rejects these paths without a cookie', async () => {
    headerBag.current = {};
    for (const [name] of reads) {
      const res = await middleware(
        new NextRequest(`https://app.khatario.test/api/${name}?business_id=${B}&user_id=${ownerB}`, {
          headers: { host: 'app.khatario.test', 'x-authenticated-user-id': ownerB, 'x-authenticated-business-id': B },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  test('each owning session can see its own marker', async () => {
    const missing: string[] = [];
    for (const [name, handler] of reads) {
      session(ownerA, A);
      const own = await call(handler, `http://localhost/api/${name}?fiscal_year=2026`);
      const ownOk = name === 'dashboard/cash-flow' ? own.text.includes('11.11') : own.text.includes(markA);
      if (own.status !== 200 || !ownOk) missing.push(`${name} own A HTTP ${own.status}`);
      session(ownerB, B);
      const other = await call(handler, `http://localhost/api/${name}?fiscal_year=2026`);
      if (other.status !== 200 || !other.text.includes(markB)) {
        if (name === 'dashboard/cash-flow') {
          if (other.status !== 200 || !other.text.includes(cashB)) missing.push(`${name} own B HTTP ${other.status}`);
        } else {
          missing.push(`${name} own B HTTP ${other.status}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('forged identity does not return business B data', async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM invoices WHERE business_id = ANY($1::uuid[])`,
      [[A, B]],
    );
    const leaked: string[] = [];
    const attacks: Array<[string, Record<string, string>, string]> = [
      ['user A query, no session', {}, `business_id=${B}&user_id=${ownerA}`],
      ['user B query, no session', { 'x-user-id': ownerB }, `business_id=${B}&user_id=${ownerB}`],
      [
        'user A headers with business B',
        {
          'x-authenticated-user-id': ownerA,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
        `business_id=${B}&user_id=${ownerB}`,
      ],
    ];
    for (const [label, headers, query] of attacks) {
      headerBag.current = headers;
      for (const [name, handler] of reads) {
        const res = await call(handler, `http://localhost/api/${name}?${query}&fiscal_year=2026`);
        const hit = res.text.includes(markB) || res.text.includes(cashB);
        const rejected = label.startsWith('user A headers') ? res.status === 403 : res.status === 401;
        if (hit || !rejected) leaked.push(`${label} | ${name} HTTP ${res.status}`);
      }
    }
    session(ownerA, A);
    for (const [name, handler] of reads) {
      const res = await call(handler, `http://localhost/api/${name}?business_id=${B}&user_id=${ownerB}&fiscal_year=2026`);
      if (res.text.includes(markB) || res.text.includes(cashB)) leaked.push(`session A query B | ${name} HTTP ${res.status}`);
      if (name === 'dashboard/cash-flow' && !res.text.includes('11.11')) {
        leaked.push(`session A lost own cash | ${name} HTTP ${res.status}`);
      }
      if (name !== 'dashboard/cash-flow' && !res.text.includes(markA)) {
        leaked.push(`session A lost own marker | ${name} HTTP ${res.status}`);
      }
    }
    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM invoices WHERE business_id = ANY($1::uuid[])`,
      [[A, B]],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(leaked).toEqual([]);
  });

  test('a stale session version is rejected', async () => {
    headerBag.current = {
      'x-authenticated-user-id': ownerA,
      'x-authenticated-business-id': A,
      'x-authenticated-session-version': '999',
    };
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`,
      [[A, B]],
    );
    for (const [name, handler] of reads) {
      const res = await call(handler, `http://localhost/api/${name}?fiscal_year=2026`);
      expect(res.status).toBe(401);
      expect(res.text).toContain('SESSION_REVOKED');
      expect(res.text).not.toContain(markB);
      expect(res.text).not.toContain(cashB);
    }
    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`,
      [[A, B]],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test('search and status filters still apply to the signed-in business', async () => {
    session(ownerA, A);
    const customers = await call(listCustomers, `http://localhost/api/customers?search=${encodeURIComponent(markA)}&business_id=${B}`);
    expect(customers.status).toBe(200);
    expect(customers.text).toContain(markA);
    expect(customers.text).not.toContain(markB);
    const hidden = await call(listCustomers, `http://localhost/api/customers?search=${encodeURIComponent(markB)}`);
    expect(hidden.status).toBe(200);
    expect(hidden.text).not.toContain(markB);
    const orders = await call(listSalesOrders, `http://localhost/api/sales-orders?status=confirmed`);
    expect(orders.status).toBe(200);
    expect(orders.text).toContain(markA);
    expect(orders.text).not.toContain(markB);
    const expenses = await call(listExpenses, `http://localhost/api/expenses?from_date=2099-01-01&to_date=2099-01-02`);
    expect(expenses.status).toBe(200);
    expect(expenses.text).not.toContain(markA);
    expect(expenses.text).not.toContain(markB);
  });
});
