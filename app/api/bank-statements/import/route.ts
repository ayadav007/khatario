import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-statements/import
 * Import bank statement (CSV/Excel)
 * Note: This is a simplified version. Full implementation would parse CSV/Excel files
 */
export const POST = withPremiumSubscriptionApi(
  { parseJsonBody: true },
  async ({ body, businessId }) => {
    const pool = getPool();
    const client = await pool.connect();

    try {
      const {
        bank_account_id,
        statement_period_start,
        statement_period_end,
        opening_balance,
        closing_balance,
        transactions, // Array of { transaction_date, value_date, description, cheque_number, debit_amount, credit_amount, balance, reference_number }
        imported_by,
      } = (body ?? {}) as Record<string, unknown>;

      if (!bank_account_id || !statement_period_start || !statement_period_end ||
          opening_balance === undefined || closing_balance === undefined || !transactions || !Array.isArray(transactions)) {
        return NextResponse.json(
          { error: 'bank_account_id, statement_period_start, statement_period_end, opening_balance, closing_balance, and transactions array are required' },
          { status: 400 }
        );
      }

      await client.query('BEGIN');

      // Create bank statement record
      const statement = await client.query(
        `INSERT INTO bank_statements (
        business_id, bank_account_id, statement_period_start, statement_period_end,
        opening_balance, closing_balance, imported_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
        [
          businessId,
          bank_account_id,
          statement_period_start,
          statement_period_end,
          opening_balance,
          closing_balance,
          imported_by || null,
        ]
      );

      const statementId = statement.rows[0].id;

      // Insert statement lines
      for (const transaction of transactions as Array<Record<string, unknown>>) {
        await client.query(
          `INSERT INTO bank_statement_lines (
          business_id, bank_statement_id, transaction_date, value_date,
          description, cheque_number, debit_amount, credit_amount, balance,
          reference_number
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            businessId,
            statementId,
            transaction.transaction_date,
            transaction.value_date || transaction.transaction_date,
            transaction.description,
            transaction.cheque_number || null,
            parseFloat(String(transaction.debit_amount || '0')),
            parseFloat(String(transaction.credit_amount || '0')),
            parseFloat(String(transaction.balance || '0')),
            transaction.reference_number || null,
          ]
        );
      }

      await client.query('COMMIT');

      return NextResponse.json({
        statement: statement.rows[0],
        message: 'Bank statement imported successfully',
      }, { status: 201 });
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error importing bank statement:', error);
      return NextResponse.json(
        { error: error.message || 'Internal server error' },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  },
);
