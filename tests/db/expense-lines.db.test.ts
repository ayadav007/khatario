/**
 * Expense item lines. Writes only after current_database() is kh_phase2_test on port 5433.
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
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[match[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing expense line tests: database host is not local');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
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
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postExpense } from '@/app/api/expenses/route';
import { GSTR9Generator } from '@/lib/gst/gstr9';

const DAY = '2026-10-22';

describe('expense item lines', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const tag = B.slice(0, 8);
  const headers = {
    'content-type': 'application/json',
    'x-authenticated-user-id': USER,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  };

  async function category(name: string): Promise<string> {
    const id = randomUUID();
    const inserted = await pool.query(
      `INSERT INTO expense_categories (id, business_id, name, account_id)
       SELECT $1, $2, $3, id FROM accounts WHERE business_id = $2 AND account_code = '5201'
       RETURNING id`,
      [id, B, name]
    );
    if (!inserted.rows[0]) throw new Error('5201 missing');
    return id;
  }

  async function item(businessId: string, name: string, itemType: 'goods' | 'service'): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO expense_items (business_id, name, item_type, unit, hsn_sac, tax_rate)
       VALUES ($1, $2, $3, 'PCS', $4, 18) RETURNING id`,
      [businessId, name, itemType, itemType === 'service' ? '9982' : '9608']
    );
    return row.rows[0].id;
  }

  async function post(body: Record<string, unknown>) {
    const key = randomUUID();
    const response = await postExpense(
      new NextRequest('http://localhost/api/expenses', {
        method: 'POST',
        headers: { ...headers, 'x-idempotency-key': key },
        body: JSON.stringify({ ...body, idempotency_key: key }),
      })
    );
    return { status: response.status, json: await response.json() };
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !(info.addr.startsWith('127.') || info.addr.startsWith('::1'))) {
      throw new Error(`Refusing expense line tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/406_expense_items_and_lines.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(
      `INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '27', 'regular'), ($3, $4, '27', 'regular')`,
      [B, `Expense lines ${tag}`, OTHER, `Expense lines other ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [USER, B, `6${Date.now().toString().slice(-9)}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, is_active, current_balance)
       VALUES ($1, $2, 'Advocate', '27', '27AAAAA0000A1Z5', true, 0)`,
      [SUP, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  });

  it('posts pens as an expense without stock, and refuses another business item', async () => {
    const categoryId = await category(`Office ${tag}`);
    const penId = await item(B, `Pen ${tag}`, 'goods');
    const foreignId = await item(OTHER, `Foreign ${tag}`, 'goods');
    const refused = await post({
      category_id: categoryId,
      expense_date: DAY,
      payment_mode: 'cash',
      supplier_id: SUP,
      lines: [{ expense_item_id: foreignId, quantity: 1, unit_price: 10, tax_rate: 18 }],
    });
    expect(refused.status).toBe(400);

    const created = await post({
      branch_id: BR,
      category_id: categoryId,
      expense_date: DAY,
      payment_mode: 'cash',
      supplier_id: SUP,
      description: 'Office pens',
      itc_eligible: true,
      is_reverse_charge: false,
      lines: [{ expense_item_id: penId, quantity: 10, unit_price: 10, tax_rate: 18 }],
    });
    expect(created.status).toBe(201);
    expect(Number(created.json.expense.amount)).toBe(118);
    expect(Number(created.json.expense.cgst_amount)).toBe(9);
    expect(Number(created.json.expense.sgst_amount)).toBe(9);

    const ledger = await pool.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.account_code AS code, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1 AND l.voucher_type = 'expense' AND l.voucher_id = $2
        GROUP BY a.account_code ORDER BY a.account_code`,
      [B, created.json.expense.id]
    );
    const byCode = Object.fromEntries(ledger.rows.map((row) => [row.code, row]));
    expect(Number(byCode['5201'].debit)).toBe(100);
    expect(Number(byCode['1110'].debit)).toBe(9);
    expect(Number(byCode['1111'].debit)).toBe(9);
    expect(Number(byCode['5201'].credit)).toBe(0);

    const stock = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM items WHERE business_id = $1`,
      [B]
    );
    expect(stock.rows[0].n).toBe('0');
    const purchases = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'purchase'`,
      [B]
    );
    expect(purchases.rows[0].n).toBe('0');
  });

  it('files goods as inputs and a reverse-charge service as input services', async () => {
    const categoryId = await category(`Advice category ${tag}`);
    const adviceId = await item(B, `Advice ${tag}`, 'service');
    const created = await post({
      branch_id: BR,
      category_id: categoryId,
      expense_date: DAY,
      payment_mode: 'on_account',
      supplier_id: SUP,
      description: 'Legal advice',
      itc_eligible: true,
      is_reverse_charge: true,
      lines: [{ expense_item_id: adviceId, quantity: 1, unit_price: 10000, tax_rate: 18 }],
    });
    expect(created.status).toBe(201);
    expect(Number(created.json.expense.amount)).toBe(10000);
    const balance = await pool.query<{ b: string }>(`SELECT current_balance::text AS b FROM suppliers WHERE id = $1`, [SUP]);
    expect(Number(balance.rows[0].b)).toBe(10000);

    const report = await new GSTR9Generator().generate({ business_id: B, financial_year: 2026 });
    expect(report.table_6.B.inputs.taxable_value).toBeGreaterThanOrEqual(100);
    expect(report.table_6.B.inputs.cgst).toBeGreaterThanOrEqual(9);
    expect(report.table_6.D.input_services.taxable_value).toBeGreaterThanOrEqual(10000);
    expect(report.table_6.D.input_services.cgst).toBeGreaterThanOrEqual(900);
    expect(report.table_6.B.input_services.taxable_value).toBe(0);
  });
});
