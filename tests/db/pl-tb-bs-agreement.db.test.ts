/**
 * Real-PostgreSQL tests: an inactive account that still has ledger lines keeps the trial balance
 * balanced and stays in the Profit & Loss, and the balance sheet's current-year profit equals the
 * P&L net profit. Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
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
import { buildProfitAndLoss, flattenNodes } from '@/lib/reports/profit-loss';
import { GET as trialBalance } from '@/app/api/reports/trial-balance/route';
import { GET as balanceSheet } from '@/app/api/reports/balance-sheet/route';

d('Trial balance, balance sheet and P&L agree (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const acc = { cash: randomUUID(), capital: randomUUID(), sales: randomUUID(), rent: randomUUID(), old: randomUUID() };
  const AS_ON = '2026-09-30';

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
      [B, `PL agreement ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Admin', $3, true)`,
      [U, B, `93${Date.now().toString().slice(-8)}`]
    );
    await pool.query(
      `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature) VALUES
         ($1, $6, 'PT-1101', 'Cash', 'asset', 'debit'),
         ($2, $6, 'PT-3001', 'Capital', 'capital', 'credit'),
         ($3, $6, 'PT-4101', 'Sales', 'income', 'credit'),
         ($4, $6, 'PT-5201', 'Rent', 'expense', 'debit'),
         ($5, $6, 'PT-5999', 'Old expense', 'expense', 'debit')`,
      [acc.cash, acc.capital, acc.sales, acc.rent, acc.old, B]
    );
    const post = async (date: string, dr: string, cr: string, amount: number) => {
      const voucher = randomUUID();
      await pool.query(
        `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
         VALUES ($1, $2, $3, $4, 'P&L agreement test', $5, $6)`,
        [B, voucher, `JV-${tag}-${voucher.slice(0, 6)}`, date, BR, U]
      );
      await pool.query(
        `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
         VALUES ($1, $2, $3, 'journal', $4, $6, $7, 0), ($1, $2, $3, 'journal', $5, $6, 0, $7)`,
        [B, BR, voucher, dr, cr, date, amount]
      );
    };
    await post('2025-12-01', acc.cash, acc.sales, 400);
    await post('2026-04-05', acc.cash, acc.capital, 10000);
    await post('2026-05-10', acc.cash, acc.sales, 2500);
    await post('2026-06-10', acc.rent, acc.cash, 700);
    await post('2026-07-10', acc.old, acc.cash, 300);
    await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [acc.old]);
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

  test('trial balance keeps the inactive account and balances', async () => {
    const { status, json } = await get(trialBalance, '/api/reports/trial-balance', { as_on_date: AS_ON });
    expect(status).toBe(200);
    const old = json.accounts.find((a: any) => a.account_code === 'PT-5999');
    expect(old).toMatchObject({ is_active: false, debit: 300 });
    expect(json.totals.total_debit).toBeCloseTo(json.totals.total_credit, 2);
    expect(json.is_balanced).toBe(true);
  });

  test('P&L includes the inactive account and its net equals the balance sheet current-year profit', async () => {
    const pl = await buildProfitAndLoss({
      businessId: B,
      fromDate: '2026-04-01',
      toDate: AS_ON,
      branch: { kind: 'all' },
      consolidated: true,
    });
    const old = flattenNodes(pl.sections.operating_expense.accounts).find((n) => n.account_code === 'PT-5999');
    expect(old).toMatchObject({ is_active: false, amount: 300 });
    expect(pl.net_profit).toBe(1500);
    expect(pl.ledger_check.difference).toBe(0);

    const { status, json } = await get(balanceSheet, '/api/reports/balance-sheet', { as_on_date: AS_ON });
    expect(status).toBe(200);
    expect(json.equity.retained_earnings.current_year_profit).toBeCloseTo(pl.net_profit, 2);
    expect(json.equity.retained_earnings.opening).toBeCloseTo(400, 2);
    expect(json.is_balanced).toBe(true);
    expect(json.assets.total).toBeCloseTo(10000 + 400 + 2500 - 700 - 300, 2);
  });
});
