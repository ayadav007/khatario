import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/budgets/[id]/variance
 * Get budget vs actual variance report
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const budgetId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const asOnDate = searchParams.get('as_on_date') || new Date().toISOString().split('T')[0];

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get budget details
    const budget = await queryOne(
      'SELECT * FROM budgets WHERE id = $1 AND business_id = $2',
      [budgetId, businessId]
    );

    if (!budget) {
      return NextResponse.json(
        { error: 'Budget not found' },
        { status: 404 }
      );
    }

    // Get budget lines
    const budgetLines = await queryRows(`
      SELECT 
        bl.*,
        a.account_code,
        a.account_name,
        a.account_type
      FROM budget_lines bl
      LEFT JOIN accounts a ON bl.account_id = a.id
      WHERE bl.budget_id = $1
      ORDER BY a.account_code
    `, [budgetId]);

    // Calculate actual amounts for each budget line
    const variance = await Promise.all(
      budgetLines.map(async (line: any) => {
        // Get actual amount from ledger
        let dateFilter = `AND lel.entry_date >= $2 AND lel.entry_date <= $3`;
        const params: any[] = [line.account_id, businessId, budget.period_start_date, asOnDate];

        if (line.period_month) {
          // For monthly budgets, filter by specific month
          const year = new Date(budget.period_start_date).getFullYear();
          const monthStart = new Date(year, line.period_month - 1, 1);
          const monthEnd = new Date(year, line.period_month, 0);
          dateFilter = `AND lel.entry_date >= $4 AND lel.entry_date <= $5`;
          params.push(monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0]);
        }

        const actual = await queryOne(`
          SELECT 
            COALESCE(SUM(
              CASE 
                WHEN a.account_type IN ('asset', 'expense') THEN lel.debit - lel.credit
                ELSE lel.credit - lel.debit
              END
            ), 0) as amount
          FROM ledger_entry_lines lel
          LEFT JOIN accounts a ON lel.account_id = a.id
          WHERE lel.account_id = $1 AND lel.business_id = $2 ${dateFilter}
        `, params);

        const actualAmount = parseFloat(actual?.amount || '0');
        const budgetAmount = parseFloat(line.budget_amount);
        const varianceAmount = actualAmount - budgetAmount;
        const variancePercentage = budgetAmount !== 0 
          ? (varianceAmount / budgetAmount) * 100 
          : 0;

        return {
          ...line,
          actual_amount: actualAmount,
          variance_amount: varianceAmount,
          variance_percentage: variancePercentage,
        };
      })
    );

    // Calculate totals
    const totals = variance.reduce((acc, item) => {
      acc.budget_total += parseFloat(item.budget_amount);
      acc.actual_total += item.actual_amount;
      acc.variance_total += item.variance_amount;
      return acc;
    }, { budget_total: 0, actual_total: 0, variance_total: 0 });

    return NextResponse.json({
      budget,
      variance,
      totals,
    });
  } catch (error: any) {
    console.error('Error calculating budget variance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

