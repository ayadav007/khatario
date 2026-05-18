import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';

/**
 * GET /api/bank-statements/reconciliation-report
 * Generate bank reconciliation report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const bankAccountId = searchParams.get('bank_account_id');
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];

    if (!businessId || !bankAccountId) {
      return NextResponse.json(
        { error: 'business_id and bank_account_id are required' },
        { status: 400 }
      );
    }

    if (!branchIdParam) {
      return NextResponse.json(
        { error: 'branch_id is required', code: 'BRANCH_REQUIRED' },
        { status: 400 }
      );
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({ branchId: branchIdParam, businessId });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Invalid branch' }, { status: 400 });
    }

    // Get bank account details
    const bankAccount = await queryOne(`
      SELECT * FROM bank_accounts
      WHERE id = $1 AND business_id = $2
    `, [bankAccountId, businessId]);

    if (!bankAccount) {
      return NextResponse.json(
        { error: 'Bank account not found' },
        { status: 404 }
      );
    }

    // Get ledger balance
    let ledgerBalance = 0;
    if (bankAccount.ledger_account_id) {
      const balance = await queryOne(`
        SELECT get_account_balance($1, $2, $3, $4) as balance
      `, [bankAccount.ledger_account_id, businessId, asOnDate, finalBranchId]);
      ledgerBalance = parseFloat(balance?.balance || '0');
    }

    // Get statement balance (from most recent statement)
    const statement = await queryOne(`
      SELECT closing_balance FROM bank_statements
      WHERE bank_account_id = $1 AND business_id = $2
        AND statement_period_end <= $3
      ORDER BY statement_period_end DESC
      LIMIT 1
    `, [bankAccountId, businessId, asOnDate]);

    const statementBalance = parseFloat(statement?.closing_balance || '0');

    // Get unmatched transactions
    const unmatchedDebits = await queryOne(`
      SELECT COALESCE(SUM(debit_amount), 0) as total
      FROM bank_statement_lines bsl
      LEFT JOIN bank_statements bs ON bsl.bank_statement_id = bs.id
      WHERE bs.bank_account_id = $1 AND bsl.business_id = $2
        AND bsl.is_matched = false
        AND bsl.debit_amount > 0
        AND bsl.transaction_date <= $3
    `, [bankAccountId, businessId, asOnDate]);

    const unmatchedCredits = await queryOne(`
      SELECT COALESCE(SUM(credit_amount), 0) as total
      FROM bank_statement_lines bsl
      LEFT JOIN bank_statements bs ON bsl.bank_statement_id = bs.id
      WHERE bs.bank_account_id = $1 AND bsl.business_id = $2
        AND bsl.is_matched = false
        AND bsl.credit_amount > 0
        AND bsl.transaction_date <= $3
    `, [bankAccountId, businessId, asOnDate]);

    const difference = statementBalance - ledgerBalance;

    return NextResponse.json({
      as_on_date: asOnDate,
      bank_account: {
        id: bankAccount.id,
        account_name: bankAccount.account_name,
        account_number: bankAccount.account_number,
        bank_name: bankAccount.bank_name,
      },
      statement_balance: statementBalance,
      ledger_balance: ledgerBalance,
      difference: difference,
      unmatched_debits: parseFloat(unmatchedDebits?.total || '0'),
      unmatched_credits: parseFloat(unmatchedCredits?.total || '0'),
      is_reconciled: Math.abs(difference) < 0.01,
    });
  } catch (error: any) {
    console.error('Error generating reconciliation report:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

