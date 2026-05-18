import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';

/**
 * POST /api/accounts/close-year
 * Close financial year and create opening balances for next year
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      current_year_end_date,
      new_year_start_date,
      new_year_name,
      transfer_pnl_to_retained_earnings = true,
    } = body;

    if (!business_id || !current_year_end_date || !new_year_start_date || !new_year_name) {
      return NextResponse.json(
        { error: 'business_id, current_year_end_date, new_year_start_date, and new_year_name are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // 1. Get all active accounts
    const accounts = await queryRows(`
      SELECT * FROM accounts 
      WHERE business_id = $1 AND is_active = true
      ORDER BY account_code
    `, [business_id]);

    // 2. Calculate closing balances for each account
    const openingBalances: Array<{
      account_id: string;
      balance: number;
      balance_type: 'debit' | 'credit';
    }> = [];

    for (const account of accounts) {
      const balanceResult = await client.query(`
        SELECT get_account_balance($1, $2, $3, NULL::uuid) as balance
      `, [account.id, business_id, current_year_end_date]);

      const balance = parseFloat(balanceResult.rows[0]?.balance || '0');
      
      if (Math.abs(balance) > 0.01) { // Only include accounts with non-zero balance
        openingBalances.push({
          account_id: account.id,
          balance: Math.abs(balance),
          balance_type: balance >= 0 
            ? (account.nature === 'debit' ? 'debit' : 'credit')
            : (account.nature === 'debit' ? 'credit' : 'debit'),
        });
      }
    }

    // 3. Calculate Profit & Loss
    let netProfit = 0;
    if (transfer_pnl_to_retained_earnings) {
      // Get income accounts
      const incomeAccounts = accounts.filter(a => a.account_type === 'income');
      const expenseAccounts = accounts.filter(a => a.account_type === 'expense');

      let totalIncome = 0;
      let totalExpenses = 0;

      for (const acc of incomeAccounts) {
        const balanceResult = await client.query(`
          SELECT get_account_balance($1, $2, $3, NULL::uuid) as balance
        `, [acc.id, business_id, current_year_end_date]);
        totalIncome += parseFloat(balanceResult.rows[0]?.balance || '0');
      }

      for (const acc of expenseAccounts) {
        const balanceResult = await client.query(`
          SELECT get_account_balance($1, $2, $3, NULL::uuid) as balance
        `, [acc.id, business_id, current_year_end_date]);
        totalExpenses += Math.abs(parseFloat(balanceResult.rows[0]?.balance || '0'));
      }

      netProfit = totalIncome - totalExpenses;

      // Find Retained Earnings account
      const retainedEarnings = await queryOne(`
        SELECT id FROM accounts 
        WHERE business_id = $1 
          AND (account_code = '3002' OR LOWER(account_name) LIKE '%retained%earnings%')
          AND is_active = true
        LIMIT 1
      `, [business_id]);

      if (retainedEarnings && Math.abs(netProfit) > 0.01) {
        // Add P&L to retained earnings opening balance
        const existingRetained = openingBalances.find(ob => ob.account_id === retainedEarnings.id);
        if (existingRetained) {
          if (netProfit > 0) {
            existingRetained.balance += netProfit;
          } else {
            existingRetained.balance -= Math.abs(netProfit);
            if (existingRetained.balance < 0) {
              existingRetained.balance = Math.abs(existingRetained.balance);
              existingRetained.balance_type = existingRetained.balance_type === 'debit' ? 'credit' : 'debit';
            }
          }
        } else {
          openingBalances.push({
            account_id: retainedEarnings.id,
            balance: Math.abs(netProfit),
            balance_type: netProfit >= 0 ? 'credit' : 'debit',
          });
        }
      }
    }

    // 4. Create financial year record
    const financialYearResult = await client.query(`
      INSERT INTO financial_years (
        business_id, year_name, start_date, end_date, is_closed
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING id
    `, [business_id, new_year_name, new_year_start_date, current_year_end_date]);

    const financialYearId = financialYearResult.rows[0].id;

    // 5. Create opening balance entries
    for (const ob of openingBalances) {
      await client.query(`
        INSERT INTO opening_balances (
          business_id, financial_year_id, account_id, balance_type, amount
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (financial_year_id, account_id) DO UPDATE
        SET balance_type = EXCLUDED.balance_type,
            amount = EXCLUDED.amount
      `, [business_id, financialYearId, ob.account_id, ob.balance_type, ob.balance]);

      // Update account opening balance
      await client.query(`
        UPDATE accounts
        SET opening_balance = $1,
            opening_balance_type = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [ob.balance, ob.balance_type, ob.account_id]);
    }

    // 6. Create closing journal entry (optional - for audit trail)
    if (transfer_pnl_to_retained_earnings && Math.abs(netProfit) > 0.01) {
      const retainedEarnings = await queryOne(`
        SELECT id FROM accounts 
        WHERE business_id = $1 
          AND (account_code = '3002' OR LOWER(account_name) LIKE '%retained%earnings%')
          AND is_active = true
        LIMIT 1
      `, [business_id]);

      if (retainedEarnings) {
        // Create journal entry to transfer P&L
        const journalEntryId = crypto.randomUUID();
        
        // Debit/Credit P&L accounts to zero them out
        // Credit/Debit Retained Earnings
        // This is a simplified version - a full implementation would create proper journal entries
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: 'Financial year closed successfully',
      financial_year_id: financialYearId,
      opening_balances_created: openingBalances.length,
      net_profit: netProfit,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error closing financial year:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

