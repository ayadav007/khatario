import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';

/**
 * POST /api/bank-statements/reconcile
 * Auto-match bank statement transactions with ledger entries
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      bank_statement_id,
      bank_account_id,
    } = body;

    if (!business_id || !bank_statement_id || !bank_account_id) {
      return NextResponse.json(
        { error: 'business_id, bank_statement_id, and bank_account_id are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Get bank account's ledger account
    const bankAccount = await queryOne(
      'SELECT ledger_account_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [bank_account_id, business_id]
    );

    if (!bankAccount || !bankAccount.ledger_account_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Bank account not found or not linked to ledger account' },
        { status: 404 }
      );
    }

    // Get unmatched statement lines
    const statementLines = await queryRows(`
      SELECT * FROM bank_statement_lines
      WHERE bank_statement_id = $1 AND business_id = $2 AND is_matched = false
      ORDER BY transaction_date
    `, [bank_statement_id, business_id]);

    let matchedCount = 0;

    // Try to match each statement line with ledger entries
    for (const line of statementLines) {
      const amount = parseFloat(line.debit_amount || '0') > 0 
        ? parseFloat(line.debit_amount)
        : parseFloat(line.credit_amount || '0');

      // Try to find matching ledger entry by amount and date (within 7 days)
      const match = await queryOne(`
        SELECT lel.id, lel.voucher_id, lel.voucher_type
        FROM ledger_entry_lines lel
        WHERE lel.business_id = $1
          AND lel.account_id = $2
          AND ABS(lel.debit - lel.credit - $3) < 0.01
          AND lel.entry_date BETWEEN $4::date - INTERVAL '7 days' AND $4::date + INTERVAL '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM bank_statement_lines bsl 
            WHERE bsl.matched_ledger_entry_id = lel.id
          )
        ORDER BY ABS(EXTRACT(EPOCH FROM (lel.entry_date - $4::date)))
        LIMIT 1
      `, [business_id, bankAccount.ledger_account_id, amount, line.transaction_date]);

      if (match) {
        // Mark as matched
        await client.query(
          `UPDATE bank_statement_lines
           SET is_matched = true,
               matched_ledger_entry_id = $1,
               match_type = 'exact',
               matched_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [match.id, line.id]
        );
        matchedCount++;
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      total_lines: statementLines.length,
      matched_count: matchedCount,
      unmatched_count: statementLines.length - matchedCount,
      message: `Matched ${matchedCount} out of ${statementLines.length} transactions`,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error reconciling bank statement:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

