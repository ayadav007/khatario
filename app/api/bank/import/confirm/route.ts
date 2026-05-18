import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  resolveCreatedByUserId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getPool, queryOne } from '@/lib/db';
import { roundMoney } from '@/lib/bank/normalize';
import type { BankStatementFileType, BankStatementSourceType } from '@/lib/bank/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConfirmRow = {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
};

/**
 * POST /api/bank/import/confirm
 * Persists bank_statement_imports, bank_statements, bank_statement_lines.
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const body = await request.json();
    const businessId = (body.business_id as string) || getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const createdBy = resolveCreatedByUserId(request, body);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }
    if (!createdBy) {
      return NextResponse.json({ error: 'created_by_user_id is required' }, { status: 400 });
    }

    const bankAccountId = body.bank_account_id as string;
    const fileName = String(body.file_name || 'import');
    const fileType = body.file_type as BankStatementFileType;
    const sourceType = body.source_type as BankStatementSourceType;
    const rows = body.rows as ConfirmRow[];

    if (!bankAccountId || !fileType || !sourceType || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: 'bank_account_id, file_type, source_type, and non-empty rows are required' },
        { status: 400 }
      );
    }

    try {
      await authorize(createdBy, 'settings', 'create', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const ba = await queryOne<{ id: string }>(
      'SELECT id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [bankAccountId, businessId]
    );
    if (!ba) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
    }

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const periodStart = sorted[0]!.date;
    const periodEnd = sorted[sorted.length - 1]!.date;

    const first = sorted[0]!;
    const opening =
      typeof body.opening_balance === 'number' && Number.isFinite(body.opening_balance)
        ? roundMoney(body.opening_balance)
        : first.balance != null
          ? roundMoney(first.balance - first.credit + first.debit)
          : 0;

    const last = sorted[sorted.length - 1]!;
    const closing =
      typeof body.closing_balance === 'number' && Number.isFinite(body.closing_balance)
        ? roundMoney(body.closing_balance)
        : last.balance != null
          ? roundMoney(last.balance)
          : roundMoney(
              opening + sorted.reduce((s, r) => s + roundMoney(r.credit) - roundMoney(r.debit), 0)
            );

    await client.query('BEGIN');

    const imp = await client.query(
      `INSERT INTO bank_statement_imports (
         business_id, bank_account_id, file_name, file_type, source_type, status
       ) VALUES ($1, $2, $3, $4, $5, 'processed')
       RETURNING id`,
      [businessId, bankAccountId, fileName, fileType, sourceType]
    );
    const importId = imp.rows[0].id as string;

    const stmt = await client.query(
      `INSERT INTO bank_statements (
         business_id, bank_account_id, statement_period_start, statement_period_end,
         opening_balance, closing_balance, file_name, imported_by, statement_import_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        businessId,
        bankAccountId,
        periodStart,
        periodEnd,
        opening,
        closing,
        fileName,
        createdBy,
        importId,
      ]
    );
    const statementId = stmt.rows[0].id as string;

    await client.query(
      `UPDATE bank_statement_imports SET bank_statement_id = $1 WHERE id = $2`,
      [statementId, importId]
    );

    let running = opening;
    for (const r of sorted) {
      running = roundMoney(running - roundMoney(r.debit) + roundMoney(r.credit));
      const balanceVal = r.balance != null ? roundMoney(r.balance) : running;
      await client.query(
        `INSERT INTO bank_statement_lines (
           business_id, bank_statement_id, import_id, transaction_date, value_date,
           description, debit_amount, credit_amount, balance,
           match_status, matched_ledger_ids, is_matched
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, false)`,
        [
          businessId,
          statementId,
          importId,
          r.date,
          r.date,
          String(r.description).slice(0, 4000),
          roundMoney(r.debit),
          roundMoney(r.credit),
          balanceVal,
          'unmatched',
          JSON.stringify([]),
        ]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json(
      {
        ok: true,
        bank_statement_id: statementId,
        import_id: importId,
        statement_period_start: periodStart,
        statement_period_end: periodEnd,
        opening_balance: opening,
        closing_balance: closing,
        lines_imported: sorted.length,
      },
      { status: 201 }
    );
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('bank import confirm error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to save import' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
