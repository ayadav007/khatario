/**
 * Real-PostgreSQL test: the Compare API lines up the Profit & Loss of several periods and each column
 * equals the Standard report for the same dates. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertReportAccess: jest.fn().mockResolvedValue(undefined),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GET as compare } from '@/app/api/reports/profit-loss/compare/route';
import { GET as profitLoss } from '@/app/api/reports/profit-loss/route';

d('Profit & Loss compare API (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const ids: Record<string, string> = {};

  const PATH = '/api/reports/profit-loss/compare';
  const q = { from_date: '2026-07-01', to_date: '2026-09-30' };

  const get = async (handler: (r: NextRequest) => Promise<Response>, path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    const res = await handler(
      new NextRequest(`http://localhost${path}?${qs}`, {
        headers: { 'x-authenticated-user-id': U, 'x-authenticated-business-id': B },
      })
    );
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `PL compare ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Admin', $3, true)`,
      [U, B, `95${Date.now().toString().slice(-8)}`]
    );
    const defs: [string, string, string, string][] = [
      ['1101', 'Cash', 'asset', 'debit'],
      ['4101', 'Sales', 'income', 'credit'],
      ['5213', 'Misc expense', 'expense', 'debit'],
      ['5215', 'Bank charges', 'expense', 'debit'],
    ];
    for (const [code, name, type, nature] of defs) {
      ids[code] = randomUUID();
      await pool.query(
        `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [ids[code], B, code, name, type, nature]
      );
    }
    const post = async (date: string, dr: string, cr: string, amount: number) => {
      const voucher = randomUUID();
      await pool.query(
        `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
         VALUES ($1, $2, $3, $4, 'PL compare test', $5, $6)`,
        [B, voucher, `JV-${tag}-${voucher.slice(0, 6)}`, date, BR, U]
      );
      await pool.query(
        `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
         VALUES ($1, $2, $3, 'journal', $4, $6, $7, 0), ($1, $2, $3, 'journal', $5, $6, 0, $7)`,
        [B, BR, voucher, ids[dr], ids[cr], date, amount]
      );
    };
    await post('2026-08-15', '1101', '4101', 1000);
    await post('2026-08-20', '5213', '1101', 200);
    await post('2026-05-15', '1101', '4101', 600);
    await post('2026-05-20', '5213', '1101', 150);
    await post('2026-05-25', '5215', '1101', 50);
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'tenant_purge', U, async () => {
        await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await c.query('COMMIT');
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
      await closePool();
    }
  });

  test('compares the period with the previous one', async () => {
    const cmp = await get(compare, PATH, q);
    expect(cmp.status).toBe(200);
    expect(cmp.json.compare).toBe('previous_period');
    expect(cmp.json.columns.map((c: any) => [c.from_date, c.to_date])).toEqual([
      ['2026-07-01', '2026-09-30'],
      ['2026-04-01', '2026-06-30'],
    ]);
    expect(cmp.json.net_profit).toEqual([800, 400]);
    const opex = cmp.json.sections.find((s: any) => s.key === 'operating_expense');
    expect(opex.rows.find((r: any) => r.account_code === '5215').amounts).toEqual([0, 50]);
  });

  test('every column equals the Standard report, consolidated and for one branch', async () => {
    for (const extra of [{}, { branch_id: BR }]) {
      const c = await get(compare, PATH, { ...q, ...extra });
      expect(c.status).toBe(200);
      for (let i = 0; i < c.json.columns.length; i++) {
        const col = c.json.columns[i];
        const std = await get(profitLoss, '/api/reports/profit-loss', { from_date: col.from_date, to_date: col.to_date, ...extra });
        expect(c.json.net_profit[i]).toBe(std.json.net_profit);
        expect(c.json.gross_profit[i]).toBe(std.json.gross_profit);
        expect(c.json.operating_profit[i]).toBe(std.json.operating_profit);
        expect(c.json.sections.map((s: any) => s.totals[i])).toEqual(std.json.sections.map((s: any) => s.total));
      }
    }
  });

  test('previous year, several periods and a custom period', async () => {
    const year = await get(compare, PATH, { ...q, compare: 'previous_year' });
    expect(year.json.columns[1]).toMatchObject({ from_date: '2025-07-01', to_date: '2025-09-30' });
    expect(year.json.net_profit[1]).toBe(0);
    expect((await get(compare, PATH, { ...q, count: '3' })).json.columns).toHaveLength(4);
    const custom = await get(compare, PATH, { ...q, compare: 'custom', compare_from: '2026-05-01', compare_to: '2026-05-31' });
    expect(custom.json.columns[1]).toMatchObject({ from_date: '2026-05-01', to_date: '2026-05-31' });
    expect(custom.json.net_profit[1]).toBe(400);
  });

  test('refuses a bad request, and ignores a query-string business', async () => {
    for (const bad of [
      { from_date: '2026-13-01', to_date: '2026-09-30' },
      { from_date: '2026-10-01', to_date: '2026-09-30' },
      { ...q, compare: 'weekly' },
      { ...q, count: '4' },
      { ...q, compare: 'custom', compare_from: '2026-05-01' },
    ]) {
      const r = await get(compare, PATH, bad);
      expect(r.status).toBe(400);
      expect(r.json.code).toBe('INVALID_COMPARE_REQUEST');
    }
    const bare = await compare(new NextRequest(`http://localhost${PATH}?business_id=${B}&user_id=${U}`));
    expect(bare.status).toBe(400);
  });
});
