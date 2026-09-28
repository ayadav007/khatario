import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';
import { signedStatementAmount } from '@/lib/bank/brs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-statements/reconcile
 * Auto-match bank statement transactions with ledger entries
 */
export const POST = withPremiumSubscriptionApi(
  { parseJsonBody: true },
  async ({ body, businessId }) => {
    const pool = getPool();
    const client = await pool.connect();

    try {
      const {
        bank_statement_id,
        bank_account_id,
      } = (body ?? {}) as Record<string, unknown>;

      if (!bank_statement_id || !bank_account_id) {
        return NextResponse.json(
          { error: 'bank_statement_id and bank_account_id are required' },
          { status: 400 }
        );
      }

      await client.query('BEGIN');

      const bankAccount = (
        await client.query(
          'SELECT ledger_account_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
          [bank_account_id, businessId]
        )
      ).rows[0];

      if (!bankAccount || !bankAccount.ledger_account_id) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Bank account not found or not linked to ledger account' },
          { status: 404 }
        );
      }

      const statementLines = (
        await client.query(
          `SELECT * FROM bank_statement_lines
            WHERE bank_statement_id = $1 AND business_id = $2
              AND is_matched = false AND COALESCE(match_status, 'unmatched') = 'unmatched'
            ORDER BY transaction_date, id`,
          [bank_statement_id, businessId]
        )
      ).rows;

      let matchedCount = 0;

      for (const line of statementLines) {
        // Statement credit (deposit) = Dr bank in books; statement debit (withdrawal) = Cr bank.
        const signedAmount = signedStatementAmount(line.debit_amount, line.credit_amount);
        if (signedAmount === 0) continue;

        const match = (
          await client.query(
            `SELECT lel.id
               FROM ledger_entry_lines lel
              WHERE lel.business_id = $1
                AND lel.account_id = $2
                AND ABS((lel.debit - lel.credit) - $3::numeric) < 0.01
                AND lel.entry_date BETWEEN $4::date - 7 AND $4::date + 7
                AND NOT EXISTS (
                  SELECT 1 FROM bank_statement_lines bsl
                   WHERE bsl.business_id = $1
                     AND (bsl.matched_ledger_entry_id = lel.id
                          OR bsl.matched_ledger_ids @> to_jsonb(ARRAY[lel.id::text]))
                )
              ORDER BY ABS(lel.entry_date - $4::date), lel.id
              LIMIT 1`,
            [businessId, bankAccount.ledger_account_id, signedAmount, line.transaction_date]
          )
        ).rows[0];

        if (match) {
          await client.query(
            `UPDATE bank_statement_lines
                SET is_matched = true,
                    match_status = 'matched',
                    matched_ledger_entry_id = $1,
                    matched_ledger_ids = to_jsonb(ARRAY[$1::text]),
                    match_type = 'exact',
                    matched_at = CURRENT_TIMESTAMP
              WHERE id = $2 AND business_id = $3`,
            [match.id, line.id, businessId]
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
  },
);
