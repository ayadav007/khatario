import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/inter-branch-reconciliation
 * Inter-branch reconciliation report
 * Validates that inter-branch receivables match inter-branch payables
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription report access (advanced report)
    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: businessId,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'report', 'read', {
        businessId,
        branchId: finalBranchId,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get Inter-Branch Receivables account (1109)
    const receivablesAccount = await queryOne(`
      SELECT id, account_code, account_name
      FROM accounts
      WHERE business_id = $1 AND account_code = '1109'
    `, [businessId]);

    // Get Inter-Branch Payables account (2111)
    const payablesAccount = await queryOne(`
      SELECT id, account_code, account_name
      FROM accounts
      WHERE business_id = $1 AND account_code = '2111'
    `, [businessId]);

    if (!receivablesAccount || !payablesAccount) {
      return NextResponse.json(
        { error: 'Inter-branch accounts not found. Please ensure accounts 1109 and 2111 exist.' },
        { status: 404 }
      );
    }

    // Calculate total Inter-Branch Receivables (debit balance)
    const receivablesBalance = await queryOne(`
      SELECT 
        COALESCE(SUM(debit - credit), 0) as balance
      FROM ledger_entry_lines
      WHERE account_id = $1
        AND business_id = $2
        AND entry_date <= $3
    `, [receivablesAccount.id, businessId, asOnDate]);

    // Calculate total Inter-Branch Payables (credit balance)
    const payablesBalance = await queryOne(`
      SELECT 
        COALESCE(SUM(credit - debit), 0) as balance
      FROM ledger_entry_lines
      WHERE account_id = $1
        AND business_id = $2
        AND entry_date <= $3
    `, [payablesAccount.id, businessId, asOnDate]);

    const receivablesTotal = parseFloat(receivablesBalance?.balance || '0');
    const payablesTotal = parseFloat(payablesBalance?.balance || '0');
    const difference = Math.abs(receivablesTotal - payablesTotal);
    const isReconciled = difference < 0.01; // Allow 0.01 tolerance for rounding

    // Get branch-wise breakdown
    const branchReceivables = await queryRows(`
      SELECT 
        b.id as branch_id,
        b.name as branch_name,
        COALESCE(SUM(lel.debit - lel.credit), 0) as receivables_balance
      FROM ledger_entry_lines lel
      JOIN branches b ON lel.branch_id = b.id
      WHERE lel.account_id = $1
        AND lel.business_id = $2
        AND lel.entry_date <= $3
      GROUP BY b.id, b.name
      ORDER BY b.name
    `, [receivablesAccount.id, businessId, asOnDate]);

    const branchPayables = await queryRows(`
      SELECT 
        b.id as branch_id,
        b.name as branch_name,
        COALESCE(SUM(lel.credit - lel.debit), 0) as payables_balance
      FROM ledger_entry_lines lel
      JOIN branches b ON lel.branch_id = b.id
      WHERE lel.account_id = $1
        AND lel.business_id = $2
        AND lel.entry_date <= $3
      GROUP BY b.id, b.name
      ORDER BY b.name
    `, [payablesAccount.id, businessId, asOnDate]);

    // Get unmatched transactions (entries where receivables don't match payables)
    const unmatchedTransactions = await queryRows(`
      SELECT 
        lel.voucher_id,
        lel.voucher_type,
        lel.entry_date,
        lel.narration,
        b.name as branch_name,
        CASE 
          WHEN lel.account_id = $1 THEN 'Receivable'
          WHEN lel.account_id = $2 THEN 'Payable'
        END as transaction_type,
        CASE 
          WHEN lel.account_id = $1 THEN lel.debit - lel.credit
          WHEN lel.account_id = $2 THEN lel.credit - lel.debit
        END as amount
      FROM ledger_entry_lines lel
      LEFT JOIN branches b ON lel.branch_id = b.id
      WHERE lel.account_id IN ($1, $2)
        AND lel.business_id = $3
        AND lel.entry_date <= $4
      ORDER BY lel.entry_date DESC, lel.created_at DESC
    `, [receivablesAccount.id, payablesAccount.id, businessId, asOnDate]);

    return NextResponse.json({
      as_on_date: asOnDate,
      receivables_account: {
        id: receivablesAccount.id,
        code: receivablesAccount.account_code,
        name: receivablesAccount.account_name
      },
      payables_account: {
        id: payablesAccount.id,
        code: payablesAccount.account_code,
        name: payablesAccount.account_name
      },
      totals: {
        receivables: receivablesTotal,
        payables: payablesTotal,
        difference: difference,
        is_reconciled: isReconciled
      },
      branch_wise: {
        receivables: branchReceivables,
        payables: branchPayables
      },
      unmatched_transactions: unmatchedTransactions,
      reconciliation_status: isReconciled ? 'reconciled' : 'unreconciled',
      message: isReconciled 
        ? 'Inter-branch accounts are reconciled' 
        : `Inter-branch accounts are not reconciled. Difference: ₹${difference.toFixed(2)}`
    });
  } catch (error: any) {
    console.error('Error generating inter-branch reconciliation:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
