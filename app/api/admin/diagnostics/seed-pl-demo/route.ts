/**
 * Admin diagnostic endpoint: seed P&L demo entries
 *
 * Posts a small set of synthetic journal vouchers that exercise every expense
 * bucket touched by the Phase-1 P&L math fix. This makes the difference
 * between the OLD (double/triple-counting) and NEW math visible on the live
 * P&L report without needing real invoices/purchases.
 *
 *   GET    -> dry-run: previews the entries that would be posted (does NOT post)
 *   POST   -> posts the entries (requires confirm token from GET)
 *   DELETE -> removes any previously seeded demo entries (uses narration marker)
 *
 * Auth: must be authenticated AND either have settings.read or be primary admin.
 *
 * The voucher narration is prefixed with `[PHASE1_SEED]` so cleanup is precise.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryOne, getPool } from '@/lib/db';

const SEED_NARRATION_PREFIX = '[PHASE1_SEED]';

// Each row is one balanced journal voucher: debit one expense, credit cash.
// Amounts are deliberately distinct so you can identify which account took
// which hit just by reading the P&L.
const DEMO_ENTRIES: Array<{
  expense_account_code: string;
  expense_account_label: string;
  amount: number;
  bucket_after_phase1: string;
}> = [
  { expense_account_code: '5201', expense_account_label: 'Administrative Expenses', amount: 500, bucket_after_phase1: 'Indirect Expenses' },
  { expense_account_code: '5205', expense_account_label: 'Interest Expense',         amount: 200, bucket_after_phase1: 'Other Expenses' },
  { expense_account_code: '5207', expense_account_label: 'Provision for Bad Debts',  amount: 100, bucket_after_phase1: 'Other Expenses (provision)' },
  { expense_account_code: '5210', expense_account_label: 'Current Tax',              amount: 150, bucket_after_phase1: 'Tax (below PBT only)' },
];

async function authorize(request: NextRequest): Promise<
  { ok: true; businessId: string; userId: string } | { ok: false; response: NextResponse }
> {
  const gate = await requirePortalSession(request);
  if (gate) return { ok: false, response: gate };

  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  if (!businessId) {
    return { ok: false, response: NextResponse.json({ error: 'business_id is required' }, { status: 400 }) };
  }
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 }) };
  }
  let isAdmin = false;
  try {
    const { checkUserPermission } = await import('@/lib/permissions');
    isAdmin = await checkUserPermission(userId, 'settings', 'read');
  } catch {
    isAdmin = false;
  }
  if (!isAdmin) {
    const u = await queryOne<{ is_primary_admin: boolean }>(
      'SELECT is_primary_admin FROM users WHERE id = $1',
      [userId],
    );
    isAdmin = !!u?.is_primary_admin;
  }
  if (!isAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden: admin only', code: 'NOT_ADMIN' }, { status: 403 }) };
  }
  return { ok: true, businessId, userId };
}

interface ResolvedAccounts {
  cashAccountId: string;
  branchId: string;
  branchName: string;
  expenses: Array<{
    code: string;
    name: string;
    accountId: string;
    amount: number;
    bucket_after_phase1: string;
  }>;
  missing: string[];
}

async function resolveAccounts(businessId: string): Promise<ResolvedAccounts> {
  const missing: string[] = [];

  const cash = await queryOne<{ id: string }>(
    `SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1101' AND is_active = true LIMIT 1`,
    [businessId],
  );
  if (!cash) missing.push('1101 (Cash)');

  const branch = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM branches
      WHERE business_id = $1 AND is_active = true
      ORDER BY is_primary DESC NULLS LAST, created_at ASC LIMIT 1`,
    [businessId],
  );
  if (!branch) missing.push('any active branch');

  const expenses: ResolvedAccounts['expenses'] = [];
  for (const e of DEMO_ENTRIES) {
    const acc = await queryOne<{ id: string; account_name: string }>(
      `SELECT id, account_name FROM accounts
        WHERE business_id = $1 AND account_code = $2 AND is_active = true LIMIT 1`,
      [businessId, e.expense_account_code],
    );
    if (!acc) {
      missing.push(`${e.expense_account_code} (${e.expense_account_label})`);
    } else {
      expenses.push({
        code: e.expense_account_code,
        name: acc.account_name,
        accountId: acc.id,
        amount: e.amount,
        bucket_after_phase1: e.bucket_after_phase1,
      });
    }
  }

  return {
    cashAccountId: cash?.id ?? '',
    branchId: branch?.id ?? '',
    branchName: branch?.name ?? '',
    expenses,
    missing,
  };
}

function confirmTokenFor(businessId: string): string {
  // Token rotates daily; binds to today + business so a stale token can't
  // be replayed weeks later.
  const today = new Date().toISOString().slice(0, 10);
  let h = 0;
  const s = `${businessId}::${today}::${SEED_NARRATION_PREFIX}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `SEED_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// -----------------------------------------------------------------------
// GET: dry-run
// -----------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;

    const accounts = await resolveAccounts(auth.businessId);

    // Count any seed entries that already exist
    const existing = await queryOne<{ n: string; sum: string }>(
      `SELECT COUNT(*)::text AS n, COALESCE(SUM(debit), 0)::text AS sum
         FROM ledger_entry_lines
        WHERE business_id = $1
          AND voucher_type = 'journal'
          AND narration LIKE $2`,
      [auth.businessId, `${SEED_NARRATION_PREFIX}%`],
    );

    return NextResponse.json({
      business_id: auth.businessId,
      will_post: accounts.missing.length === 0,
      missing_prerequisites: accounts.missing,
      branch: accounts.missing.length === 0
        ? { id: accounts.branchId, name: accounts.branchName }
        : null,
      entries_to_post: accounts.expenses.map((e) => ({
        debit: { code: e.code, name: e.name, amount: e.amount },
        credit: { code: '1101', name: 'Cash', amount: e.amount },
        narration: `${SEED_NARRATION_PREFIX} ${e.name}`,
        bucket_after_phase1: e.bucket_after_phase1,
      })),
      total_amount_each_side: accounts.expenses.reduce((s, e) => s + e.amount, 0),
      existing_seed_entries: {
        line_count: Number(existing?.n ?? 0),
        total_debit: Number(existing?.sum ?? 0),
        note:
          Number(existing?.n ?? 0) > 0
            ? 'Seed entries already exist. POST will add another batch on top; use DELETE to clean first.'
            : 'No prior seed entries.',
      },
      confirm_token: confirmTokenFor(auth.businessId),
    });
  } catch (error) {
    const err = error as { message?: string };
    console.error('seed-pl-demo GET error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// -----------------------------------------------------------------------
// POST: actually post the demo entries
// -----------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const provided = searchParams.get('confirm');
    const expected = confirmTokenFor(auth.businessId);
    if (provided !== expected) {
      return NextResponse.json(
        { error: 'confirm token mismatch (or missing). Run GET first.', expected, provided },
        { status: provided ? 409 : 400 },
      );
    }

    const accounts = await resolveAccounts(auth.businessId);
    if (accounts.missing.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot seed — missing prerequisites',
          missing: accounts.missing,
          hint: 'Make sure your chart of accounts has 1101 (Cash) and 5201/5205/5207/5210, and that the business has at least one active branch.',
        },
        { status: 412 },
      );
    }

    await client.query('BEGIN');

    const today = new Date().toISOString().slice(0, 10);
    const inserted: Array<{ debit_line_id: string; credit_line_id: string; code: string; amount: number }> = [];

    for (const e of accounts.expenses) {
      const sharedVoucherId = (
        await client.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)
      ).rows[0].id;
      const narration = `${SEED_NARRATION_PREFIX} ${e.name} (Phase-1 demo)`;

      // Debit expense
      const debitRes = await client.query<{ id: string }>(
        `INSERT INTO ledger_entry_lines
          (business_id, voucher_id, voucher_type, account_id, entry_date,
           debit, credit, narration, reference_number, branch_id)
         VALUES ($1, $2, 'journal', $3, $4, $5, 0, $6, $7, $8)
         RETURNING id`,
        [
          auth.businessId,
          sharedVoucherId,
          e.accountId,
          today,
          e.amount,
          narration,
          `SEED-${e.code}`,
          accounts.branchId,
        ],
      );

      // Credit cash
      const creditRes = await client.query<{ id: string }>(
        `INSERT INTO ledger_entry_lines
          (business_id, voucher_id, voucher_type, account_id, entry_date,
           debit, credit, narration, reference_number, branch_id)
         VALUES ($1, $2, 'journal', $3, $4, 0, $5, $6, $7, $8)
         RETURNING id`,
        [
          auth.businessId,
          sharedVoucherId,
          accounts.cashAccountId,
          today,
          e.amount,
          narration,
          `SEED-${e.code}`,
          accounts.branchId,
        ],
      );

      inserted.push({
        debit_line_id: debitRes.rows[0].id,
        credit_line_id: creditRes.rows[0].id,
        code: e.code,
        amount: e.amount,
      });
    }

    await client.query('COMMIT');

    return NextResponse.json({
      seeded: true,
      business_id: auth.businessId,
      entry_date: today,
      entries: inserted,
      next_step:
        'Open /reports/profit-loss for the FY containing today and verify: ' +
        'Indirect Expenses 500 (5201 only), Other Expenses 300 (5205+5207), Tax 150 (5210). ' +
        'Old code would have shown Indirect 800, Other 300, plus possibly tax in indirect again.',
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow
    }
    const err = error as { message?: string };
    console.error('seed-pl-demo POST error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// DELETE: remove all seed entries (idempotent)
// -----------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;

    await client.query('BEGIN');
    const res = await client.query(
      `DELETE FROM ledger_entry_lines
        WHERE business_id = $1
          AND voucher_type = 'journal'
          AND narration LIKE $2`,
      [auth.businessId, `${SEED_NARRATION_PREFIX}%`],
    );
    await client.query('COMMIT');

    return NextResponse.json({
      deleted: true,
      lines_removed: res.rowCount ?? 0,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow
    }
    const err = error as { message?: string };
    console.error('seed-pl-demo DELETE error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
