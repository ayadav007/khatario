import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { format, eachMonthOfInterval, subDays } from 'date-fns';

/**
 * GET /api/dashboard/cash-flow
 * Get monthly cash flow data for fiscal year
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const fiscalYear = searchParams.get('fiscal_year'); // e.g., "2024" means FY 2024-25

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Determine fiscal year
    const currentDate = new Date();
    let year = fiscalYear ? parseInt(fiscalYear) : currentDate.getFullYear();
    
    // If current month is Jan-Mar, fiscal year is previous year
    if (currentDate.getMonth() < 3 && !fiscalYear) {
      year = currentDate.getFullYear() - 1;
    }

    const fiscalYearStart = new Date(year, 3, 1); // April 1
    const fiscalYearEnd = new Date(year + 1, 2, 31); // March 31
    const fyStartStr = fiscalYearStart.toISOString().split('T')[0];
    const fyEndStr = fiscalYearEnd.toISOString().split('T')[0];
    /** Balance as of last day before FY (cash position on 1 Apr morning). */
    const openingAsOf = subDays(fiscalYearStart, 1).toISOString().split('T')[0];

    let openingBalance = 0;
    try {
      const cashBankAccounts = await queryRows<{ id: string }>(
        `SELECT id FROM accounts
         WHERE business_id = $1
           AND is_active = true
           AND account_type = 'asset'
           AND (
             account_code LIKE '1101%'
             OR account_code LIKE '1102%'
             OR account_name ILIKE '%cash%'
             OR account_name ILIKE '%bank%'
           )`,
        [businessId]
      );

      for (const account of cashBankAccounts) {
        const row = await queryOne<{ balance: string }>(
          `SELECT get_account_balance($1::uuid, $2::uuid, $3::date, NULL::uuid) AS balance`,
          [account.id, businessId, openingAsOf]
        );
        openingBalance += Number(row?.balance ?? 0);
      }
    } catch (error) {
      console.warn('[cash-flow] Could not fetch ledger opening balance:', error);
      openingBalance = 0;
    }

    // Get all months in fiscal year
    const months = eachMonthOfInterval({
      start: fiscalYearStart,
      end: fiscalYearEnd
    });

    // Get incoming payments (receivables) grouped by month
    const incomingPayments = await queryRows<{
      month: string;
      total: number;
    }>(
      `SELECT 
        TO_CHAR(payment_date, 'YYYY-MM') as month,
        COALESCE(SUM(ABS(amount)), 0) as total
       FROM payments
       WHERE business_id = $1
         AND deleted_at IS NULL
         AND type = 'receivable'
         AND payment_date >= $2
         AND payment_date <= $3
       GROUP BY TO_CHAR(payment_date, 'YYYY-MM')
       ORDER BY month`,
      [businessId, fyStartStr, fyEndStr]
    );

    // Cash out: payment-out records (includes supplier / purchase settlements)
    const outgoingPayments = await queryRows<{
      month: string;
      total: number;
    }>(
      `SELECT
        TO_CHAR(payment_date, 'YYYY-MM') AS month,
        COALESCE(SUM(ABS(amount)), 0) AS total
       FROM payments
       WHERE business_id = $1
         AND deleted_at IS NULL
         AND type = 'payable'
         AND payment_date >= $2
         AND payment_date <= $3
       GROUP BY TO_CHAR(payment_date, 'YYYY-MM')
       ORDER BY month`,
      [businessId, fyStartStr, fyEndStr]
    );

    // Get expenses grouped by month — only expenses that were actually paid in cash/bank
    // (on_account / pay_later are Dr expense Cr payables; no cash out until supplier payment in payments)
    const expenses = await queryRows<{
      month: string;
      total: number;
    }>(
      `SELECT 
        TO_CHAR(expense_date, 'YYYY-MM') as month,
        COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE business_id = $1
         AND expense_date >= $2
         AND expense_date <= $3
         AND LOWER(COALESCE(payment_mode, '')) NOT IN ('on_account', 'pay_later', 'unpaid', 'credit')
       GROUP BY TO_CHAR(expense_date, 'YYYY-MM')
       ORDER BY month`,
      [businessId, fyStartStr, fyEndStr]
    );

    const incomingMap = new Map<string, number>();
    incomingPayments.forEach((p) => {
      incomingMap.set(p.month, Number(p.total));
    });

    const outgoingMap = new Map<string, number>();
    outgoingPayments.forEach((p) => {
      outgoingMap.set(p.month, (outgoingMap.get(p.month) || 0) + Number(p.total));
    });
    expenses.forEach((e) => {
      outgoingMap.set(e.month, (outgoingMap.get(e.month) || 0) + Number(e.total));
    });

    // Build monthly data
    const monthlyData: Array<{
      month: string;
      monthLabel: string;
      opening: number;
      incoming: number;
      outgoing: number;
      closing: number;
    }> = [];

    let runningBalance = openingBalance;

    months.forEach((monthDate) => {
      const monthKey = format(monthDate, 'yyyy-MM');
      const monthLabel = format(monthDate, 'MMM yyyy');
      
      const incoming = incomingMap.get(monthKey) || 0;
      const outgoing = outgoingMap.get(monthKey) || 0;
      const opening = runningBalance;
      const closing = opening + incoming - outgoing;

      monthlyData.push({
        month: monthKey,
        monthLabel,
        opening,
        incoming,
        outgoing,
        closing
      });

      runningBalance = closing;
    });

    // Calculate summary totals
    const totalIncoming = monthlyData.reduce((sum, m) => sum + m.incoming, 0);
    const totalOutgoing = monthlyData.reduce((sum, m) => sum + m.outgoing, 0);
    const closingBalance = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].closing : openingBalance;

    // Calculate breakdown totals for tooltips
    const totalPayablePayments = outgoingPayments.reduce((sum, p) => sum + Number(p.total), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.total), 0);
    const totalReceivablePayments = incomingPayments.reduce((sum, p) => sum + Number(p.total), 0);

    const openingLabel = format(fiscalYearStart, 'dd MMM yyyy');

    return NextResponse.json({
      fiscal_year: `${year}-${year + 1}`,
      months: monthlyData,
      chart_series: [
        {
          month: 'opening',
          monthLabel: `Opening (${openingLabel})`,
          opening: openingBalance,
          incoming: 0,
          outgoing: 0,
          closing: openingBalance,
        },
        ...monthlyData,
      ],
      summary: {
        total_incoming: totalIncoming,
        total_outgoing: totalOutgoing,
        opening_balance: openingBalance,
        closing_balance: closingBalance,
        opening_as_of: openingAsOf,
        breakdown: {
          incoming: {
            receivable_payments: totalReceivablePayments,
          },
          outgoing: {
            payments_out: totalPayablePayments,
            expenses: totalExpenses,
            /** @deprecated use payments_out — kept for older clients */
            purchases: 0,
            other_payments: totalPayablePayments,
          },
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching cash flow data:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

