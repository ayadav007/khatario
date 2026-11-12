/**
 * Real-PostgreSQL test: PATCH /api/accounts/[id] moves an income or expense account to another
 * Schedule III line, and the Schedule III report follows. Runs only when PHASE2_TEST_DATABASE_URL
 * points at a disposable database. Creates its own business and removes only that.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __s3Headers: typeof headerBag }).__s3Headers = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __s3Headers: { current: Record<string, string> } }).__s3Headers.current[
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

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { buildSchedule3 } from '@/lib/reports/schedule3-pl';
import { GET as getAccountRoute, PATCH as patchAccount } from '@/app/api/accounts/[id]/route';

d('PATCH /api/accounts/[id] schedule3_line (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const ids: Record<string, string> = {};

  const call = async (method: string, id: string, body: Record<string, unknown> | null) => {
    headerBag.current = {
      'x-authenticated-user-id': U,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
    const handler = method === 'GET' ? getAccountRoute : patchAccount;
    const res = await handler(
      new NextRequest(`http://localhost/api/accounts/${id}`, {
        method,
        headers: { 'content-type': 'application/json', ...headerBag.current },
        body: body ? JSON.stringify(body) : undefined,
      }),
      { params: { id } }
    );
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json };
  };
  const patch = (id: string, body: Record<string, unknown>) => call('PATCH', id, body);
  const getAccount = (id: string) => call('GET', id, null);

  beforeAll(async () => {
    pool = getPool();
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('accounting_chart', 'advanced_ledger', 'reports_advanced')
        GROUP BY plan_id HAVING COUNT(DISTINCT feature_id) = 3 LIMIT 1`
    );
    if (!plan.rows[0]) throw new Error('No plan grants accounting_chart, advanced_ledger, and reports_advanced');
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'S3 line %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [B, `S3 line ${tag}`]
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [B]
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [B, plan.rows[0].plan_id]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Admin', $3, true, 1, true)`,
      [U, B, `93${Date.now().toString().slice(-8)}`]
    );
    const defs: [string, string, string, string, boolean][] = [
      ['5217', 'Bank charges', 'expense', 'debit', true],
      ['5104', 'Cost of goods sold', 'expense', 'debit', true],
      ['1101', 'Cash', 'asset', 'debit', true],
      ['5901', 'Custom expense', 'expense', 'debit', false],
    ];
    for (const [code, name, type, nature, isSystem] of defs) {
      ids[code] = randomUUID();
      await pool.query(
        `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ids[code], B, code, name, type, nature, isSystem]
      );
    }
    const voucher = randomUUID();
    const date = '2026-09-15';
    await pool.query(
      `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
       VALUES ($1, $2, $3, $4, 'Schedule III line test', $5, $6)`,
      [B, voucher, `JV-${tag}`, date, BR, U]
    );
    await pool.query(
      `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
       VALUES ($1, $2, $3, 'journal', $4, $6, 250, 0), ($1, $2, $3, 'journal', $5, $6, 0, 250)`,
      [B, BR, voucher, ids['5901'], ids['1101'], date]
    );
  });

  async function purge(businessIds: string[]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'admin:seed_demo', null, async () => {
        await c.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [businessIds]);
        await c.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [businessIds]);
      });
      for (const id of businessIds) {
        await c.query(`DELETE FROM journal_entries WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM activity_logs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM accounts WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM account_groups WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  afterAll(async () => {
    try {
      if (pool) await purge([B]);
    } finally {
      await closePool();
    }
  });

  test('moves an account to another line, refuses bad or locked moves, and clears the override', async () => {
    const opts = {
      businessId: B,
      fromDate: '2026-04-01',
      toDate: '2026-09-30',
      branch: { kind: 'all' } as const,
      consolidated: true,
    };
    const id5217 = ids['5217'];
    const id5104 = ids['5104'];
    const id1101 = ids['1101'];
    const id5901 = ids['5901'];

    expect((await patch(id5901, { schedule3_line: 'finance_costs' })).status).toBe(200);
    const r = await buildSchedule3(opts);
    expect(r.statement.lines.finance_costs.amount).toBe(250);
    expect(r.statement.lines.other_expenses.amount).toBe(0);
    expect(r.difference).toBe(0);
    expect((await getAccount(id5901)).json.account.schedule3_line).toBe('finance_costs');
    expect((await patch(id5217, { schedule3_line: 'finance_costs' })).status).toBe(200); // system account allowed
    expect((await patch(id5901, { schedule3_line: 'changes_in_inventories' })).json.code).toBe('INVALID_SCHEDULE3_LINE');
    expect((await patch(id5104, { schedule3_line: 'other_expenses' })).json.code).toBe('SCHEDULE3_LINE_LOCKED');
    expect((await patch(id1101, { schedule3_line: 'other_expenses' })).json.code).toBe('INVALID_SCHEDULE3_LINE');
    expect((await patch(id5901, { schedule3_line: null })).status).toBe(200);
    expect((await buildSchedule3(opts)).statement.lines.other_expenses.amount).toBe(250);
    expect((await getAccount(id5901)).json.account.schedule3_line).toBeNull();
  });
});
