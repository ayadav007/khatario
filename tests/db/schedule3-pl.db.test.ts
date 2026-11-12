/**
 * Real-PostgreSQL test: the Schedule III report reads purchases and movement from the stock ledgers
 * and its profit for the period equals the Standard P&L net profit. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database.
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
import { buildProfitAndLoss } from '@/lib/reports/profit-loss';
import { buildSchedule3, loadStockMovements } from '@/lib/reports/schedule3-pl';
import { GET as scheduleIII } from '@/app/api/reports/profit-loss/schedule-iii/route';
import { GET as profitLoss } from '@/app/api/reports/profit-loss/route';

d('Schedule III report reads stock movements (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const ids: Record<string, string> = {};
  // Second business: a manufacturer whose raw-material stock has an opening-stock debit inside the year.
  const B2 = randomUUID();
  const BR2 = randomUUID();
  const U2 = randomUUID();
  const ids2: Record<string, string> = {};

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
      [B, `Schedule III ${tag}`]
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
    const defs: [string, string, string, string][] = [
      ['1101', 'Cash', 'asset', 'debit'],
      ['1104', 'Stock in trade', 'asset', 'debit'],
      ['2101', 'Creditors', 'liability', 'credit'],
      ['4101', 'Sales', 'income', 'credit'],
      ['5104', 'Cost of goods sold', 'expense', 'debit'],
      ['5106', 'Stock adjustment', 'expense', 'debit'],
      ['5212', 'Misc expense', 'expense', 'debit'],
    ];
    for (const [code, name, type, nature] of defs) {
      ids[code] = randomUUID();
      await pool.query(
        `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [ids[code], B, code, name, type, nature]
      );
    }
    const post = async (voucherType: string, dr: string, cr: string, amount: number) => {
      const voucher = randomUUID();
      const date = '2026-09-15';
      await pool.query(
        `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
         VALUES ($1, $2, $3, $4, 'Schedule III test', $5, $6)`,
        [B, voucher, `JV-${tag}-${voucher.slice(0, 6)}`, date, BR, U]
      );
      await pool.query(
        `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
         VALUES ($1, $2, $3, $7, $4, $6, $8, 0), ($1, $2, $3, $7, $5, $6, 0, $8)`,
        [B, BR, voucher, ids[dr], ids[cr], date, voucherType, amount]
      );
    };
    await post('purchase', '1104', '2101', 800);
    await post('purchase_return', '2101', '1104', 50);
    await post('invoice', '1101', '4101', 1000);
    await post('invoice', '5104', '1104', 600);
    await post('stock_adjustment', '5106', '1104', 20);
    await post('journal', '5212', '1101', 100);
    // Goods received from another branch: a purchase only in the branch's own view.
    await post('inter_branch_receipt', '1104', '2101', 200);

    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B2, `Schedule III mfg ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR2, B2]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Admin', $3, true)`,
      [U2, B2, `94${Date.now().toString().slice(-8)}`]
    );
    const defs2: [string, string, string, string][] = [
      ['1101', 'Cash', 'asset', 'debit'],
      ['1160', 'Raw material', 'asset', 'debit'],
      ['1162', 'Finished goods', 'asset', 'debit'],
      ['2101', 'Creditors', 'liability', 'credit'],
      ['3001', 'Capital', 'capital', 'credit'],
      ['4101', 'Sales', 'income', 'credit'],
      ['5104', 'Cost of goods sold', 'expense', 'debit'],
    ];
    for (const [code, name, type, nature] of defs2) {
      ids2[code] = randomUUID();
      await pool.query(
        `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [ids2[code], B2, code, name, type, nature]
      );
    }
    const post2 = async (voucherType: string, dr: string, cr: string, amount: number) => {
      const voucher = randomUUID();
      const date = '2026-06-15';
      await pool.query(
        `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
         VALUES ($1, $2, $3, $4, 'Schedule III test', $5, $6)`,
        [B2, voucher, `JV-${tag}-${voucher.slice(0, 6)}`, date, BR2, U2]
      );
      await pool.query(
        `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
         VALUES ($1, $2, $3, $7, $4, $6, $8, 0), ($1, $2, $3, $7, $5, $6, 0, $8)`,
        [B2, BR2, voucher, ids2[dr], ids2[cr], date, voucherType, amount]
      );
    };
    await post2('opening_stock', '1160', '3001', 100);
    await post2('purchase', '1160', '2101', 500);
    await post2('journal', '1162', '1160', 450);
    await post2('invoice', '1101', '4101', 700);
    await post2('invoice', '5104', '1162', 400);
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'tenant_purge', U, async () => {
        await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, B2]]);
      });
      await c.query('COMMIT');
      await pool
        .query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, B2]])
        .catch(() => {});
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
      await closePool();
    }
  });

  test('purchases and movement come from the stock ledger and profit matches the Standard report', async () => {
    const opts = {
      businessId: B,
      fromDate: '2026-04-01',
      toDate: '2026-09-30',
      branch: { kind: 'all' } as const,
      consolidated: true,
    };
    const stock = await loadStockMovements(opts);
    // movement includes the 200 inter-branch receipt seeded in beforeAll (Finding 3); it is not a purchase here
    expect(stock).toEqual([{ code: '1104', purchases: 750, movement: 330 }]);
    const r = await buildSchedule3(opts);
    expect(r.statement.lines.purchases_stock_in_trade.amount).toBe(750);
    expect(r.statement.lines.changes_in_inventories.amount).toBe(-150);
    expect(r.statement.lines.other_expenses.amount).toBe(20);
    expect(r.statement.profit_for_period).toBe(280);
    expect(r.difference).toBe(0);
    expect(r.standard_net_profit).toBe((await buildProfitAndLoss(opts)).net_profit);
    // a branch the business does not have sees nothing
    expect(
      await loadStockMovements({
        ...opts,
        branch: { kind: 'branches', branchIds: [randomUUID()], includeUnbranched: false },
      })
    ).toEqual([]);
  });

  test('an inter-branch receipt is a purchase only in a single-branch view', async () => {
    const opts = {
      businessId: B,
      fromDate: '2026-04-01',
      toDate: '2026-09-30',
      branch: { kind: 'all' } as const,
      consolidated: true,
    };
    // consolidated: not a purchase, only a movement
    const all = await loadStockMovements(opts);
    expect(all).toEqual([{ code: '1104', purchases: 750, movement: 330 }]);
    // single-branch view of the branch that holds the lines: counted as a purchase
    const branchOpts = { ...opts, consolidated: false, branch: { kind: 'branches' as const, branchIds: [BR], includeUnbranched: true } };
    const one = await loadStockMovements(branchOpts);
    expect(one).toEqual([{ code: '1104', purchases: 950, movement: 330 }]);
    const rb = await buildSchedule3(branchOpts);
    expect(rb.difference).toBe(0);
  });

  test('opening-stock debits on raw material are not a movement of the year', async () => {
    const opts = {
      businessId: B2,
      fromDate: '2026-04-01',
      toDate: '2026-09-30',
      branch: { kind: 'all' } as const,
      consolidated: true,
    };
    const stock = await loadStockMovements(opts);
    expect(stock).toEqual([
      { code: '1160', purchases: 500, movement: 50 },
      { code: '1162', purchases: 0, movement: 50 },
    ]);
    const r = await buildSchedule3(opts);
    expect(r.statement.lines.materials_consumed.amount).toBe(450);
    expect(r.statement.lines.purchases_stock_in_trade.amount).toBe(0);
    expect(r.statement.lines.changes_in_inventories.amount).toBe(-50);
    expect(r.statement.profit_for_period).toBe(300);
    expect(r.difference).toBe(0);
  });

  test('the route serves the period and the same dates a year earlier', async () => {
    const q = { from_date: '2026-04-01', to_date: '2026-09-30' };
    const s3 = await get(scheduleIII, '/api/reports/profit-loss/schedule-iii', q);
    const std = await get(profitLoss, '/api/reports/profit-loss', q);
    expect(s3.status).toBe(200);
    expect(s3.json.current.profit_for_period).toBe(std.json.net_profit);
    expect(s3.json.agreement).toEqual({ standard_net_profit: std.json.net_profit, difference: 0 });
    expect(s3.json.previous_period).toEqual({ from_date: '2025-04-01', to_date: '2025-09-30' });
    expect(s3.json.previous.profit_for_period).toBe(0);
    expect(s3.json.previous.total_income).toBe(0);
    // a query-string business is ignored: no session headers → 400
    const bare = await scheduleIII(
      new NextRequest(`http://localhost/api/reports/profit-loss/schedule-iii?business_id=${B}&user_id=${U}`)
    );
    expect(bare.status).toBe(400);
  });
});
