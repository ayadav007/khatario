/**
 * Expense category guardrails. Writes only after current_database() is kh_phase2_test on port 5433.
 * Applies migrations 404 and 405 (nullable idempotency key and payload hash). Does not rewrite existing voucher lines.
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
    throw new Error('Refusing expense tests: database host is not local');
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
import { POST as previewExpense } from '@/app/api/expenses/preview/route';
import { PUT as putExpense, DELETE as deleteExpense } from '@/app/api/expenses/[id]/route';

const DAY = '2026-10-21';

describe('expense posting guardrails', () => {
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

  async function accountId(code: string, businessId = B): Promise<string> {
    const row = (
      await pool.query<{ id: string }>(
        `SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2`,
        [businessId, code]
      )
    ).rows[0];
    if (!row) throw new Error(`Account ${code} missing`);
    return row.id;
  }

  async function category(name: string, code: string | null, businessId = B): Promise<string> {
    const id = randomUUID();
    if (!code) {
      await pool.query(
        `INSERT INTO expense_categories (id, business_id, name) VALUES ($1, $2, $3)`,
        [id, businessId, name]
      );
      return id;
    }
    const inserted = await pool.query(
      `INSERT INTO expense_categories (id, business_id, name, account_id)
       SELECT $1, $2, $3, id FROM accounts WHERE business_id = $2 AND account_code = $4
       RETURNING id`,
      [id, businessId, name, code]
    );
    if (!inserted.rows[0]) throw new Error(`Account ${code} missing for category ${name}`);
    return id;
  }

  async function counts() {
    const expenses = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM expenses WHERE business_id = $1`, [B]);
    const lines = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1`,
      [B]
    );
    const balance = await pool.query<{ b: string }>(
      `SELECT current_balance::text AS b FROM suppliers WHERE id = $1`,
      [SUP]
    );
    return { expenses: expenses.rows[0].n, lines: lines.rows[0].n, balance: Number(balance.rows[0].b) };
  }

  async function post(body: Record<string, unknown>, key = randomUUID()) {
    const response = await postExpense(
      new NextRequest('http://localhost/api/expenses', {
        method: 'POST',
        headers: { ...headers, 'x-idempotency-key': key },
        body: JSON.stringify({ ...body, idempotency_key: key }),
      })
    );
    const json = await response.json();
    return { status: response.status, json };
  }

  async function preview(body: Record<string, unknown>) {
    const response = await previewExpense(
      new NextRequest('http://localhost/api/expenses/preview', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    );
    const json = await response.json();
    return { status: response.status, json };
  }

  async function activeLines(voucherId: string) {
    return (
      await pool.query<{ code: string; debit: number; credit: number }>(
        `SELECT a.account_code AS code, SUM(l.debit)::float8 AS debit, SUM(l.credit)::float8 AS credit
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = 'expense' AND l.voucher_id = $2
            AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.original_line_id = l.id)
            AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.reversal_line_id = l.id)
          GROUP BY a.account_code
          ORDER BY a.account_code`,
        [B, voucherId]
      )
    ).rows;
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !(info.addr.startsWith('127.') || info.addr.startsWith('::1'))) {
      throw new Error(`Refusing expense tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    for (const file of ['404_expense_idempotency.sql', '405_expense_idempotency_payload_hash.sql', '406_expense_items_and_lines.sql']) {
      const sql = fs.readFileSync(path.resolve(process.cwd(), 'database/migrations', file), 'utf8');
      await pool.query(sql);
    }
    await pool.query(
      `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS settlement_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT`
    );
    await pool.query(`INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '27', 'regular'), ($3, $4, '27', 'regular')`, [
      B,
      `Expense guard ${tag}`,
      OTHER,
      `Expense other ${tag}`,
    ]);
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [USER, B, `7${Date.now().toString().slice(-9)}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO accounts (business_id, account_code, account_name, account_type, nature, is_active, pl_section)
       VALUES ($1, '5216', 'Professional Fees', 'expense', 'debit', true, 'operating_expense')`,
      [OTHER]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, is_active, current_balance) VALUES ($1, $2, 'Vendor', true, 0)`,
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

  test('ordinary eligible, blocked, RCM, TDS, and paid or unpaid journals match the preview', async () => {
    const rent = await category(`Rent ${tag}`, '5213');
    const cases = [
      {
        name: 'eligible paid',
        body: { category_id: rent, amount: 1180, cgst_amount: 90, sgst_amount: 90, itc_eligible: true, payment_mode: 'cash', expense_date: DAY, description: 'eligible' },
        balanceDelta: 0,
      },
      {
        name: 'blocked paid',
        body: { category_id: rent, amount: 1180, cgst_amount: 90, sgst_amount: 90, itc_eligible: false, payment_mode: 'cash', expense_date: DAY, description: 'blocked' },
        balanceDelta: 0,
      },
      {
        name: 'rcm unpaid',
        body: {
          category_id: rent,
          amount: 10000,
          cgst_amount: 900,
          sgst_amount: 900,
          itc_eligible: true,
          is_reverse_charge: true,
          payment_mode: 'on_account',
          supplier_id: SUP,
          expense_date: DAY,
          description: 'rcm',
        },
        balanceDelta: 10000,
      },
      {
        name: 'tds unpaid',
        body: {
          category_id: rent,
          amount: 1180,
          cgst_amount: 90,
          sgst_amount: 90,
          itc_eligible: true,
          tds_amount: 100,
          tds_section: '194J',
          payment_mode: 'on_account',
          supplier_id: SUP,
          expense_date: DAY,
          description: 'tds',
        },
        balanceDelta: 1080,
      },
    ];
    for (const item of cases) {
      const before = await counts();
      const shown = await preview(item.body);
      expect(shown.status).toBe(200);
      const saved = await post(item.body);
      expect(saved.status).toBe(201);
      const lines = await activeLines(saved.json.expense.id);
      const posted = lines.map((line) => ({ code: line.code, debit: line.debit, credit: line.credit }));
      const shownLines = shown.json.lines
        .map((line: { account_code: string; debit: number; credit: number }) => ({
          code: line.account_code,
          debit: line.debit,
          credit: line.credit,
        }))
        .sort((a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code));
      expect(posted).toEqual(shownLines);
      const after = await counts();
      expect(after.balance - before.balance).toBeCloseTo(item.balanceDelta, 2);
      expect(Number(after.expenses)).toBe(Number(before.expenses) + 1);
    }
    const blocked = await activeLines(
      (
        await pool.query<{ id: string }>(
          `SELECT id FROM expenses WHERE business_id = $1 AND description = 'blocked'`,
          [B]
        )
      ).rows[0].id
    );
    expect(blocked.find((line) => line.code === '5213')?.debit).toBe(1180);
    expect(blocked.find((line) => line.code === '1110')).toBeUndefined();
    const eligible = await activeLines(
      (
        await pool.query<{ id: string }>(
          `SELECT id FROM expenses WHERE business_id = $1 AND description = 'eligible'`,
          [B]
        )
      ).rows[0].id
    );
    expect(eligible.find((line) => line.code === '5213')?.debit).toBe(1000);
    expect(eligible.find((line) => line.code === '1110')?.debit).toBe(90);
  });

  test('rejects purchases, COGS, stock loss, fixed assets, a missing account, an inactive account, and another business', async () => {
    const before = await counts();
    const historical = await post({
      category_id: await category(`Keep ${tag}`, '5201'),
      amount: 250,
      payment_mode: 'cash',
      expense_date: DAY,
      description: 'historical',
    });
    expect(historical.status).toBe(201);
    const original = await activeLines(historical.json.expense.id);

    for (const code of ['5101', '5104', '5105', '5106', '1201']) {
      const id = await category(`Bad ${code} ${tag}`, code);
      const response = await post({ category_id: id, amount: 100, payment_mode: 'cash', expense_date: DAY, description: code });
      expect(response.status).toBe(400);
      expect(response.json.code).toBe('EXPENSE_INVALID');
    }

    const missing = await category(`Missing ${tag}`, null);
    const missingRes = await post({
      category_id: missing,
      amount: 100,
      payment_mode: 'cash',
      expense_date: DAY,
      description: 'missing',
    });
    expect(missingRes.status).toBe(400);

    const fees = await accountId('5216');
    await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [fees]);
    const inactive = await category(`Inactive ${tag}`, '5216');
    const inactiveRes = await post({
      category_id: inactive,
      amount: 100,
      payment_mode: 'cash',
      expense_date: DAY,
      description: 'inactive',
    });
    expect(inactiveRes.status).toBe(400);
    await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [fees]);

    const foreignAccount = await accountId('5216', OTHER);
    const foreignCategory = randomUUID();
    await pool.query(
      `INSERT INTO expense_categories (id, business_id, name, account_id) VALUES ($1, $2, $3, $4)`,
      [foreignCategory, B, `Foreign ${tag}`, foreignAccount]
    );
    const foreignRes = await post({
      category_id: foreignCategory,
      amount: 100,
      payment_mode: 'on_account',
      supplier_id: SUP,
      expense_date: DAY,
      description: 'foreign',
    });
    expect(foreignRes.status).toBe(400);

    const after = await counts();
    expect(after.expenses).toBe(String(Number(before.expenses) + 1));
    expect(await activeLines(historical.json.expense.id)).toEqual(original);
    expect(after.balance).toBeCloseTo(before.balance, 2);
  });

  test('a repeated request posts once and a failed account check rolls back', async () => {
    const rent = await category(`Repeat ${tag}`, '5202');
    const before = await counts();
    const key = randomUUID();
    const body = {
      category_id: rent,
      amount: 400,
      payment_mode: 'on_account',
      supplier_id: SUP,
      expense_date: DAY,
      description: 'repeat',
    };
    const [first, second] = await Promise.all([post(body, key), post(body, key)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 201]);
    expect(first.json.expense.id).toBe(second.json.expense.id);
    const again = await post(body, key);
    expect(again.status).toBe(200);
    expect(again.json.expense.id).toBe(first.json.expense.id);
    const after = await counts();
    expect(Number(after.expenses) - Number(before.expenses)).toBe(1);
    expect(after.balance - before.balance).toBeCloseTo(400, 2);

    const bad = await category(`Rollback ${tag}`, '5105');
    const rolled = await post({
      category_id: bad,
      amount: 50,
      payment_mode: 'on_account',
      supplier_id: SUP,
      expense_date: DAY,
      description: 'rollback',
    });
    expect(rolled.status).toBe(400);
    const finalCounts = await counts();
    expect(finalCounts.expenses).toBe(after.expenses);
    expect(finalCounts.balance).toBeCloseTo(after.balance, 2);
    expect(finalCounts.lines).toBe(after.lines);
  });

  test('edit and cancel reverse once and leave the earlier voucher unchanged', async () => {
    const rent = await category(`Edit ${tag}`, '5212');
    const earlier = await post({
      category_id: rent,
      amount: 80,
      payment_mode: 'cash',
      expense_date: DAY,
      description: 'earlier',
    });
    const earlierLines = await activeLines(earlier.json.expense.id);
    const created = await post({
      category_id: rent,
      amount: 1000,
      payment_mode: 'cash',
      expense_date: DAY,
      description: 'edit-me',
    });
    const id = created.json.expense.id;
    const edited = await putExpense(
      new NextRequest(`http://localhost/api/expenses/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          amount: 1500,
          category_id: rent,
          payment_mode: 'cash',
          expense_date: DAY,
          expected_updated_at: created.json.expense.updated_at ?? null,
        }),
      }),
      { params: { id } }
    );
    const editedJson = await edited.json();
    expect(edited.status).toBe(200);
    expect(await activeLines(id)).toEqual([
      { code: '1101', debit: 0, credit: 1500 },
      { code: '5212', debit: 1500, credit: 0 },
    ]);
    const reversalsAfterEdit = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = $2`,
      [B, id]
    );
    expect(reversalsAfterEdit.rows[0].n).toBe('2');

    const bad = await category(`Edit bad ${tag}`, '5101');
    const rejected = await putExpense(
      new NextRequest(`http://localhost/api/expenses/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          amount: 1700,
          category_id: bad,
          payment_mode: 'cash',
          expense_date: DAY,
          expected_updated_at: editedJson.expense.updated_at,
        }),
      }),
      { params: { id } }
    );
    expect(rejected.status).toBe(400);
    expect(await activeLines(id)).toEqual([
      { code: '1101', debit: 0, credit: 1500 },
      { code: '5212', debit: 1500, credit: 0 },
    ]);
    expect(
      (
        await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = $2`,
          [B, id]
        )
      ).rows[0].n
    ).toBe('2');

    const removed = await deleteExpense(
      new NextRequest(`http://localhost/api/expenses/${id}?reason=duplicate`, { method: 'DELETE', headers }),
      { params: { id } }
    );
    expect(removed.status).toBe(200);
    expect(await activeLines(id)).toEqual([]);
    const reversalsAfterDelete = (
      await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = $2`,
        [B, id]
      )
    ).rows[0].n;
    expect(reversalsAfterDelete).toBe('4');
    const removedAgain = await deleteExpense(
      new NextRequest(`http://localhost/api/expenses/${id}?reason=duplicate`, { method: 'DELETE', headers }),
      { params: { id } }
    );
    expect(removedAgain.status).toBe(404);
    expect(
      (
        await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = $2`,
          [B, id]
        )
      ).rows[0].n
    ).toBe(reversalsAfterDelete);
    expect(await activeLines(earlier.json.expense.id)).toEqual(earlierLines);
  });

  test('idempotency conflicts, cancellation, and concurrent edits keep one supplier movement', async () => {
    const rent = await category(`Guard ${tag}`, '5217');
    const bill = {
      category_id: rent,
      amount: 400,
      payment_mode: 'on_account',
      supplier_id: SUP,
      expense_date: DAY,
      description: 'same payload',
    };
    const key = randomUUID();
    const before = await counts();
    const created = await post(bill, key);
    expect(created.status).toBe(201);
    expect(created.json.expense.idempotency_payload_hash).toHaveLength(64);
    const replay = await post(bill, key);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotent).toBe(true);
    expect(replay.json.expense.id).toBe(created.json.expense.id);

    const different = await post({ ...bill, amount: 900, description: 'different payload' }, key);
    expect(different.status).toBe(409);
    expect(different.json.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(different.json.expense).toBeUndefined();

    await pool.query(`UPDATE expenses SET idempotency_payload_hash = NULL WHERE id = $1`, [created.json.expense.id]);
    const legacyReplay = await post(bill, key);
    expect(legacyReplay.status).toBe(200);
    expect(legacyReplay.json.expense.id).toBe(created.json.expense.id);
    const legacyConflict = await post({ ...bill, amount: 250 }, key);
    expect(legacyConflict.status).toBe(409);
    expect(legacyConflict.json.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const removed = await deleteExpense(
      new NextRequest(`http://localhost/api/expenses/${created.json.expense.id}?reason=cancel`, { method: 'DELETE', headers }),
      { params: { id: created.json.expense.id } }
    );
    expect(removed.status).toBe(200);
    const afterCancel = await post({ ...bill, description: 'retry after cancel' }, key);
    expect(afterCancel.status).toBe(409);
    expect(afterCancel.json.code).toBe('IDEMPOTENCY_REQUEST_CANCELLED');
    const sameKeyRows = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM expenses WHERE business_id = $1 AND idempotency_key = $2`,
      [B, key]
    );
    expect(sameKeyRows.rows[0].n).toBe('1');

    const againKey = randomUUID();
    const [first, second] = await Promise.all([post(bill, againKey), post(bill, againKey)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.json.expense.id).toBe(second.json.expense.id);
    const afterRetries = await counts();
    expect(Number(afterRetries.expenses) - Number(before.expenses)).toBe(2);
    expect(afterRetries.balance - before.balance).toBeCloseTo(400, 2);

    const open = await post({ ...bill, amount: 1000, description: 'concurrent base' });
    expect(open.status).toBe(201);
    const openId = open.json.expense.id;
    const originalVersion = open.json.expense.updated_at ?? null;
    const started = await counts();
    const edit = (amount: number, expectedUpdatedAt: string | null) =>
      putExpense(
        new NextRequest(`http://localhost/api/expenses/${openId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            amount,
            category_id: rent,
            payment_mode: 'on_account',
            supplier_id: SUP,
            expense_date: DAY,
            description: `concurrent ${amount}`,
            expected_updated_at: expectedUpdatedAt,
          }),
        }),
        { params: { id: openId } }
      ).then(async (response) => ({ status: response.status, json: await response.json() }));
    const [to1500, to1800] = await Promise.all([edit(1500, originalVersion), edit(1800, originalVersion)]);
    const results = [to1500, to1800];
    const winner = results.find((result) => result.status === 200);
    const stale = results.find((result) => result.status === 409);
    expect(winner).toBeDefined();
    expect(stale?.status).toBe(409);
    expect(stale?.json.code).toBe('EXPENSE_EDIT_CONFLICT');
    expect(stale?.json.expense).toBeUndefined();
    const savedAmount = Number(winner?.json.expense.amount);
    expect([1500, 1800]).toContain(savedAmount);
    const savedRow = (
      await pool.query<{ amount: string; description: string; updated_at: string | null }>(
        `SELECT amount::text, description, to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at
           FROM expenses WHERE id = $1`,
        [openId]
      )
    ).rows[0];
    expect(Number(savedRow.amount)).toBe(savedAmount);
    expect(savedRow.description).toBe(`concurrent ${savedAmount}`);
    expect(savedRow.updated_at).toBe(winner?.json.expense.updated_at);
    expect(savedRow.updated_at).not.toBe(originalVersion);
    const afterEdits = await counts();
    expect(afterEdits.balance - started.balance).toBeCloseTo(savedAmount - 1000, 2);
    expect(await activeLines(openId)).toEqual([
      { code: '2101', debit: 0, credit: savedAmount },
      { code: '5217', debit: savedAmount, credit: 0 },
    ]);
    const linesBeforeStaleRetry = (
      await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'expense' AND voucher_id = $2`,
        [B, openId]
      )
    ).rows[0].n;
    const staleRetry = await edit(savedAmount === 1500 ? 1800 : 1500, originalVersion);
    expect(staleRetry.status).toBe(409);
    expect(staleRetry.json.code).toBe('EXPENSE_EDIT_CONFLICT');
    expect(Number((await pool.query<{ amount: string }>(`SELECT amount::text FROM expenses WHERE id = $1`, [openId])).rows[0].amount)).toBe(
      savedAmount
    );
    expect((await counts()).balance).toBeCloseTo(afterEdits.balance, 2);
    expect(
      (
        await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'expense' AND voucher_id = $2`,
          [B, openId]
        )
      ).rows[0].n
    ).toBe(linesBeforeStaleRetry);

    const change = (id: string, amount: number, expectedUpdatedAt: string | null) =>
      putExpense(
        new NextRequest(`http://localhost/api/expenses/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            amount,
            category_id: rent,
            payment_mode: 'on_account',
            supplier_id: SUP,
            expense_date: DAY,
            description: `saved ${amount}`,
            expected_updated_at: expectedUpdatedAt,
          }),
        }),
        { params: { id } }
      ).then(async (response) => ({ status: response.status, json: await response.json() }));

    const sequential = await post({ ...bill, amount: 1000, description: 'sequential' });
    const sequentialId = sequential.json.expense.id;
    const sequentialStart = await counts();
    let sequentialVersion: string | null = sequential.json.expense.updated_at ?? null;
    for (const amount of [1500, 1800]) {
      const step = await change(sequentialId, amount, sequentialVersion);
      expect(step.status).toBe(200);
      expect(Number(step.json.expense.amount)).toBe(amount);
      expect(step.json.expense.updated_at).not.toBe(sequentialVersion);
      sequentialVersion = step.json.expense.updated_at;
    }
    const sequentialEnd = await counts();
    expect(sequentialEnd.balance - sequentialStart.balance).toBeCloseTo(800, 2);
    const sequentialGone = await deleteExpense(
      new NextRequest(`http://localhost/api/expenses/${sequentialId}?reason=done`, { method: 'DELETE', headers }),
      { params: { id: sequentialId } }
    );
    expect(sequentialGone.status).toBe(200);
    expect((await counts()).balance).toBeCloseTo(sequentialStart.balance - 1000, 2);
    expect(await activeLines(sequentialId)).toEqual([]);

    const raced = await post({ ...bill, amount: 1000, description: 'edit and cancel' });
    const racedId = raced.json.expense.id;
    const racedStart = await counts();
    const [racedEdit, racedDelete] = await Promise.all([
      change(racedId, 1600, raced.json.expense.updated_at ?? null),
      deleteExpense(
        new NextRequest(`http://localhost/api/expenses/${racedId}?reason=race`, { method: 'DELETE', headers }),
        { params: { id: racedId } }
      ),
    ]);
    expect(racedDelete.status).toBe(200);
    expect([200, 404]).toContain(racedEdit.status);
    expect((await counts()).balance).toBeCloseTo(racedStart.balance - 1000, 2);
    expect(await activeLines(racedId)).toEqual([]);

    const fragile = await post({ ...bill, amount: 1000, description: 'rollback edit' });
    const fragileId = fragile.json.expense.id;
    const fragileLines = await activeLines(fragileId);
    const fragileBalance = (await counts()).balance;
    const fragileVersion = (
      await pool.query<{ updated_at: string | null }>(
        `SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at FROM expenses WHERE id = $1`,
        [fragileId]
      )
    ).rows[0].updated_at;
    const account = await accountId('5217');
    await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [account]);
    const failed = await change(fragileId, 1700, fragile.json.expense.updated_at ?? null);
    await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [account]);
    expect(failed.status).toBe(400);
    expect(failed.json.code).toBe('EXPENSE_INVALID');
    expect((await counts()).balance).toBeCloseTo(fragileBalance, 2);
    expect(await activeLines(fragileId)).toEqual(fragileLines);
    const fragileAfter = (
      await pool.query<{ updated_at: string | null; amount: string }>(
        `SELECT amount::text, to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at FROM expenses WHERE id = $1`,
        [fragileId]
      )
    ).rows[0];
    expect(Number(fragileAfter.amount)).toBe(1000);
    expect(fragileAfter.updated_at).toBe(fragileVersion);
  });
});
