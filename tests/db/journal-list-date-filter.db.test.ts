/**
 * Real-PostgreSQL tests for GET /api/journal-entries date filters. The journal page always sends
 * both from_date and to_date, so the list and its pagination count must bind both. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database; PBAC is stubbed.
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

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { GET as listJournals } from '@/app/api/journal-entries/route';

d('GET /api/journal-entries date filters (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const vouchers = { jul: randomUUID(), aug: randomUUID(), sep: randomUUID() };

  async function list(params: Record<string, string>) {
    const qs = new URLSearchParams({ limit: '50', ...params });
    const res = await listJournals(
      new NextRequest(`http://localhost/api/journal-entries?${qs}`, {
        headers: { 'x-authenticated-user-id': U, 'x-authenticated-business-id': B },
      })
    );
    const json = (await res.json()) as any;
    return {
      status: res.status,
      json,
      vouchers: ((json.entries || []) as any[]).map((e) => e.voucher_id).sort(),
    };
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Journal ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Admin', $3, true)`,
      [U, B, `94${Date.now().toString().slice(-8)}`]
    );
    const [dr, cr] = [randomUUID(), randomUUID()];
    await pool.query(
      `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature)
       VALUES ($1, $3, 'JT-5201', 'Filter test expense', 'expense', 'debit'),
              ($2, $3, 'JT-1101', 'Filter test cash', 'asset', 'debit')`,
      [dr, cr, B]
    );
    for (const [voucher, date] of [
      [vouchers.jul, '2026-07-10'],
      [vouchers.aug, '2026-08-10'],
      [vouchers.sep, '2026-09-10'],
    ]) {
      await pool.query(
        `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
         VALUES ($1, $2, $3, $4, 'Filter test', $5, $6)`,
        [B, voucher, `JV-${tag}-${date}`, date, BR, U]
      );
      await pool.query(
        `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
         VALUES ($1, $2, $3, 'journal', $4, $6, 50, 0), ($1, $2, $3, 'journal', $5, $6, 0, 50)`,
        [B, BR, voucher, dr, cr, date]
      );
    }
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

  test('from_date and to_date together filter the list and the pagination count', async () => {
    const { status, json, vouchers: listed } = await list({ from_date: '2026-08-01', to_date: '2026-09-30' });
    expect(status).toBe(200);
    expect(listed).toEqual([vouchers.aug, vouchers.sep].sort());
    expect(Number(json.pagination.total)).toBe(2);
  });

  test('from_date alone and to_date alone still work', async () => {
    const from = await list({ from_date: '2026-09-01' });
    expect(from.status).toBe(200);
    expect(from.vouchers).toEqual([vouchers.sep]);
    expect(Number(from.json.pagination.total)).toBe(1);

    const to = await list({ to_date: '2026-07-31' });
    expect(to.status).toBe(200);
    expect(to.vouchers).toEqual([vouchers.jul]);
    expect(Number(to.json.pagination.total)).toBe(1);
  });

  test('no date filter lists every journal', async () => {
    const all = await list({});
    expect(all.vouchers).toEqual(Object.values(vouchers).sort());
    expect(Number(all.json.pagination.total)).toBe(3);
  });
});
