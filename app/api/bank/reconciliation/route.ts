import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, queryRows } from '@/lib/db';
import {
  runBankReconciliationEngine,
  type BankLineInput,
  type LedgerLineInput,
} from '@/lib/bank/reconciliation-engine';
import { parseMatchedLedgerIds, bankLineAgeDays } from '@/lib/bank/reconciliation-common';
import { extractReferencesFromDescription } from '@/lib/bank/reference-extract';
import { computeDuplicateFlags } from '@/lib/bank/duplicate-detect';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bank/reconciliation?bank_statement_id=&business_id=
 * or GET /api/bank/reconciliation?bank_account_id=  → list recent statements
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getBusinessIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const { searchParams } = new URL(request.url);
    const statementId = searchParams.get('bank_statement_id');
    const bankAccountId = searchParams.get('bank_account_id');

    if (!statementId && bankAccountId) {
      const statements = await queryRows<{
        id: string;
        statement_period_start: string;
        statement_period_end: string;
        closing_balance: string;
        import_date: string;
        reconciliation_status: string;
      }>(
        `SELECT bs.id, bs.statement_period_start::text, bs.statement_period_end::text,
                bs.closing_balance::text, bs.import_date::text,
                COALESCE(bs.reconciliation_status,
                  CASE WHEN bs.is_reconciled THEN 'completed' ELSE 'in_progress' END) AS reconciliation_status
         FROM bank_statements bs
         WHERE bs.business_id = $1 AND bs.bank_account_id = $2
         ORDER BY bs.import_date DESC NULLS LAST, bs.created_at DESC
         LIMIT 50`,
        [businessId, bankAccountId]
      );
      return NextResponse.json({ statements });
    }

    if (!statementId) {
      return NextResponse.json(
        { error: 'bank_statement_id or bank_account_id is required' },
        { status: 400 }
      );
    }

    const stmt = await queryOne<{
      id: string;
      bank_account_id: string;
      statement_period_start: string;
      statement_period_end: string;
      opening_balance: string;
      closing_balance: string;
      file_name: string | null;
      reconciliation_status: string | null;
      is_reconciled: boolean | null;
    }>(
      `SELECT id, bank_account_id,
              statement_period_start::text, statement_period_end::text,
              opening_balance::text, closing_balance::text, file_name,
              reconciliation_status,
              is_reconciled
       FROM bank_statements
       WHERE id = $1 AND business_id = $2`,
      [statementId, businessId]
    );

    if (!stmt) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    const reconciliationStatus =
      stmt.reconciliation_status ||
      (stmt.is_reconciled ? 'completed' : 'in_progress');

    const bankAccount = await queryOne<{ ledger_account_id: string | null }>(
      'SELECT ledger_account_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [stmt.bank_account_id, businessId]
    );

    if (!bankAccount?.ledger_account_id) {
      return NextResponse.json(
        { error: 'Bank account has no linked ledger account' },
        { status: 400 }
      );
    }

    const ledgerBalRow = await queryOne<{ b: string }>(
      `SELECT get_account_balance($1::uuid, $2::uuid, $3::date, NULL::uuid)::text AS b`,
      [bankAccount.ledger_account_id, businessId, stmt.statement_period_end]
    );
    const ledgerBookBalance = parseFloat(ledgerBalRow?.b || '0');

    const lines = await queryRows<{
      id: string;
      transaction_date: string;
      description: string;
      debit_amount: string;
      credit_amount: string;
      balance: string;
      match_status: string;
      matched_ledger_ids: unknown;
      is_matched: boolean;
    }>(
      `SELECT id, transaction_date::text, description,
              debit_amount::text, credit_amount::text, balance::text,
              COALESCE(match_status, CASE WHEN is_matched THEN 'matched' ELSE 'unmatched' END) AS match_status,
              matched_ledger_ids, is_matched
       FROM bank_statement_lines
       WHERE bank_statement_id = $1 AND business_id = $2
       ORDER BY transaction_date, id`,
      [statementId, businessId]
    );

    const dupFlags = computeDuplicateFlags(
      lines.map((l) => ({
        id: l.id,
        transaction_date: l.transaction_date,
        debit_amount: parseFloat(l.debit_amount || '0'),
        credit_amount: parseFloat(l.credit_amount || '0'),
        description: l.description,
      }))
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

    const matchedCount = lines.filter((l) =>
      ['matched', 'partial'].includes(l.match_status)
    ).length;
    const ignoredCount = lines.filter((l) => l.match_status === 'ignored').length;
    const unmatchedCount = lines.filter((l) => l.match_status === 'unmatched').length;

    const opening = parseFloat(stmt.opening_balance || '0');
    const closing = parseFloat(stmt.closing_balance || '0');
    const reconciliationDifference = closing - ledgerBookBalance;

    return NextResponse.json({
      statement: {
        id: stmt.id,
        bank_account_id: stmt.bank_account_id,
        statement_period_start: stmt.statement_period_start,
        statement_period_end: stmt.statement_period_end,
        opening_balance: stmt.opening_balance,
        closing_balance: stmt.closing_balance,
        file_name: stmt.file_name,
        reconciliation_status: reconciliationStatus,
      },
      lines: lines.map((l) => {
        const extracted = extractReferencesFromDescription(l.description);
        return {
          ...l,
          matched_ledger_ids: parseMatchedLedgerIds(l.matched_ledger_ids),
          age_days: bankLineAgeDays(l.transaction_date),
          extracted_references: extracted,
          is_duplicate: dupFlags.get(l.id) === true,
        };
      }),
      ledger_lines: ledgerLines,
      suggestions: engine.suggestions,
      summary: {
        opening_balance: opening,
        closing_balance: closing,
        /** Statement movement: closing − opening. */
        difference: closing - opening,
        /** Bank statement closing vs book balance on linked ledger account (as of period end). */
        reconciliation_difference: reconciliationDifference,
        ledger_book_balance: ledgerBookBalance,
        matched_count: matchedCount,
        unmatched_count: unmatchedCount,
        ignored_count: ignoredCount,
        total_lines: lines.length,
      },
    });
  } catch (error: any) {
    console.error('bank reconciliation GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load reconciliation' },
      { status: 500 }
    );
  }
}
