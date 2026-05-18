import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/accounts/reconciliation
 * Get account reconciliation data
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const accountId = searchParams.get('account_id');
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!accountId) {
      return NextResponse.json(
        { error: 'account_id is required' },
        { status: 400 }
      );
    }

    if (!branchIdParam) {
      return NextResponse.json(
        { error: 'branch_id is required for branch-scoped reconciliation', code: 'BRANCH_REQUIRED' },
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

    // Get account details
    const account = await queryOne(`
      SELECT 
        a.*,
        ag.group_name as account_group_name
      FROM accounts a
      LEFT JOIN account_groups ag ON a.account_group_id = ag.id
      WHERE a.id = $1 AND a.business_id = $2
    `, [accountId, businessId]);

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Calculate opening balance
    let openingBalance = 0;
    if (account.opening_balance_type === 'debit') {
      openingBalance = account.nature === 'debit' 
        ? parseFloat(account.opening_balance || '0')
        : -parseFloat(account.opening_balance || '0');
    } else {
      openingBalance = account.nature === 'credit'
        ? -parseFloat(account.opening_balance || '0')
        : parseFloat(account.opening_balance || '0');
    }

    // Get all ledger entries up to as_on_date
    const ledgerEntries = await queryRows(`
      SELECT 
        lel.id,
        lel.entry_date,
        lel.voucher_type,
        lel.voucher_id,
        lel.reference_number,
        lel.narration,
        lel.debit,
        lel.credit,
        lel.created_at
      FROM ledger_entry_lines lel
      WHERE lel.account_id = $1 
        AND lel.business_id = $2
        AND lel.branch_id = $4
        AND lel.entry_date <= $3
      ORDER BY lel.entry_date, lel.created_at
    `, [accountId, businessId, asOnDate, finalBranchId]);

    // Calculate running balance
    let runningBalance = openingBalance;
    const entriesWithBalance = ledgerEntries.map((entry: any) => {
      if (account.nature === 'debit') {
        runningBalance += parseFloat(entry.debit || '0') - parseFloat(entry.credit || '0');
      } else {
        runningBalance += parseFloat(entry.credit || '0') - parseFloat(entry.debit || '0');
      }
      return {
        ...entry,
        running_balance: runningBalance,
      };
    });

    // Get current balance using function
    const currentBalance = await queryOne(`
      SELECT get_account_balance($1, $2, $3, $4) as balance
    `, [accountId, businessId, asOnDate, finalBranchId]);

    // Summary
    const summary = {
      opening_balance: openingBalance,
      total_debit: ledgerEntries.reduce((sum, e: any) => sum + parseFloat(e.debit || '0'), 0),
      total_credit: ledgerEntries.reduce((sum, e: any) => sum + parseFloat(e.credit || '0'), 0),
      current_balance: parseFloat(currentBalance?.balance || '0'),
      transaction_count: ledgerEntries.length,
    };

    return NextResponse.json({
      account,
      opening_balance: openingBalance,
      entries: entriesWithBalance,
      summary,
    });
  } catch (error: any) {
    console.error('Error generating account reconciliation:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

