/**
 * Dashboard cash flow card (GET /api/dashboard/cash-flow) reads the cash and bank ledgers.
 * Connects only after current_database() is kh_phase2_test on localhost port 5433.
 * Creates its own business and removes only that business.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
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
    throw new Error('Refusing dashboard cash flow tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing dashboard cash flow tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

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
import { insertVoucherLines } from '@/lib/accounting/voucher-posting';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { GET as dashboardCashFlow } from '@/app/api/dashboard/cash-flow/route';
import { GET as cashFlowReport } from '@/app/api/reports/cash-flow/route';

describe('dashboard cash flow reads the cash and bank ledgers', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const OWNER = randomUUID();
  const tag = B.slice(0, 8);
  const ids: Record<string, string> = {};

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Posts one balanced voucher: [account code, debit, credit]. Returns the voucher id. */
  async function post(
    voucherType: string,
    date: string,
    lines: Array<[string, number, number]>,
    businessId = B
  ): Promise<string> {
    const voucherId = randomUUID();
    await tx((c) =>
      insertVoucherLines(c, {
        businessId,
        branchId: null,
        voucherId,
        voucherType,
        entryDate: date,
        reference: null,
        lines: lines.map(([code, debit, credit]) => ({
          accountId: ids[`${businessId}:${code}`],
          debit,
          credit,
          narration: `${voucherType} ${tag}`,
        })),
      })
    );
    return voucherId;
  }

  async function get(handler: (r: NextRequest) => Promise<Response>, url: string) {
    const res = await handler(
      new NextRequest(`http://localhost${url}`, {
        headers: {
          'x-authenticated-user-id': OWNER,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
      })
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  async function purge() {
    await tx(async (c) => {
      await withLedgerDelete(c, 'tenant_purge', null, async () => {
        await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
      });
    });
    await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]).catch(() => {});
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string | null; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (
      info.db !== 'kh_phase2_test' ||
      info.port !== 5433 ||
      !info.addr ||
      (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))
    ) {
      throw new Error(`Refusing dashboard cash flow tests against ${info.db} at ${info.addr}:${info.port}`);
    }

    const phone = Date.now().toString().slice(-8);
    for (const [id, name, gstin] of [
      [B, `CashFlow ${tag}`, `27AABCF${tag.slice(0, 4).toUpperCase()}E1Z5`],
      [OTHER, `CashFlow other ${tag}`, `29AABCF${tag.slice(0, 4).toUpperCase()}F1Z5`],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, $4, 'regular')`,
        [id, name, gstin, gstin.slice(0, 2)]
      );
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [id]);
      const accounts = await pool.query<{ id: string; account_code: string }>(
        `SELECT id, account_code FROM accounts WHERE business_id = $1`,
        [id]
      );
      for (const a of accounts.rows) ids[`${id}:${a.account_code}`] = a.id;
    }
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [OWNER, B, `93${phone}`]
    );
    for (const code of ['1101', '1102', '1103', '1130', '2109', '2202', '3001', '3003', '4101', '5213']) {
      if (!ids[`${B}:${code}`]) throw new Error(`Seeded chart has no account ${code}`);
    }

    // Before the year: becomes the opening balance.
    await post('journal', '2026-03-20', [['1101', 1000, 0], ['3001', 0, 1000]]);
    // Owner puts money into the bank.
    await post('journal', '2026-05-10', [['1102', 50000, 0], ['3001', 0, 50000]]);
    // Bank to cash: money moved between own accounts.
    await post('contra', '2026-05-12', [['1101', 20000, 0], ['1102', 0, 20000]]);
    // Counter cash sale posted on the invoice voucher, with no payments row.
    await post('invoice', '2026-06-05', [['1101', 118, 0], ['4101', 0, 100], ['2109', 0, 18]]);
    // Rent paid in cash.
    await post('expense', '2026-06-20', [['5213', 3000, 0], ['1101', 0, 3000]]);
    // GST deposited to the portal: leaves the bank, sits in the electronic cash ledger.
    await post('journal', '2026-07-01', [['1130', 500, 0], ['1102', 0, 500]]);
    // Loan received in the bank.
    await post('journal', '2026-07-10', [['1102', 10000, 0], ['2202', 0, 10000]]);
    // Owner takes cash out.
    await post('journal', '2026-08-01', [['3003', 2000, 0], ['1101', 0, 2000]]);
    // Receipt entered in August and reversed in September.
    const reversed = await post('payment', '2026-08-05', [['1101', 700, 0], ['1103', 0, 700]]);
    await tx((c) =>
      reverseVoucherLedgerEntries(c, {
        businessId: B,
        voucherType: 'payment',
        voucherId: reversed,
        reason: 'Entered against the wrong party',
        entryDate: '2026-09-02',
      })
    );
    // Another business's capital must not appear.
    await post('journal', '2026-05-10', [['1101', 77777, 0], ['3001', 0, 77777]], OTHER);
  });

  afterAll(async () => {
    try {
      if (pool) await purge();
    } finally {
      await closePool();
    }
  });

  test('counts capital, loans, drawings, tax deposits and cash sales; skips contra and reversed entries', async () => {
    const res = await get(dashboardCashFlow, '/api/dashboard/cash-flow?fiscal_year=2026');
    expect(res.status).toBe(200);
    const { summary, months } = res.json;

    expect(summary.opening_balance).toBe(1000);
    expect(summary.total_incoming).toBe(60118);
    expect(summary.total_outgoing).toBe(5500);
    expect(summary.closing_balance).toBe(55618);

    expect(summary.breakdown.incoming.lines).toEqual([
      { key: 'sales', label: 'Sales and customer receipts', amount: 118 },
      { key: 'capital', label: 'Capital added by owner', amount: 50000 },
      { key: 'loans', label: 'Loans received', amount: 10000 },
    ]);
    expect(summary.breakdown.outgoing.lines).toEqual([
      { key: 'expenses', label: 'Expenses', amount: 3000 },
      { key: 'taxes', label: 'Taxes paid (GST, TDS)', amount: 500 },
      { key: 'drawings', label: 'Owner drawings', amount: 2000 },
    ]);

    const byMonth = Object.fromEntries(months.map((m: any) => [m.month, m]));
    expect(byMonth['2026-05']).toMatchObject({ incoming: 50000, outgoing: 0, closing: 51000 });
    expect(byMonth['2026-06']).toMatchObject({ incoming: 118, outgoing: 3000, closing: 48118 });
    expect(byMonth['2026-07']).toMatchObject({ incoming: 10000, outgoing: 500, closing: 57618 });
    expect(byMonth['2026-08']).toMatchObject({ incoming: 0, outgoing: 2000, closing: 55618 });
    expect(byMonth['2026-09']).toMatchObject({ incoming: 0, outgoing: 0, closing: 55618 });
    expect(byMonth['2027-03'].closing).toBe(55618);
  });

  test('closing balance equals the cash and bank ledgers and the cash flow report', async () => {
    const ledger = await pool.query<{ balance: string }>(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS balance
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1 AND a.account_code IN ('1101', '1102') AND l.entry_date <= '2027-03-31'`,
      [B]
    );
    const card = await get(dashboardCashFlow, '/api/dashboard/cash-flow?fiscal_year=2026');
    expect(card.json.summary.closing_balance).toBe(Number(ledger.rows[0].balance));

    const report = await get(cashFlowReport, '/api/reports/cash-flow?from_date=2026-04-01&to_date=2027-03-31');
    expect(report.status).toBe(200);
    expect(report.json.opening_cash_balance).toBe(1000);
    expect(report.json.closing_cash_balance).toBe(55618);
    expect(report.json.unreconciled_difference).toBe(0);
  });

  test('the year before shows only its own entry', async () => {
    const res = await get(dashboardCashFlow, '/api/dashboard/cash-flow?fiscal_year=2025');
    expect(res.status).toBe(200);
    expect(res.json.summary).toMatchObject({
      opening_balance: 0,
      total_incoming: 1000,
      total_outgoing: 0,
      closing_balance: 1000,
    });
    expect(res.json.months.find((m: any) => m.month === '2026-03')).toMatchObject({ incoming: 1000, closing: 1000 });
  });
});
