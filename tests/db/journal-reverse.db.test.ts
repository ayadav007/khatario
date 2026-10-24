/**
 * Real-PostgreSQL tests for the journal "Reverse" action (POST /api/journal-entries/[id]/reverse)
 * and how reversed journals appear in the list and detail APIs. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database; PBAC and plan access are stubbed.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/enforce-access', () => ({
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => null),
  getUserAgent: jest.fn(() => null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { deleteJournalByReversal, repostJournal } from '@/lib/accounting/journal-corrections';
import { GET as listJournals } from '@/app/api/journal-entries/route';
import { GET as getJournal, PATCH as patchJournal } from '@/app/api/journal-entries/[id]/route';
import { POST as reverseJournalRoute } from '@/app/api/journal-entries/[id]/reverse/route';

d('journal reversal lifecycle (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const EXP = randomUUID();
  const CASH = randomUUID();
  const J = { reverse: randomUUID(), legacy: randomUUID(), corrected: randomUUID(), live: randomUUID() };

  const headers = { 'x-authenticated-user-id': U, 'x-authenticated-business-id': B };

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function reverse(voucherId: string, body: unknown) {
    const res = await reverseJournalRoute(
      new NextRequest(`http://localhost/api/journal-entries/${voucherId}/reverse`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: { id: voucherId } }
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  async function list() {
    const qs = new URLSearchParams({ limit: '50', from_date: '2026-01-01', to_date: '2026-12-31' });
    const res = await listJournals(new NextRequest(`http://localhost/api/journal-entries?${qs}`, { headers }));
    const json = (await res.json()) as any;
    const byId = new Map<string, any>(((json.entries || []) as any[]).map((e) => [e.voucher_id, e]));
    return { status: res.status, json, byId };
  }

  async function detail(voucherId: string) {
    const res = await getJournal(new NextRequest(`http://localhost/api/journal-entries/${voucherId}`, { headers }), {
      params: { id: voucherId },
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  async function voucherLines(voucherId: string) {
    return (
      await pool.query<{ id: string; account_id: string; debit: string; credit: string; narration: string | null; is_reversal: boolean; reversed: boolean }>(
        `SELECT l.id, l.account_id, l.debit, l.credit, l.narration,
                EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.reversal_line_id = l.id) AS is_reversal,
                EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.original_line_id = l.id) AS reversed
           FROM ledger_entry_lines l
          WHERE l.business_id = $1 AND l.voucher_type = 'journal' AND l.voucher_id = $2
          ORDER BY l.created_at, l.id`,
        [B, voucherId]
      )
    ).rows;
  }

  async function seedJournal(voucherId: string, number: string, date: string, amount: number) {
    await pool.query(
      `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
       VALUES ($1, $2, $3, $4, 'Reverse test', $5, $6)`,
      [B, voucherId, number, date, BR, U]
    );
    await pool.query(
      `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration)
       VALUES ($1, $2, $3, 'journal', $4, $6, $7, 0, 'Tea'), ($1, $2, $3, 'journal', $5, $6, 0, $7, 'Cash paid')`,
      [B, BR, voucherId, EXP, CASH, date, amount]
    );
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Journal reverse ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Reverser', $3, true)`,
      [U, B, `93${Date.now().toString().slice(-8)}`]
    );
    await pool.query(
      `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature)
       VALUES ($1, $3, 'JR-5201', 'Reverse test expense', 'expense', 'debit'),
              ($2, $3, 'JR-1101', 'Reverse test cash', 'asset', 'debit')`,
      [EXP, CASH, B]
    );
    await seedJournal(J.reverse, `JV-${tag}-1`, '2026-09-10', 100);
    await seedJournal(J.legacy, `JV-${tag}-2`, '2026-09-11', 75);
    await seedJournal(J.corrected, `JV-${tag}-3`, '2026-09-12', 40);
    await seedJournal(J.live, `JV-${tag}-4`, '2026-09-13', 60);

    await tx((c) => deleteJournalByReversal(c, { businessId: B, voucherId: J.legacy, userId: U, reason: 'Old delete' }));
    await tx((c) =>
      repostJournal(c, {
        businessId: B,
        voucherId: J.corrected,
        userId: U,
        branchId: BR,
        entryDate: '2026-09-12',
        lines: [
          { account_id: EXP, debit: 45, credit: 0 },
          { account_id: CASH, debit: 0, credit: 45 },
        ],
        narration: 'Corrected',
        reference: null,
        voucherNumber: `JV-${tag}-3`,
      })
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', U, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('a reason is required', async () => {
    const r = await reverse(J.reverse, { reason: '   ' });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('REASON_REQUIRED');
    expect(await voucherLines(J.reverse)).toHaveLength(2);
  });

  test('reverse keeps the journal and its original lines, and posts linked mirror lines', async () => {
    const before = await voucherLines(J.reverse);
    const r = await reverse(J.reverse, { reason: 'Posted twice' });
    expect(r.status).toBe(200);

    const head = (
      await pool.query(`SELECT deleted_at, deleted_by, delete_reason FROM journal_entries WHERE voucher_id = $1`, [J.reverse])
    ).rows[0];
    expect(head).toEqual({ deleted_at: null, deleted_by: null, delete_reason: null });

    const after = await voucherLines(J.reverse);
    expect(after).toHaveLength(4);
    const originals = after.filter((l) => !l.is_reversal);
    expect(originals.map((l) => [l.id, l.account_id, l.debit, l.credit])).toEqual(
      before.map((l) => [l.id, l.account_id, l.debit, l.credit])
    );
    expect(originals.every((l) => l.reversed)).toBe(true);

    const links = (
      await pool.query(
        `SELECT ler.reason, ler.created_by, o.account_id, o.debit AS o_dr, o.credit AS o_cr, r.debit AS r_dr, r.credit AS r_cr, r.voucher_id
           FROM ledger_entry_reversals ler
           JOIN ledger_entry_lines o ON o.id = ler.original_line_id
           JOIN ledger_entry_lines r ON r.id = ler.reversal_line_id
          WHERE ler.voucher_id = $1`,
        [J.reverse]
      )
    ).rows;
    expect(links).toHaveLength(2);
    for (const l of links) {
      expect(l.reason).toBe('Journal reversed: Posted twice');
      expect(l.created_by).toBe(U);
      expect(l.voucher_id).toBe(J.reverse);
      expect([l.r_dr, l.r_cr]).toEqual([l.o_cr, l.o_dr]);
    }
    const net = after.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    expect(net).toBe(0);
    expect(after.filter((l) => l.is_reversal).every((l) => /^Reversal: Journal reversed: Posted twice/.test(l.narration || ''))).toBe(true);
    expect(after.some((l) => /deleted/i.test(l.narration || ''))).toBe(false);
  });

  test('a second reversal is refused and posts nothing', async () => {
    const r = await reverse(J.reverse, { reason: 'Again' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('JOURNAL_ALREADY_REVERSED');
    expect(await voucherLines(J.reverse)).toHaveLength(4);
  });

  test('the list shows reversed journals (including legacy soft-deleted ones) with their original totals', async () => {
    const { status, byId, json } = await list();
    expect(status).toBe(200);
    expect(Number(json.pagination.total)).toBe(4);

    const rev = byId.get(J.reverse);
    expect(rev).toBeDefined();
    expect(rev.is_reversed).toBe(true);
    expect(Number(rev.line_count)).toBe(2);
    expect(Number(rev.total_debit)).toBe(100);
    expect(Number(rev.total_credit)).toBe(100);

    const legacy = byId.get(J.legacy);
    expect(legacy.is_reversed).toBe(true);
    expect(Number(legacy.total_debit)).toBe(75);

    const corrected = byId.get(J.corrected);
    expect(corrected.is_reversed).toBe(false);
    expect(Number(corrected.line_count)).toBe(2);
    expect(Number(corrected.total_debit)).toBe(45);

    const live = byId.get(J.live);
    expect(live.is_reversed).toBe(false);
    expect(Number(live.total_debit)).toBe(60);
  });

  test('a corrected journal that is then reversed shows only its last posting', async () => {
    expect((await reverse(J.corrected, { reason: 'Not needed' })).status).toBe(200);
    const corrected = (await list()).byId.get(J.corrected);
    expect(corrected.is_reversed).toBe(true);
    expect(Number(corrected.line_count)).toBe(2);
    expect(Number(corrected.total_debit)).toBe(45);
    expect(Number(corrected.total_credit)).toBe(45);

    const det = await detail(J.corrected);
    expect(det.status).toBe(200);
    expect(det.json.lines.map((l: any) => Number(l.debit) + Number(l.credit))).toEqual([45, 45]);
    expect(det.json.reversal.lines).toHaveLength(2);
    expect(det.json.reversal.reason).toBe('Not needed');
  });

  test('detail shows the original lines, the linked reversal lines, reason and who reversed it', async () => {
    const { status, json } = await detail(J.reverse);
    expect(status).toBe(200);
    expect(json.entry.is_reversed).toBe(true);
    expect(json.entry.total_debit).toBe(100);
    expect(json.lines).toHaveLength(2);
    expect(json.reversal.reason).toBe('Posted twice');
    expect(json.reversal.reversed_by_name).toBe('Reverser');
    expect(json.reversal.lines).toHaveLength(2);
    const origById = new Map<string, any>(json.lines.map((l: any) => [l.id, l]));
    for (const r of json.reversal.lines) {
      const o = origById.get(r.original_line_id);
      expect(o).toBeDefined();
      expect(r.account_id).toBe(o.account_id);
      expect(Number(r.debit)).toBe(Number(o.credit));
      expect(Number(r.credit)).toBe(Number(o.debit));
    }

    const legacy = await detail(J.legacy);
    expect(legacy.status).toBe(200);
    expect(legacy.json.entry.is_reversed).toBe(true);
    expect(legacy.json.reversal.reason).toBe('Old delete');

    const live = await detail(J.live);
    expect(live.json.entry.is_reversed).toBe(false);
    expect(live.json.reversal).toBeNull();
  });

  test('a reversed journal cannot be edited', async () => {
    const res = await patchJournal(
      new NextRequest(`http://localhost/api/journal-entries/${J.reverse}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ entry_date: '2026-09-20' }),
      }),
      { params: { id: J.reverse } }
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe('JOURNAL_REVERSED');
    expect(await voucherLines(J.reverse)).toHaveLength(4);
  });
});
