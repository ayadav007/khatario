import { NextRequest, NextResponse } from 'next/server';

/**
 * PUT /api/opening-balances/validate
 * Validate opening balance totals (ensure debits = credits for accounts)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, financial_year_id, opening_balances } = body;

    if (!business_id || !opening_balances || !Array.isArray(opening_balances)) {
      return NextResponse.json(
        { error: 'business_id and opening_balances array are required' },
        { status: 400 }
      );
    }

    // Filter account opening balances
    const accountBalances = opening_balances.filter((ob: any) => ob.entity_type === 'account');

    if (accountBalances.length === 0) {
      return NextResponse.json({
        is_valid: true,
        message: 'No account opening balances to validate',
        total_debit: 0,
        total_credit: 0,
        difference: 0,
      });
    }

    // Calculate totals
    let totalDebit = 0;
    let totalCredit = 0;

    for (const ob of accountBalances) {
      const amount = parseFloat(ob.opening_balance?.toString() || '0');
      if (ob.opening_balance_type === 'debit') {
        totalDebit += amount;
      } else {
        totalCredit += amount;
      }
    }

    const difference = Math.abs(totalDebit - totalCredit);
    const is_valid = difference < 0.01; // Allow for rounding errors

    return NextResponse.json({
      is_valid,
      message: is_valid
        ? 'Opening balances are balanced'
        : `Opening balances are not balanced. Difference: ₹${difference.toFixed(2)}`,
      total_debit: totalDebit,
      total_credit: totalCredit,
      difference: difference,
    });
  } catch (error: any) {
    console.error('Error validating opening balances:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

