import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, getPool } from '@/lib/db';
import { createLedgerEntryLine } from '@/lib/ledger-utils';
import { resolveBranchId } from '@/lib/branch-helpers';
import { isBankStatementReconciliationCompleted } from '@/lib/bank/statement-workflow';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank/reconciliation/create-entry
 * Body: business_id, bank_statement_id, statement_line_id, type: bank_charge | interest, account_id
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const body = await request.json();
    const businessId = (body.business_id as string) || getBusinessIdFromRequest(request);
    const userId = resolveCreatedByUserId(request, body);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user context are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'journal', 'create', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const statementId = body.bank_statement_id as string;
    const lineId = body.statement_line_id as string;
    const entryType = body.type as 'bank_charge' | 'interest';
    const otherAccountId = body.account_id as string;

    if (!statementId || !lineId || !entryType || !otherAccountId) {
      return NextResponse.json(
        { error: 'bank_statement_id, statement_line_id, type, and account_id are required' },
        { status: 400 }
      );
    }

    if (entryType !== 'bank_charge' && entryType !== 'interest') {
      return NextResponse.json({ error: 'type must be bank_charge or interest' }, { status: 400 });
    }

    if (await isBankStatementReconciliationCompleted(businessId, statementId)) {
      return NextResponse.json(
        { error: 'Statement is marked reconciled; reopen before creating entries.' },
        { status: 409 }
      );
    }

    const acc = await queryOne<{ account_type: string }>(
      `SELECT account_type FROM accounts WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [otherAccountId, businessId]
    );
    if (!acc) {
      return NextResponse.json({ error: 'account_id not found' }, { status: 404 });
    }
    if (entryType === 'bank_charge' && acc.account_type !== 'expense') {
      return NextResponse.json(
        { error: 'Bank charge postings should use an expense account' },
        { status: 400 }
      );
    }
    if (entryType === 'interest' && acc.account_type !== 'income') {
      return NextResponse.json(
        { error: 'Interest postings should use an income account' },
        { status: 400 }
      );
    }

    const line = await queryOne<{
      id: string;
      transaction_date: string;
      description: string;
      debit_amount: string;
      credit_amount: string;
      match_status: string;
    }>(
      `SELECT id, transaction_date::text, description, debit_amount::text, credit_amount::text,
              COALESCE(match_status, CASE WHEN is_matched THEN 'matched' ELSE 'unmatched' END) AS match_status
       FROM bank_statement_lines
       WHERE id = $1 AND business_id = $2 AND bank_statement_id = $3`,
      [lineId, businessId, statementId]
    );
    if (!line) {
      return NextResponse.json({ error: 'Statement line not found' }, { status: 404 });
    }
    if (line.match_status !== 'unmatched') {
      return NextResponse.json({ error: 'Line must be unmatched' }, { status: 400 });
    }

    const debitAmt = parseFloat(line.debit_amount || '0');
    const creditAmt = parseFloat(line.credit_amount || '0');

    const stmt = await queryOne<{ bank_account_id: string }>(
      'SELECT bank_account_id FROM bank_statements WHERE id = $1 AND business_id = $2',
      [statementId, businessId]
    );
    if (!stmt) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    const bankRow = await queryOne<{ ledger_account_id: string | null; branch_id: string | null }>(
      'SELECT ledger_account_id, branch_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [stmt.bank_account_id, businessId]
    );
    if (!bankRow?.ledger_account_id) {
      return NextResponse.json({ error: 'Bank account has no ledger link' }, { status: 400 });
    }

    let branchId = bankRow.branch_id;
    if (!branchId) {
      branchId = await resolveBranchId({ businessId, branchId: undefined });
    }

    let amount = 0;
    if (entryType === 'bank_charge') {
      if (debitAmt <= 0.005) {
        return NextResponse.json(
          { error: 'Bank charge expects a statement debit (withdrawal) amount' },
          { status: 400 }
        );
      }
      amount = Math.round(debitAmt * 100) / 100;
    } else {
      if (creditAmt <= 0.005) {
        return NextResponse.json(
          { error: 'Interest expects a statement credit (deposit) amount' },
          { status: 400 }
        );
      }
      amount = Math.round(creditAmt * 100) / 100;
    }

    await client.query('BEGIN');

    const voucherNumberResult = await client.query(
      'SELECT generate_voucher_number($1, $2, $3) as voucher_number',
      [businessId, 'journal', line.transaction_date]
    );
    const voucherNumber = voucherNumberResult.rows[0].voucher_number as string;
    const voucherIdResult = await client.query('SELECT uuid_generate_v4() as id');
    const voucherId = voucherIdResult.rows[0].id as string;

    const narr = `${entryType === 'bank_charge' ? 'Bank charge' : 'Bank interest'} — ${line.description.slice(0, 200)}`;

    let bankLegId: string;
    if (entryType === 'bank_charge') {
      await createLedgerEntryLine({
        businessId,
        voucherId,
        voucherType: 'journal',
        accountId: otherAccountId,
        entryDate: line.transaction_date,
        debit: amount,
        credit: 0,
        narration: narr,
        referenceNumber: voucherNumber,
        branchId,
        poolClient: client,
      });
      bankLegId = await createLedgerEntryLine({
        businessId,
        voucherId,
        voucherType: 'journal',
        accountId: bankRow.ledger_account_id,
        entryDate: line.transaction_date,
        debit: 0,
        credit: amount,
        narration: narr,
        referenceNumber: voucherNumber,
        branchId,
        poolClient: client,
      });
    } else {
      bankLegId = await createLedgerEntryLine({
        businessId,
        voucherId,
        voucherType: 'journal',
        accountId: bankRow.ledger_account_id,
        entryDate: line.transaction_date,
        debit: amount,
        credit: 0,
        narration: narr,
        referenceNumber: voucherNumber,
        branchId,
        poolClient: client,
      });
      await createLedgerEntryLine({
        businessId,
        voucherId,
        voucherType: 'journal',
        accountId: otherAccountId,
        entryDate: line.transaction_date,
        debit: 0,
        credit: amount,
        narration: narr,
        referenceNumber: voucherNumber,
        branchId,
        poolClient: client,
      });
    }

    await client.query(
      `INSERT INTO journal_entries (
        business_id, branch_id, voucher_id, voucher_number, entry_date,
        reference_number, narration, is_locked, created_by,
        is_reversing, reverses_entry_id, reversal_date, template_id, tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, false, NULL, NULL, NULL, NULL)
      ON CONFLICT (business_id, voucher_id) DO UPDATE SET
        voucher_number = EXCLUDED.voucher_number,
        entry_date = EXCLUDED.entry_date,
        reference_number = EXCLUDED.reference_number,
        narration = EXCLUDED.narration,
        updated_at = CURRENT_TIMESTAMP`,
      [
        businessId,
        branchId,
        voucherId,
        voucherNumber,
        line.transaction_date,
        voucherNumber,
        narr,
        userId,
      ]
    );

    await client.query(
      `UPDATE bank_statement_lines SET
         match_status = 'matched',
         matched_ledger_ids = $1::jsonb,
         is_matched = true,
         matched_ledger_entry_id = $2::uuid,
         match_type = 'manual',
         matched_at = CURRENT_TIMESTAMP,
         matched_by = $3::uuid
       WHERE id = $4 AND business_id = $5`,
      [JSON.stringify([bankLegId]), bankLegId, userId, lineId, businessId]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      voucher_id: voucherId,
      voucher_number: voucherNumber,
      matched_ledger_line_id: bankLegId,
    });
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('bank create-entry error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to create entry' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
