import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bank-statements/unreconciled
 * Get unmatched transactions
 */
export const GET = withPremiumSubscriptionApi({}, async ({ request, businessId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const bankAccountId = searchParams.get('bank_account_id');
    const statementId = searchParams.get('bank_statement_id');

    let sql = `
      SELECT 
        bsl.*,
        bs.statement_period_start,
        bs.statement_period_end,
        ba.account_name as bank_account_name
      FROM bank_statement_lines bsl
      LEFT JOIN bank_statements bs ON bsl.bank_statement_id = bs.id
      LEFT JOIN bank_accounts ba ON bs.bank_account_id = ba.id
      WHERE bsl.business_id = $1 AND bsl.is_matched = false
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (bankAccountId) {
      sql += ` AND bs.bank_account_id = $${paramIndex}`;
      params.push(bankAccountId);
      paramIndex++;
    }

    if (statementId) {
      sql += ` AND bsl.bank_statement_id = $${paramIndex}`;
      params.push(statementId);
      paramIndex++;
    }

    sql += ` ORDER BY bsl.transaction_date DESC`;

    const transactions = await queryRows(sql, params);

    return NextResponse.json({ transactions });
  } catch (error: any) {
    console.error('Error fetching unreconciled transactions:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
});
