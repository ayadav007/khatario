import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, queryRows, getPool } from '@/lib/db';
import {
  runBankReconciliationEngine,
  suggestionIsHighConfidenceAutoMatch,
  type BankLineInput,
  type LedgerLineInput,
} from '@/lib/bank/reconciliation-engine';
import { parseMatchedLedgerIds } from '@/lib/bank/reconciliation-common';
import { isBankStatementReconciliationCompleted } from '@/lib/bank/statement-workflow';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank/reconciliation/auto-match
 * Applies only high-confidence suggestions (exact + strong reference).
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
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const statementId = body.bank_statement_id as string;
    if (!statementId) {
      return NextResponse.json({ error: 'bank_statement_id is required' }, { status: 400 });
    }

    if (await isBankStatementReconciliationCompleted(businessId, statementId)) {
      return NextResponse.json(
        { error: 'Statement is marked reconciled; undo a match to continue.' },
        { status: 409 }
      );
    }

    const stmt = await queryOne<{
      bank_account_id: string;
      statement_period_start: string;
      statement_period_end: string;
    }>(
      `SELECT bank_account_id, statement_period_start::text, statement_period_end::text
       FROM bank_statements WHERE id = $1 AND business_id = $2`,
      [statementId, businessId]
    );
    if (!stmt) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    const bankAccount = await queryOne<{ ledger_account_id: string | null }>(
      'SELECT ledger_account_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [stmt.bank_account_id, businessId]
    );
    if (!bankAccount?.ledger_account_id) {
      return NextResponse.json({ error: 'Bank account has no linked ledger account' }, { status: 400 });
    }

    const lines = await queryRows<{
      id: string;
      transaction_date: string;
      description: string;
      debit_amount: string;
      credit_amount: string;
      match_status: string;
      matched_ledger_ids: unknown;
    }>(
      `SELECT id, transaction_date::text, description,
              debit_amount::text, credit_amount::text,
              COALESCE(match_status, CASE WHEN is_matched THEN 'matched' ELSE 'unmatched' END) AS match_status,
              matched_ledger_ids
       FROM bank_statement_lines
       WHERE bank_statement_id = $1 AND business_id = $2
       ORDER BY transaction_date, id`,
      [statementId, businessId]
    );

    const extStart = new Date(stmt.statement_period_start);
    const extEnd = new Date(stmt.statement_period_end);
    extStart.setDate(extStart.getDate() - 7);
    extEnd.setDate(extEnd.getDate() + 7);
    const fromD = extStart.toISOString().slice(0, 10);
    const toD = extEnd.toISOString().slice(0, 10);

    const ledgerLines = await queryRows<{
      id: string;
      entry_date: string;
      debit: string;
      credit: string;
      narration: string | null;
      reference_number: string | null;
    }>(
      `SELECT id, entry_date::text, debit::text, credit::text, narration, reference_number
       FROM ledger_entry_lines
       WHERE business_id = $1 AND account_id = $2
         AND entry_date BETWEEN $3::date AND $4::date
       ORDER BY entry_date, id
       LIMIT 5000`,
      [businessId, bankAccount.ledger_account_id, fromD, toD]
    );

    const bankInputs: BankLineInput[] = lines.map((l) => ({
      id: l.id,
      transaction_date: l.transaction_date,
      description: l.description,
      debit_amount: parseFloat(l.debit_amount || '0'),
      credit_amount: parseFloat(l.credit_amount || '0'),
    }));

    const ledgerInputs: LedgerLineInput[] = ledgerLines.map((l) => ({
      id: l.id,
      entry_date: l.entry_date,
      debit: parseFloat(l.debit || '0'),
      credit: parseFloat(l.credit || '0'),
      narration: l.narration,
      reference_number: l.reference_number,
    }));

    const engineBankLines = bankInputs.filter((b) => {
      const row = lines.find((l) => l.id === b.id);
      return row?.match_status === 'unmatched';
    });

    const usedLedger = new Set<string>();
    for (const l of lines) {
      if (l.match_status === 'matched' || l.match_status === 'partial') {
        for (const id of parseMatchedLedgerIds(l.matched_ledger_ids)) usedLedger.add(id);
      }
    }

    const ledgerForEngine = ledgerInputs.filter((l) => !usedLedger.has(l.id));
    const engine = runBankReconciliationEngine({
      bankLines: engineBankLines,
      ledgerLines: ledgerForEngine,
    });

    const toApply = engine.suggestions.filter(suggestionIsHighConfidenceAutoMatch);
    let matchedCount = 0;
    let skippedCount = engine.suggestions.length - toApply.length;

    await client.query('BEGIN');
    for (const sug of toApply) {
      const ledgerId = sug.ledgerLineIds[0];
      if (!ledgerId) {
        skippedCount++;
        continue;
      }

      const conflict = await client.query(
        `SELECT 1 FROM bank_statement_lines
         WHERE business_id = $1
           AND bank_statement_id = $2
           AND id <> $3::uuid
           AND (
             matched_ledger_entry_id = $4::uuid
             OR matched_ledger_ids @> to_jsonb(ARRAY[$4::text]::text[])
           )
         LIMIT 1`,
        [businessId, statementId, sug.bankLineId, ledgerId]
      );
      if (conflict.rows.length > 0) {
        skippedCount++;
        continue;
      }

      const matchType = sug.tier === 'exact' ? 'exact' : 'reference';
      const upd = await client.query(
        `UPDATE bank_statement_lines SET
           match_status = 'matched',
           matched_ledger_ids = $1::jsonb,
           is_matched = true,
           matched_ledger_entry_id = $2::uuid,
           match_type = $3,
           matched_at = CURRENT_TIMESTAMP,
           matched_by = $4::uuid
         WHERE id = $5 AND business_id = $6 AND bank_statement_id = $7
           AND match_status = 'unmatched'
         RETURNING id`,
        [JSON.stringify([ledgerId]), ledgerId, matchType, userId, sug.bankLineId, businessId, statementId]
      );
      if (upd.rowCount && upd.rowCount > 0) matchedCount++;
      else skippedCount++;
    }
    await client.query('COMMIT');

    return NextResponse.json({
      matched_count: matchedCount,
      skipped_count: skippedCount,
      suggestions_total: engine.suggestions.length,
    });
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('bank auto-match error:', error);
    return NextResponse.json(
      { error: error?.message || 'Auto-match failed' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
