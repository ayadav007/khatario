/**
 * Chart of accounts hierarchy integrity.
 * Connects only after current_database() is kh_phase2_test on localhost port 5433.
 * Creates its own businesses and removes only those rows.
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
    throw new Error('Refusing account hierarchy tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing account hierarchy tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __coaHeaders: typeof headerBag }).__coaHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __coaHeaders: { current: Record<string, string> } }).__coaHeaders.current[
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
import { POST as postAccount } from '@/app/api/accounts/route';
import { PATCH as patchAccount, DELETE as deleteAccount } from '@/app/api/accounts/[id]/route';
import { POST as postJournal } from '@/app/api/journal-entries/route';
import { GET as getTrialBalance } from '@/app/api/reports/trial-balance/route';
import { GET as getMyAccounts, PUT as putMyAccounts } from '@/app/api/accounts/my-accounts/route';
import { assembleBalanceSheet, financialYearStartFor, type BsAccountRow } from '@/lib/reports/balance-sheet';
import { loadGroupMap } from '@/lib/reports/account-groups';
import { buildProfitAndLoss, flattenNodes } from '@/lib/reports/profit-loss';

const DAY = '2026-10-19';

describe('account hierarchy integrity', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const tag = A.slice(0, 8);

  function session(userId: string, businessId: string) {
    headerBag.current = {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': '1',
    };
  }

  async function call(
    handler: (request: NextRequest, ctx?: { params: { id: string } }) => Promise<Response>,
    method: string,
    path: string,
    body: Record<string, unknown> | null,
    id?: string,
  ) {
    const res = await handler(
      new NextRequest(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headerBag.current },
        body: body ? JSON.stringify(body) : undefined,
      }),
      id ? { params: { id } } : undefined,
    );
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json };
  }

  async function accountCount(businessId: string) {
    const row = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM accounts WHERE business_id = $1`, [
      businessId,
    ]);
    return Number(row.rows[0].n);
  }

  async function groupId(businessId: string, code: string) {
    const row = await pool.query<{ id: string }>(
      `SELECT id FROM account_groups WHERE business_id = $1 AND group_code = $2`,
      [businessId, code],
    );
    if (!row.rows[0]) throw new Error(`Missing group ${code}`);
    return row.rows[0].id;
  }

  async function accountByCode(businessId: string, code: string) {
    const row = await pool.query<{ id: string; nature: string }>(
      `SELECT id, nature FROM accounts WHERE business_id = $1 AND account_code = $2`,
      [businessId, code],
    );
    if (!row.rows[0]) throw new Error(`Missing account ${code}`);
    return row.rows[0];
  }

  async function purge(ids: string[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'admin:seed_demo', null, async () => {
        await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
      });
      await client.query(`DELETE FROM journal_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM activity_logs WHERE business_id = ANY($1::uuid[])`, [ids]);
      for (const id of ids) {
        await client.query(`DELETE FROM accounts WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM account_groups WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await client.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
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

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string | null; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !info.addr || (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))) {
      throw new Error(`Refusing account hierarchy tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('accounting_chart', 'advanced_ledger', 'reports_advanced')
        GROUP BY plan_id
        HAVING COUNT(DISTINCT feature_id) = 3
        LIMIT 1`,
    );
    if (!plan.rows[0]) {
      throw new Error('No plan grants accounting_chart, advanced_ledger, and reports_advanced on kh_phase2_test');
    }
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'COA-H %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
    const phone = Date.now().toString().slice(-7);
    for (const [id, name, gst, userId, userPhone] of [
      [A, `COA-H A ${tag}`, `27ABCDE${tag.slice(0, 4)}A1Z5`, ownerA, `76${phone}1`],
      [B, `COA-H B ${tag}`, `29ABCDE${tag.slice(0, 4)}A1Z5`, ownerB, `76${phone}2`],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
         VALUES ($1, $2, $3, $4, 'regular', 'billing')`,
        [id, name, gst, gst.slice(0, 2)],
      );
      await pool.query(
        `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
        [id],
      );
      await pool.query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
         VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
        [id, plan.rows[0].plan_id],
      );
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
      await pool.query(
        `INSERT INTO branches (id, business_id, name, state_code, is_default, is_active)
         VALUES ($1, $2, 'Main', $3, true, true)`,
        [randomUUID(), id, gst.slice(0, 2)],
      );
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
         VALUES ($1, $2, $3, $4, true, 1, true)`,
        [userId, id, name, userPhone],
      );
    }
  });

  afterAll(async () => {
    try {
      if (pool) await purge([A, B]);
    } finally {
      await closePool();
    }
  });

  test('rejects bad classification without writing a row, and keeps seeded contra nature', async () => {
    session(ownerA, A);
    const before = await accountCount(A);
    const expenseGroup = await groupId(A, '5200');
    const assetGroup = await groupId(A, '1100');
    const badNature = await call(postAccount, 'POST', '/api/accounts', {
      business_id: A,
      created_by: ownerA,
      account_code: `HXN${tag}`,
      account_name: 'Bad nature',
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'credit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(badNature.status).toBe(400);
    expect(badNature.json.code).toBe('INVALID_NATURE');

    const badGroup = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXG${tag}`,
      account_name: 'Bad group',
      account_type: 'expense',
      account_group_id: assetGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(badGroup.status).toBe(400);
    expect(badGroup.json.code).toBe('ACCOUNT_TYPE_GROUP_MISMATCH');
    expect(await accountCount(A)).toBe(before);

    const dep = await accountByCode(A, '1202');
    expect(dep.nature).toBe('credit');
  });

  test('posts a child ledger once through trial balance, profit and loss, and the balance sheet', async () => {
    session(ownerA, A);
    const expenseGroup = await groupId(A, '5200');
    const incomeGroup = await groupId(A, '4100');
    const parent = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXP${tag}`,
      account_name: `Parent ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(parent.status).toBe(201);
    const parentId = (parent.json.account as { id: string }).id;
    const child = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXC${tag}`,
      account_name: `Child ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      parent_account_id: parentId,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(child.status).toBe(201);
    const childId = (child.json.account as { id: string }).id;
    const grand = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXG${tag}`,
      account_name: `Grand ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      parent_account_id: childId,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(grand.status).toBe(201);
    const grandId = (grand.json.account as { id: string }).id;

    const cash = await accountByCode(A, '1101');
    const journal = await call(postJournal, 'POST', '/api/journal-entries', {
      business_id: A,
      entry_date: DAY,
      narration: 'child expense',
      lines: [
        { account_id: grandId, debit: 100, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100 },
      ],
    });
    if (journal.status !== 201) throw new Error(`journal ${journal.status} ${JSON.stringify(journal.json)}`);

    const lines = await pool.query<{ account_id: string; n: string; debit: string }>(
      `SELECT account_id, COUNT(*)::text AS n, COALESCE(SUM(debit), 0)::text AS debit
         FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'journal'
        GROUP BY account_id`,
      [A],
    );
    const byAccount = new Map(lines.rows.map((row) => [row.account_id, row]));
    expect(byAccount.get(grandId)?.n).toBe('1');
    expect(Number(byAccount.get(grandId)?.debit)).toBe(100);
    expect(byAccount.has(parentId)).toBe(false);
    expect(byAccount.has(childId)).toBe(false);

    const totals = await pool.query<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(debit), 0)::text AS debit, COALESCE(SUM(credit), 0)::text AS credit
         FROM ledger_entry_lines WHERE business_id = $1`,
      [A],
    );
    expect(Number(totals.rows[0].debit)).toBe(Number(totals.rows[0].credit));

    const fyStart = financialYearStartFor(DAY);
    const pl = await buildProfitAndLoss({
      businessId: A,
      fromDate: fyStart,
      toDate: DAY,
      branch: { kind: 'all' },
      consolidated: true,
    });
    const flat = flattenNodes(pl.sections.operating_expense.accounts);
    const parentNode = flat.find((node) => node.id === parentId);
    const grandNode = flat.find((node) => node.id === grandId);
    expect(pl.sections.operating_expense.total).toBe(100);
    expect(grandNode?.amount).toBe(100);
    expect(parentNode?.amount).toBe(0);
    expect(parentNode?.total).toBe(100);
    expect(pl.net_profit).toBe(-100);

    const bsRows = await pool.query(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_group_id, a.nature, a.is_active,
              ag.group_name AS account_group_name,
              COALESCE(SUM(l.debit), 0)::float AS debit,
              COALESCE(SUM(l.credit), 0)::float AS credit
         FROM accounts a
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         LEFT JOIN ledger_entry_lines l
                ON l.account_id = a.id AND l.business_id = a.business_id AND l.entry_date <= $2::date
        WHERE a.business_id = $1 AND a.account_type IN ('asset', 'liability', 'capital')
        GROUP BY a.id, ag.group_name
       HAVING a.is_active = true OR COUNT(l.id) > 0`,
      [A, DAY],
    );
    const bs = assembleBalanceSheet(bsRows.rows as BsAccountRow[], await loadGroupMap(A), {
      previousYearsProfit: 0,
      currentYearProfit: pl.net_profit,
    });
    expect(bs.is_balanced).toBe(true);

    const income = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXI${tag}`,
      account_name: `Income ${tag}`,
      account_type: 'income',
      account_group_id: incomeGroup,
      nature: 'credit',
      opening_balance: 0,
      opening_balance_type: 'credit',
    });
    expect(income.status).toBe(201);
    const incomeId = (income.json.account as { id: string }).id;
    const sale = await call(postJournal, 'POST', '/api/journal-entries', {
      entry_date: DAY,
      narration: 'child income',
      lines: [
        { account_id: cash.id, debit: 40, credit: 0 },
        { account_id: incomeId, debit: 0, credit: 40 },
      ],
    });
    expect(sale.status).toBe(201);
    const plAfter = await buildProfitAndLoss({
      businessId: A,
      fromDate: fyStart,
      toDate: DAY,
      branch: { kind: 'all' },
      consolidated: true,
    });
    expect(plAfter.sections.operating_income.total).toBe(40);
    expect(plAfter.sections.operating_expense.total).toBe(100);
    expect(plAfter.net_profit).toBe(-60);

    const cycle = await call(patchAccount, 'PATCH', `/api/accounts/${parentId}`, { parent_account_id: grandId }, parentId);
    expect(cycle.status).toBe(400);
    expect(cycle.json.code).toBe('PARENT_CYCLE');
    const parentStillRoot = await pool.query<{ parent_account_id: string | null }>(
      `SELECT parent_account_id FROM accounts WHERE id = $1`,
      [parentId],
    );
    expect(parentStillRoot.rows[0].parent_account_id).toBeNull();

    const liabilityGroup = await groupId(A, '2100');
    const liabilityParent = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HLP${tag}`,
      account_name: `Liability parent ${tag}`,
      account_type: 'liability',
      account_group_id: liabilityGroup,
      nature: 'credit',
      opening_balance: 0,
      opening_balance_type: 'credit',
    });
    expect(liabilityParent.status).toBe(201);
    const liabilityParentId = (liabilityParent.json.account as { id: string }).id;
    const liabilityChild = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HLC${tag}`,
      account_name: `Liability child ${tag}`,
      account_type: 'liability',
      account_group_id: liabilityGroup,
      parent_account_id: liabilityParentId,
      nature: 'credit',
      opening_balance: 0,
      opening_balance_type: 'credit',
    });
    expect(liabilityChild.status).toBe(201);
    const liabilityChildId = (liabilityChild.json.account as { id: string }).id;
    const liabilityJournal = await call(postJournal, 'POST', '/api/journal-entries', {
      entry_date: DAY,
      narration: 'child liability',
      lines: [
        { account_id: cash.id, debit: 30, credit: 0 },
        { account_id: liabilityChildId, debit: 0, credit: 30 },
      ],
    });
    expect(liabilityJournal.status).toBe(201);
    const liabilityLines = await pool.query<{ account_id: string; n: string }>(
      `SELECT account_id, COUNT(*)::text AS n FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'journal' AND account_id = ANY($2::uuid[])
        GROUP BY account_id`,
      [A, [liabilityParentId, liabilityChildId]],
    );
    expect(liabilityLines.rows.find((row) => row.account_id === liabilityParentId)).toBeUndefined();
    expect(liabilityLines.rows.find((row) => row.account_id === liabilityChildId)?.n).toBe('1');
    const bsAfterLiability = await pool.query(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_group_id, a.nature, a.is_active,
              ag.group_name AS account_group_name,
              COALESCE(SUM(l.debit), 0)::float AS debit,
              COALESCE(SUM(l.credit), 0)::float AS credit
         FROM accounts a
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         LEFT JOIN ledger_entry_lines l
                ON l.account_id = a.id AND l.business_id = a.business_id AND l.entry_date <= $2::date
        WHERE a.business_id = $1 AND a.account_type IN ('asset', 'liability', 'capital')
        GROUP BY a.id, ag.group_name
       HAVING a.is_active = true OR COUNT(l.id) > 0`,
      [A, DAY],
    );
    const balancedAfterLiability = assembleBalanceSheet(
      bsAfterLiability.rows as BsAccountRow[],
      await loadGroupMap(A),
      { previousYearsProfit: 0, currentYearProfit: plAfter.net_profit },
    );
    expect(balancedAfterLiability.is_balanced).toBe(true);

    const other = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXO${tag}`,
      account_name: `Other ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    const otherId = (other.json.account as { id: string }).id;
    const moved = await call(patchAccount, 'PATCH', `/api/accounts/${childId}`, { parent_account_id: otherId }, childId);
    expect(moved.status).toBe(200);
    const self = await call(patchAccount, 'PATCH', `/api/accounts/${childId}`, { parent_account_id: childId }, childId);
    expect(self.status).toBe(400);
    expect(self.json.code).toBe('PARENT_SELF');
    const movedCycle = await call(
      patchAccount,
      'PATCH',
      `/api/accounts/${otherId}`,
      { parent_account_id: grandId },
      otherId,
    );
    expect(movedCycle.status).toBe(400);
    expect(movedCycle.json.code).toBe('PARENT_CYCLE');
    const asset = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HXA${tag}`,
      account_name: `Asset ${tag}`,
      account_type: 'asset',
      account_group_id: await groupId(A, '1100'),
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    const assetId = (asset.json.account as { id: string }).id;
    const mismatch = await call(
      patchAccount,
      'PATCH',
      `/api/accounts/${assetId}`,
      { parent_account_id: parentId },
      assetId,
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.json.code).toBe('PARENT_TYPE_MISMATCH');
    const cleared = await call(patchAccount, 'PATCH', `/api/accounts/${grandId}`, { parent_account_id: null }, grandId);
    expect(cleared.status).toBe(200);
    const clearedRow = await pool.query<{ parent_account_id: string | null }>(
      `SELECT parent_account_id FROM accounts WHERE id = $1`,
      [grandId],
    );
    expect(clearedRow.rows[0].parent_account_id).toBeNull();
    const stillPosted = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE account_id = $1 AND business_id = $2`,
      [grandId, A],
    );
    expect(stillPosted.rows[0].n).toBe('1');

    const natureEdit = await call(patchAccount, 'PATCH', `/api/accounts/${childId}`, { nature: 'credit' }, childId);
    expect(natureEdit.status).toBe(400);
    expect(natureEdit.json.code).toBe('FIELD_NOT_EDITABLE');
  });

  test('opening balances post once and stay balanced when replaced', async () => {
    session(ownerA, A);
    const assetGroup = await groupId(A, '1100');
    const zero = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HZ0${tag}`,
      account_name: `Zero ${tag}`,
      account_type: 'asset',
      account_group_id: assetGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(zero.status).toBe(201);
    const zeroId = (zero.json.account as { id: string }).id;
    const zeroLines = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2`,
      [A, zeroId],
    );
    expect(zeroLines.rows[0].n).toBe('0');

    const opened = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HZO${tag}`,
      account_name: `Opened ${tag}`,
      account_type: 'asset',
      account_group_id: assetGroup,
      nature: 'debit',
      opening_balance: 50,
      opening_balance_type: 'debit',
    });
    expect(opened.status).toBe(201);
    const openedId = (opened.json.account as { id: string }).id;
    const readLines = async () =>
      pool.query<{ account_id: string; debit: string; credit: string }>(
        `SELECT account_id, debit::text, credit::text
           FROM ledger_entry_lines
          WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2
          ORDER BY debit DESC, credit DESC`,
        [A, openedId],
      );
    let lines = await readLines();
    expect(lines.rows).toHaveLength(2);
    expect(Number(lines.rows[0].debit)).toBe(50);
    expect(lines.rows[0].account_id).toBe(openedId);
    expect(Number(lines.rows[1].credit)).toBe(50);

    const again = await call(
      patchAccount,
      'PATCH',
      `/api/accounts/${openedId}`,
      { opening_balance: 50, opening_balance_type: 'debit' },
      openedId,
    );
    expect(again.status).toBe(200);
    lines = await readLines();
    expect(lines.rows).toHaveLength(2);

    const flipped = await call(
      patchAccount,
      'PATCH',
      `/api/accounts/${openedId}`,
      { opening_balance: 25, opening_balance_type: 'credit' },
      openedId,
    );
    expect(flipped.status).toBe(200);
    lines = await readLines();
    expect(lines.rows).toHaveLength(2);
    const accountLine = lines.rows.find((row) => row.account_id === openedId);
    expect(Number(accountLine?.credit)).toBe(25);
    expect(Number(accountLine?.debit)).toBe(0);

    const totals = await pool.query<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(debit), 0)::text AS debit, COALESCE(SUM(credit), 0)::text AS credit
         FROM ledger_entry_lines WHERE business_id = $1`,
      [A],
    );
    expect(Number(totals.rows[0].debit)).toBeCloseTo(Number(totals.rows[0].credit), 2);
  });

  test('refuses to delete a parent with children, and deactivation keeps the ledger', async () => {
    session(ownerA, A);
    const expenseGroup = await groupId(A, '5200');
    const parent = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HDP${tag}`,
      account_name: `Delete parent ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    const parentId = (parent.json.account as { id: string }).id;
    const child = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HDC${tag}`,
      account_name: `Delete child ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      parent_account_id: parentId,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    const childId = (child.json.account as { id: string }).id;
    const blocked = await call(deleteAccount, 'DELETE', `/api/accounts/${parentId}`, null, parentId);
    expect(blocked.status).toBe(400);
    expect(blocked.json.code).toBe('ACCOUNT_HAS_CHILDREN');
    const stillThere = await pool.query<{ parent_account_id: string }>(
      `SELECT parent_account_id FROM accounts WHERE id = $1`,
      [childId],
    );
    expect(stillThere.rows[0].parent_account_id).toBe(parentId);

    const cash = await accountByCode(A, '1101');
    const journal = await call(postJournal, 'POST', '/api/journal-entries', {
      entry_date: DAY,
      narration: 'parent with child',
      lines: [
        { account_id: parentId, debit: 15, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 15 },
      ],
    });
    if (journal.status !== 201) throw new Error(`journal ${journal.status} ${JSON.stringify(journal.json)}`);
    const deactivated = await call(deleteAccount, 'DELETE', `/api/accounts/${parentId}`, null, parentId);
    expect(deactivated.status).toBe(200);
    const after = await pool.query<{ is_active: boolean; parent_account_id: string; n: string }>(
      `SELECT a.is_active,
              (SELECT parent_account_id FROM accounts WHERE id = $2) AS parent_account_id,
              (SELECT COUNT(*)::text FROM ledger_entry_lines WHERE account_id = $1 AND business_id = $3) AS n
         FROM accounts a WHERE a.id = $1`,
      [parentId, childId, A],
    );
    expect(after.rows[0].is_active).toBe(false);
    expect(after.rows[0].parent_account_id).toBe(parentId);
    expect(after.rows[0].n).toBe('1');
  });

  test('does not accept another business as the tenant or the parent', async () => {
    session(ownerA, A);
    const beforeB = await accountCount(B);
    const foreignGroup = await groupId(B, '5200');
    const spoofed = await call(postAccount, 'POST', '/api/accounts', {
      business_id: B,
      created_by: ownerB,
      account_code: `HFB${tag}`,
      account_name: 'Spoofed business',
      account_type: 'expense',
      account_group_id: foreignGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect([401, 403]).toContain(spoofed.status);
    expect(await accountCount(B)).toBe(beforeB);

    session(ownerA, A);
    const beforeA = await accountCount(A);
    const foreignExpense = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_type = 'expense' ORDER BY account_code LIMIT 1`,
      [B],
    );
    const foreignParent = foreignExpense.rows[0];
    if (!foreignParent) throw new Error('Business B has no expense account');
    const foreignLink = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HFP${tag}`,
      account_name: 'Foreign parent',
      account_type: 'expense',
      account_group_id: await groupId(A, '5200'),
      parent_account_id: foreignParent.id,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(foreignLink.status).toBe(400);
    expect(foreignLink.json.code).toBe('PARENT_NOT_FOUND');
    expect(await accountCount(A)).toBe(beforeA);

    const target = await accountByCode(B, '1101');
    session(ownerA, A);
    const edited = await call(patchAccount, 'PATCH', `/api/accounts/${target.id}`, { account_name: 'Stolen' }, target.id);
    expect(edited.status).toBe(404);
    const name = await pool.query<{ account_name: string }>(`SELECT account_name FROM accounts WHERE id = $1`, [target.id]);
    expect(name.rows[0].account_name).not.toBe('Stolen');

    session(ownerA, A);
    const removed = await call(deleteAccount, 'DELETE', `/api/accounts/${target.id}`, null, target.id);
    expect(removed.status).toBe(404);
    expect(await accountByCode(B, '1101')).toBeTruthy();
  });

  test('trial balance route counts a child expense and a child capital account once', async () => {
    session(ownerA, A);
    const expenseGroup = await groupId(A, '5200');
    const capitalGroup = await groupId(A, '3000');
    const assetGroup = await groupId(A, '1100');
    const parent = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HTE${tag}`,
      account_name: `TB parent ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(parent.status).toBe(201);
    const parentId = (parent.json.account as { id: string }).id;
    const child = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HTC${tag}`,
      account_name: `TB child ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      parent_account_id: parentId,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(child.status).toBe(201);
    const childId = (child.json.account as { id: string }).id;
    const cash = await accountByCode(A, '1101');
    const expenseJournal = await call(postJournal, 'POST', '/api/journal-entries', {
      entry_date: DAY,
      narration: 'trial balance child expense',
      lines: [
        { account_id: childId, debit: 80, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 80 },
      ],
    });
    if (expenseJournal.status !== 201) {
      throw new Error(`expense journal ${expenseJournal.status} ${JSON.stringify(expenseJournal.json)}`);
    }

    const badCapital = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HKN${tag}`,
      account_name: `Bad capital ${tag}`,
      account_type: 'capital',
      account_group_id: capitalGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'credit',
    });
    expect(badCapital.status).toBe(400);
    expect(badCapital.json.code).toBe('INVALID_NATURE');

    const capitalParent = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HKP${tag}`,
      account_name: `Capital parent ${tag}`,
      account_type: 'capital',
      account_group_id: capitalGroup,
      nature: 'credit',
      opening_balance: 0,
      opening_balance_type: 'credit',
    });
    expect(capitalParent.status).toBe(201);
    const capitalParentId = (capitalParent.json.account as { id: string }).id;
    const capitalChild = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HKC${tag}`,
      account_name: `Capital child ${tag}`,
      account_type: 'capital',
      account_group_id: capitalGroup,
      parent_account_id: capitalParentId,
      nature: 'credit',
      opening_balance: 0,
      opening_balance_type: 'credit',
    });
    expect(capitalChild.status).toBe(201);
    const capitalChildId = (capitalChild.json.account as { id: string }).id;
    const capitalJournal = await call(postJournal, 'POST', '/api/journal-entries', {
      entry_date: DAY,
      narration: 'capital introduced to child',
      lines: [
        { account_id: cash.id, debit: 70, credit: 0 },
        { account_id: capitalChildId, debit: 0, credit: 70 },
      ],
    });
    if (capitalJournal.status !== 201) {
      throw new Error(`capital journal ${capitalJournal.status} ${JSON.stringify(capitalJournal.json)}`);
    }
    const capitalLines = await pool.query<{ account_id: string; n: string; credit: string }>(
      `SELECT account_id, COUNT(*)::text AS n, COALESCE(SUM(credit), 0)::text AS credit
         FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_type = 'journal' AND account_id = ANY($2::uuid[])
        GROUP BY account_id`,
      [A, [capitalParentId, capitalChildId]],
    );
    expect(capitalLines.rows.find((row) => row.account_id === capitalParentId)).toBeUndefined();
    expect(capitalLines.rows.find((row) => row.account_id === capitalChildId)?.n).toBe('1');
    expect(Number(capitalLines.rows.find((row) => row.account_id === capitalChildId)?.credit)).toBe(70);

    const opened = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HTO${tag}`,
      account_name: `TB opening ${tag}`,
      account_type: 'asset',
      account_group_id: assetGroup,
      nature: 'debit',
      opening_balance: 20,
      opening_balance_type: 'debit',
    });
    expect(opened.status).toBe(201);
    const openedId = (opened.json.account as { id: string }).id;

    const report = await call(
      getTrialBalance,
      'GET',
      `/api/reports/trial-balance?as_on_date=${DAY}&business_id=${B}`,
      null,
    );
    if (report.status !== 200) throw new Error(`trial balance ${report.status} ${JSON.stringify(report.json)}`);
    const accounts = report.json.accounts as Array<{
      account_id: string;
      account_code: string;
      debit: number;
      credit: number;
      opening_balance: number;
    }>;
    const totals = report.json.totals as { total_debit: number; total_credit: number };
    expect(Array.isArray(accounts)).toBe(true);
    expect(report.json.is_balanced).toBe(true);
    expect(totals.total_debit).toBeCloseTo(totals.total_credit, 2);

    const once = (id: string) => accounts.filter((row) => row.account_id === id);
    const expenseChild = once(childId);
    const expenseParent = once(parentId);
    const capitalChildRows = once(capitalChildId);
    const capitalParentRows = once(capitalParentId);
    const openingRows = once(openedId);
    expect(expenseChild).toHaveLength(1);
    expect(expenseChild[0].debit).toBeCloseTo(80, 2);
    expect(expenseChild[0].credit).toBeCloseTo(0, 2);
    expect(expenseParent).toHaveLength(1);
    expect(expenseParent[0].debit).toBeCloseTo(0, 2);
    expect(expenseParent[0].credit).toBeCloseTo(0, 2);
    expect(capitalChildRows).toHaveLength(1);
    expect(capitalChildRows[0].credit).toBeCloseTo(70, 2);
    expect(capitalChildRows[0].debit).toBeCloseTo(0, 2);
    expect(capitalParentRows).toHaveLength(1);
    expect(capitalParentRows[0].debit).toBeCloseTo(0, 2);
    expect(capitalParentRows[0].credit).toBeCloseTo(0, 2);
    expect(openingRows).toHaveLength(1);
    expect(openingRows[0].debit).toBeCloseTo(20, 2);
    expect(openingRows[0].opening_balance).toBe(0);

    session(ownerB, B);
    const marker = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerB,
      account_code: `HTB${tag}`,
      account_name: `Other business ${tag}`,
      account_type: 'expense',
      account_group_id: await groupId(B, '5200'),
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(marker.status).toBe(201);
    session(ownerA, A);
    const foreignReport = await call(
      getTrialBalance,
      'GET',
      `/api/reports/trial-balance?as_on_date=${DAY}&business_id=${B}`,
      null,
    );
    expect(foreignReport.status).toBe(200);
    const foreignAccounts = foreignReport.json.accounts as Array<{ account_code: string }>;
    expect(foreignAccounts.some((row) => row.account_code === `HTB${tag}`)).toBe(false);
    expect(foreignAccounts.some((row) => row.account_code === `HTC${tag}`)).toBe(true);

    const bsRows = await pool.query(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_group_id, a.nature, a.is_active,
              ag.group_name AS account_group_name,
              COALESCE(SUM(l.debit), 0)::float AS debit,
              COALESCE(SUM(l.credit), 0)::float AS credit
         FROM accounts a
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         LEFT JOIN ledger_entry_lines l
                ON l.account_id = a.id AND l.business_id = a.business_id AND l.entry_date <= $2::date
        WHERE a.business_id = $1 AND a.account_type IN ('asset', 'liability', 'capital')
        GROUP BY a.id, ag.group_name
       HAVING a.is_active = true OR COUNT(l.id) > 0`,
      [A, DAY],
    );
    const pl = await buildProfitAndLoss({
      businessId: A,
      fromDate: financialYearStartFor(DAY),
      toDate: DAY,
      branch: { kind: 'all' },
      consolidated: true,
    });
    const bs = assembleBalanceSheet(bsRows.rows as BsAccountRow[], await loadGroupMap(A), {
      previousYearsProfit: 0,
      currentYearProfit: pl.net_profit,
    });
    const capitalLine = bs.equity.capital.accounts.find((row) => row.id === capitalChildId);
    const capitalParentLine = bs.equity.capital.accounts.find((row) => row.id === capitalParentId);
    expect(capitalLine?.balance).toBeCloseTo(70, 2);
    expect(capitalParentLine?.balance ?? 0).toBeCloseTo(0, 2);
    expect(bs.equity.capital.total).toBeCloseTo(
      bs.equity.capital.accounts.reduce((sum, row) => sum + row.balance, 0),
      2,
    );
    expect(bs.is_balanced).toBe(true);
  });

  test('rejects the second of two creates that use the same code', async () => {
    session(ownerA, A);
    const expenseGroup = await groupId(A, '5200');
    const code = `HDU${tag}`;
    const body = {
      created_by: ownerA,
      account_code: code,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    };
    const [first, second] = await Promise.all([
      call(postAccount, 'POST', '/api/accounts', { ...body, account_name: `Dup one ${tag}` }),
      call(postAccount, 'POST', '/api/accounts', { ...body, account_name: `Dup two ${tag}` }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const stored = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts WHERE business_id = $1 AND account_code = $2`,
      [A, code],
    );
    expect(stored.rows[0].n).toBe('1');
  });

  test('rejects an empty code and a failed create without a leftover account or voucher', async () => {
    session(ownerA, A);
    const expenseGroup = await groupId(A, '5200');
    const assetGroup = await groupId(A, '1100');
    const beforeAccounts = await accountCount(A);
    const beforeLines = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'opening_balance'`,
      [A],
    );

    const missing = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_name: `No code ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 40,
      opening_balance_type: 'debit',
    });
    expect(missing.status).toBe(400);

    const blank = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: '',
      account_name: `Blank code ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 40,
      opening_balance_type: 'debit',
    });
    expect(blank.status).toBe(400);

    const badGroup = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HFL${tag}`,
      account_name: `Failed group ${tag}`,
      account_type: 'expense',
      account_group_id: assetGroup,
      nature: 'debit',
      opening_balance: 40,
      opening_balance_type: 'debit',
    });
    expect(badGroup.status).toBe(400);
    expect(badGroup.json.code).toBe('ACCOUNT_TYPE_GROUP_MISMATCH');

    const foreignParent = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE business_id = $1 AND account_type = 'expense' LIMIT 1`,
      [B],
    );
    const foreign = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HFP${tag}`,
      account_name: `Foreign parent ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      parent_account_id: foreignParent.rows[0].id,
      opening_balance: 40,
      opening_balance_type: 'debit',
    });
    expect(foreign.status).toBe(400);
    expect(foreign.json.code).toBe('PARENT_NOT_FOUND');

    expect(await accountCount(A)).toBe(beforeAccounts);
    const leftover = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts
        WHERE business_id = $1 AND account_code IN ($2, $3)`,
      [A, `HFL${tag}`, `HFP${tag}`],
    );
    expect(leftover.rows[0].n).toBe('0');
    const afterLines = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'opening_balance'`,
      [A],
    );
    expect(afterLines.rows[0].n).toBe(beforeLines.rows[0].n);
  });

  test('renaming an account leaves its opening voucher unchanged', async () => {
    session(ownerA, A);
    const assetGroup = await groupId(A, '1100');
    const created = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HRN${tag}`,
      account_name: `Rename me ${tag}`,
      account_type: 'asset',
      account_group_id: assetGroup,
      nature: 'debit',
      opening_balance: 40,
      opening_balance_type: 'debit',
    });
    expect(created.status).toBe(201);
    const accountId = (created.json.account as { id: string }).id;
    const read = async () =>
      pool.query<{ account_id: string; debit: string; credit: string; voucher_id: string }>(
        `SELECT account_id, debit::text, credit::text, voucher_id
           FROM ledger_entry_lines
          WHERE business_id = $1 AND voucher_type = 'opening_balance' AND voucher_id = $2
          ORDER BY debit DESC`,
        [A, accountId],
      );
    const before = await read();
    expect(before.rows).toHaveLength(2);

    const renamed = await call(
      patchAccount,
      'PATCH',
      `/api/accounts/${accountId}`,
      { account_name: `Renamed ${tag}` },
      accountId,
    );
    expect(renamed.status).toBe(200);
    const after = await read();
    expect(after.rows).toHaveLength(2);
    expect(after.rows.map((row) => `${row.account_id}:${row.debit}:${row.credit}`)).toEqual(
      before.rows.map((row) => `${row.account_id}:${row.debit}:${row.credit}`),
    );
    const stored = await pool.query<{ account_name: string; opening_balance: string }>(
      `SELECT account_name, opening_balance::text FROM accounts WHERE id = $1`,
      [accountId],
    );
    expect(stored.rows[0].account_name).toBe(`Renamed ${tag}`);
    expect(Number(stored.rows[0].opening_balance)).toBe(40);
  });

  test('my accounts follows posted lines, ancestors, and manual pins', async () => {
    session(ownerA, A);
    const expenseGroup = await groupId(A, '5200');
    const parentGroup = await groupId(A, '5000');
    const parent = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HMY${tag}`,
      account_name: `My parent ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(parent.status).toBe(201);
    const parentId = (parent.json.account as { id: string }).id;
    const child = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HMZ${tag}`,
      account_name: `My child ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      parent_account_id: parentId,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(child.status).toBe(201);
    const childId = (child.json.account as { id: string }).id;
    const idle = await call(postAccount, 'POST', '/api/accounts', {
      created_by: ownerA,
      account_code: `HMI${tag}`,
      account_name: `My idle ${tag}`,
      account_type: 'expense',
      account_group_id: expenseGroup,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    });
    expect(idle.status).toBe(201);
    const idleId = (idle.json.account as { id: string }).id;
    await pool.query(`UPDATE accounts SET opening_balance = 99 WHERE id = $1`, [idleId]);

    const cash = await accountByCode(A, '1101');
    const posted = await call(postJournal, 'POST', '/api/journal-entries', {
      business_id: A,
      entry_date: DAY,
      narration: `my accounts ${tag}`,
      lines: [
        { account_id: childId, debit: 15, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 15 },
      ],
    });
    expect(posted.status).toBe(201);
    const settled = await call(postJournal, 'POST', '/api/journal-entries', {
      business_id: A,
      entry_date: DAY,
      narration: `my accounts settle ${tag}`,
      lines: [
        { account_id: cash.id, debit: 15, credit: 0 },
        { account_id: childId, debit: 0, credit: 15 },
      ],
    });
    expect(settled.status).toBe(201);

    const view = await call(getMyAccounts, 'GET', '/api/accounts/my-accounts', null);
    expect(view.status).toBe(200);
    const rows = view.json.accounts as Array<{ id: string; reason: string; balance: number; has_activity: boolean }>;
    const childRow = rows.find((row) => row.id === childId);
    const parentRow = rows.find((row) => row.id === parentId);
    expect(childRow).toMatchObject({ reason: 'activity', has_activity: true, balance: 0 });
    expect(parentRow).toMatchObject({ reason: 'ancestor', has_activity: false, balance: 0 });
    expect(rows.some((row) => row.id === idleId)).toBe(false);
    const groupIds = (view.json.groups as Array<{ id: string }>).map((group) => group.id);
    expect(groupIds).toContain(expenseGroup);
    expect(groupIds).toContain(parentGroup);

    const pin = await call(putMyAccounts, 'PUT', '/api/accounts/my-accounts', { account_ids: [idleId] });
    expect(pin.status).toBe(200);
    const pinned = await call(getMyAccounts, 'GET', '/api/accounts/my-accounts', null);
    const pinnedIdle = (pinned.json.accounts as Array<{ id: string; reason: string }>).find((row) => row.id === idleId);
    expect(pinnedIdle).toMatchObject({ reason: 'manual' });
    const lines = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entry_lines WHERE business_id = $1 AND account_id = $2`,
      [A, idleId],
    );
    expect(lines.rows[0].n).toBe('0');

    const kept = await pool.query<{ settings: { keep?: boolean } }>(
      `UPDATE business_settings
          SET settings = COALESCE(settings, '{}'::jsonb) || '{"keep": true}'::jsonb
        WHERE business_id = $1
        RETURNING settings`,
      [A],
    );
    expect(kept.rows[0].settings.keep).toBe(true);

    const clear = await call(putMyAccounts, 'PUT', '/api/accounts/my-accounts', { account_ids: [] });
    expect(clear.status).toBe(200);
    const cleared = await call(getMyAccounts, 'GET', '/api/accounts/my-accounts', null);
    expect((cleared.json.accounts as Array<{ id: string }>).some((row) => row.id === idleId)).toBe(false);
    expect((cleared.json.accounts as Array<{ id: string }>).some((row) => row.id === childId)).toBe(true);
    const stillKept = await pool.query<{ settings: { keep?: boolean; my_account_ids?: string[] } }>(
      `SELECT settings FROM business_settings WHERE business_id = $1`,
      [A],
    );
    expect(stillKept.rows[0].settings.keep).toBe(true);
    expect(stillKept.rows[0].settings.my_account_ids).toEqual([]);

    const foreign = await accountByCode(B, '1101');
    const rejected = await call(putMyAccounts, 'PUT', '/api/accounts/my-accounts', { account_ids: [foreign.id] });
    expect(rejected.status).toBe(400);
    expect(rejected.json.code).toBe('ACCOUNT_NOT_FOUND');
    const unchanged = await pool.query<{ ids: string[] }>(
      `SELECT settings -> 'my_account_ids' AS ids FROM business_settings WHERE business_id = $1`,
      [A],
    );
    expect(unchanged.rows[0].ids).toEqual([]);
  });
});
