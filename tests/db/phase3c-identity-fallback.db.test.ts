/**
 * Phase 3C: other handlers that still read user and business identity from the query
 * when session headers are missing. Does not stub authorize. Does not change application code.
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
    throw new Error('Refusing Phase 3C tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing Phase 3C tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __p3cHeaders: typeof headerBag }).__p3cHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __p3cHeaders: { current: Record<string, string> } }).__p3cHeaders.current[
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
import { GET as todaySales } from '@/app/api/dashboard/today-sales/route';
import { GET as recentInvoices } from '@/app/api/dashboard/recent-invoices/route';
import { GET as receivables } from '@/app/api/dashboard/receivables/route';
import { GET as topCustomers } from '@/app/api/dashboard/top-customers/route';
import { GET as todayPurchases } from '@/app/api/dashboard/today-purchases/route';
import { GET as dashSalesSummary } from '@/app/api/dashboard/sales-summary/route';
import { GET as dashCharts } from '@/app/api/dashboard/charts/route';
import { GET as lowStock } from '@/app/api/dashboard/low-stock/route';
import { GET as topProducts } from '@/app/api/dashboard/top-products/route';
import { GET as listCreditNotes } from '@/app/api/credit-notes/route';
import { GET as listExpenses, POST as postExpense } from '@/app/api/expenses/route';
import { GET as listDebitNotes } from '@/app/api/debit-notes/route';
import { GET as listEstimates } from '@/app/api/estimates/route';
import { GET as listSalesOrders } from '@/app/api/sales-orders/route';
import { GET as listJournals } from '@/app/api/journal-entries/route';
import { GET as profitLoss } from '@/app/api/reports/profit-loss/route';
import { GET as salesSummary } from '@/app/api/reports/sales-summary/route';
import { GET as listCustomers } from '@/app/api/customers/route';
import { GET as listSuppliers } from '@/app/api/suppliers/route';

const reads = [
  ['dashboard/today-sales', todaySales],
  ['dashboard/recent-invoices', recentInvoices],
  ['dashboard/receivables', receivables],
  ['dashboard/top-customers', topCustomers],
  ['dashboard/today-purchases', todayPurchases],
  ['dashboard/sales-summary', dashSalesSummary],
  ['dashboard/charts', dashCharts],
  ['dashboard/low-stock', lowStock],
  ['dashboard/top-products', topProducts],
  ['credit-notes', listCreditNotes],
  ['expenses', listExpenses],
  ['debit-notes', listDebitNotes],
  ['estimates', listEstimates],
  ['sales-orders', listSalesOrders],
  ['journal-entries', listJournals],
  ['reports/profit-loss', profitLoss],
  ['reports/sales-summary', salesSummary],
  ['customers', listCustomers],
  ['suppliers', listSuppliers],
] as const;

describe('Phase 3C identity fallback batch', () => {
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
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const tag = A.slice(0, 8);
  const markA = `P3C-A-${tag}`;
  const markB = `P3C-B-${tag}`;
  const amountB = '77.13';

  function session(userId: string, businessId: string) {
    headerBag.current = {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': '1',
    };
  }

  async function call(res: Response) {
    const text = await res.text();
    return { status: res.status, text };
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
      throw new Error(`Refusing Phase 3C tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE feature_id = 'reports_basic' AND enabled = true ORDER BY plan_id LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No enabled reports_basic plan');
    const planId = plan.rows[0].plan_id;
    for (const [id, name] of [
      [A, `P3C A ${tag}`],
      [B, `P3C B ${tag}`],
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
      [ownerA, ownerB, A, `73${phone}1`, B, `73${phone}2`],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, current_stock, min_stock, is_active)
       VALUES ($1, $2, $3, 'goods', 'PCS', 10, 0, 1, true), ($4, $5, $6, 'goods', 'PCS', 10, 0, 1, true)`,
      [randomUUID(), B, markB, randomUUID(), A, markA],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, is_active) VALUES ($1, $3, $4, true), ($2, $5, $6, true)`,
      [customerA, customerB, A, markA, B, markB],
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [supplierA, A, markA, supplierB, B, markB],
    );
    for (const [biz, branch, customer, num] of [
      [A, branchA, customerA, `A-${tag}`],
      [B, branchB, customerB, `B-${tag}`],
    ] as const) {
      await pool.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
            payment_status, branch_id)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '27', $6, 0, $6, 0, $6, 'unpaid', $5)`,
        [randomUUID(), biz, customer, num, branch, biz === B ? amountB : '10'],
      );
    }
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
          payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', '27', 10, 0, 10, 0, 10, 'unpaid', $5)`,
      [randomUUID(), B, supplierB, markB, branchB],
    );
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
          payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', '27', 4, 0, 4, 0, 4, 'unpaid', $5)`,
      [randomUUID(), A, supplierA, markA, branchA],
    );
    await pool.query(
      `INSERT INTO credit_notes (id, business_id, branch_id, customer_id, credit_note_number, credit_note_date,
          subtotal, grand_total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 10, 10, 'active', $6)`,
      [randomUUID(), B, branchB, customerB, markB, ownerB],
    );
    await pool.query(
      `INSERT INTO expenses (id, business_id, branch_id, amount, description, expense_date, payment_mode, created_by)
       VALUES ($1, $2, $3, 25, $4, CURRENT_DATE, 'cash', $5)`,
      [randomUUID(), B, branchB, markB, ownerB],
    );
    await pool.query(
      `INSERT INTO debit_notes (id, business_id, branch_id, customer_id, debit_note_number, debit_note_date,
          subtotal, grand_total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 10, 10, 'active', $6)`,
      [randomUUID(), B, branchB, customerB, markB, ownerB],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      for (const id of [A, B]) {
        await pool.query(`DELETE FROM purchases WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM expenses WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM debit_notes WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM credit_notes WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
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
        new NextRequest(`https://app.khatario.test/api/${name}?business_id=${B}&user_id=${ownerA}`, {
          headers: {
            host: 'app.khatario.test',
            'x-authenticated-user-id': ownerA,
            'x-authenticated-business-id': B,
          },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  test('a valid session for business A does not return business B markers', async () => {
    session(ownerA, A);
    const sales = await call(
      await todaySales(new NextRequest('http://localhost/api/dashboard/today-sales', { headers: headerBag.current })),
    );
    expect(sales.status).toBe(200);
    expect(sales.text).toContain(markA);
    expect(sales.text).not.toContain(markB);
    expect(sales.text).not.toContain(amountB);
  });

  test('query identity without a session does not return business B data', async () => {
    headerBag.current = {};
    const before = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM invoices WHERE business_id = $1`, [B]);
    const leaked: string[] = [];
    for (const [name, handler] of reads) {
      const res = await call(
        await handler(
          new NextRequest(`http://localhost/api/${name}?business_id=${B}&user_id=${ownerA}&start_date=2026-10-01&end_date=2026-10-31`, {
            headers: { 'x-user-id': ownerA },
          }),
        ),
      );
      if (res.text.includes(markB) || res.text.includes(amountB)) leaked.push(`${name} HTTP ${res.status}`);
    }
    const after = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM invoices WHERE business_id = $1`, [B]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(leaked).toEqual([]);
  });

  test('session headers for user A and business B do not return business B data', async () => {
    headerBag.current = {
      'x-authenticated-user-id': ownerA,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
    const leaked: string[] = [];
    for (const [name, handler] of reads) {
      const res = await call(
        await handler(
          new NextRequest(
            `http://localhost/api/${name}?start_date=2026-10-01&end_date=2026-10-31`,
            { headers: headerBag.current },
          ),
        ),
      );
      if (res.text.includes(markB) || res.text.includes(amountB)) leaked.push(`${name} HTTP ${res.status}`);
    }
    expect(leaked).toEqual([]);
  });

  const fixedDashboards = [
    ['dashboard/today-sales', todaySales],
    ['dashboard/recent-invoices', recentInvoices],
    ['dashboard/top-customers', topCustomers],
    ['dashboard/today-purchases', todayPurchases],
    ['dashboard/sales-summary', dashSalesSummary],
    ['dashboard/charts', dashCharts],
    ['dashboard/low-stock', lowStock],
  ] as const;

  async function snapshot() {
    const row = await pool.query<{ invoices: string; items: string; purchases: string; ledger: string }>(
      `SELECT
         (SELECT COUNT(*) FROM invoices WHERE business_id = ANY($1::uuid[]))::text AS invoices,
         (SELECT COALESCE(SUM(current_stock), 0) FROM items WHERE business_id = ANY($1::uuid[]))::text AS items,
         (SELECT COUNT(*) FROM purchases WHERE business_id = ANY($1::uuid[]))::text AS purchases,
         (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[]))::text AS ledger`,
      [[A, B]],
    );
    return row.rows[0];
  }

  test('the seven dashboard handlers reject a missing session and a mismatched business', async () => {
    const before = await snapshot();
    headerBag.current = {};
    for (const [name, handler] of fixedDashboards) {
      const res = await call(
        await handler(
          new NextRequest(
            `http://localhost/api/${name}?business_id=${B}&user_id=${ownerA}&start_date=2026-10-01&end_date=2026-10-31`,
            { headers: { 'x-user-id': ownerA, 'x-business-id': B } },
          ),
        ),
      );
      expect(res.status).toBe(401);
      expect(res.text).not.toContain(markB);
      expect(res.text).not.toContain(amountB);
    }
    headerBag.current = {
      'x-authenticated-user-id': ownerA,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
    for (const [name, handler] of fixedDashboards) {
      const res = await call(
        await handler(
          new NextRequest(`http://localhost/api/${name}?business_id=${B}&user_id=${ownerB}&start_date=2026-10-01&end_date=2026-10-31`, {
            headers: headerBag.current,
          }),
        ),
      );
      expect(res.status).toBe(403);
      expect(res.text).not.toContain(markB);
      expect(res.text).not.toContain(amountB);
    }
    expect(await snapshot()).toEqual(before);
  });

  test('a stale session version is rejected on the seven dashboard handlers', async () => {
    headerBag.current = {
      'x-authenticated-user-id': ownerA,
      'x-authenticated-business-id': A,
      'x-authenticated-session-version': '999',
    };
    for (const [name, handler] of fixedDashboards) {
      const res = await call(
        await handler(
          new NextRequest(`http://localhost/api/${name}?start_date=2026-10-01&end_date=2026-10-31`, {
            headers: headerBag.current,
          }),
        ),
      );
      expect(res.status).toBe(401);
      expect(res.text).toContain('SESSION_REVOKED');
      expect(res.text).not.toContain(markA);
      expect(res.text).not.toContain(markB);
    }
  });

  test('a valid session returns only business A dashboard data when the query names business B', async () => {
    session(ownerA, A);
    const range = 'start_date=2026-10-01&end_date=2026-10-31';
    const forged = `business_id=${B}&user_id=${ownerB}`;
    const sales = await call(
      await todaySales(new NextRequest(`http://localhost/api/dashboard/today-sales?${forged}`, { headers: headerBag.current })),
    );
    expect(sales.status).toBe(200);
    expect(sales.text).toContain(markA);
    expect(sales.text).not.toContain(markB);
    const recent = await call(
      await recentInvoices(
        new NextRequest(`http://localhost/api/dashboard/recent-invoices?${forged}&limit=5`, { headers: headerBag.current }),
      ),
    );
    expect(recent.status).toBe(200);
    expect(recent.text).toContain(markA);
    expect(recent.text).not.toContain(markB);
    const customers = await call(
      await topCustomers(
        new NextRequest(`http://localhost/api/dashboard/top-customers?${forged}&limit=10`, { headers: headerBag.current }),
      ),
    );
    expect(customers.status).toBe(200);
    expect(customers.text).toContain(markA);
    expect(customers.text).not.toContain(markB);
    const purchases = await call(
      await todayPurchases(
        new NextRequest(`http://localhost/api/dashboard/today-purchases?${forged}`, { headers: headerBag.current }),
      ),
    );
    expect(purchases.status).toBe(200);
    expect(purchases.text).toContain(markA);
    expect(purchases.text).not.toContain(markB);
    const summary = await call(
      await dashSalesSummary(
        new NextRequest(`http://localhost/api/dashboard/sales-summary?${forged}`, { headers: headerBag.current }),
      ),
    );
    expect(summary.status).toBe(200);
    const summaryBody = JSON.parse(summary.text) as { today_sales: number; month_sales: number };
    expect(summaryBody.today_sales).toBe(10);
    expect(summaryBody.month_sales).toBe(10);
    expect(summary.text).not.toContain(amountB);
    const charts = await call(
      await dashCharts(
        new NextRequest(`http://localhost/api/dashboard/charts?${forged}&${range}`, { headers: headerBag.current }),
      ),
    );
    expect(charts.status).toBe(200);
    const chartBody = JSON.parse(charts.text) as { chartData: { sales: number; purchases: number }[] };
    expect(chartBody.chartData.some((row) => row.sales === 10)).toBe(true);
    expect(chartBody.chartData.some((row) => row.purchases === 4)).toBe(true);
    expect(charts.text).not.toContain(amountB);
    const stock = await call(
      await lowStock(new NextRequest(`http://localhost/api/dashboard/low-stock?${forged}&limit=5`, { headers: headerBag.current })),
    );
    expect(stock.status).toBe(200);
    expect(stock.text).toContain(markA);
    expect(stock.text).not.toContain(markB);
  });

  test('creating an expense without a session does not write a row', async () => {
    headerBag.current = {};
    const before = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM expenses WHERE business_id = $1`, [B]);
    const res = await call(
      await postExpense(
        new NextRequest('http://localhost/api/expenses', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-user-id': ownerA },
          body: JSON.stringify({
            business_id: B,
            user_id: ownerA,
            created_by: ownerA,
            branch_id: branchB,
            amount: 15,
            description: `forged ${markB}`,
            expense_date: '2026-10-19',
            payment_mode: 'cash',
          }),
        }),
      ),
    );
    expect(res.status).not.toBe(201);
    expect(res.text).not.toContain(markB);
    const after = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM expenses WHERE business_id = $1`, [B]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
