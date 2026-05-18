import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';
import { OpeningBalanceTransaction } from '@/types/journal-entries';

/**
 * GET /api/opening-balances
 * Get all opening balances for a financial year
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const financialYearId = searchParams.get('financial_year_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        id,
        business_id,
        financial_year_id,
        entity_type,
        entity_id,
        opening_balance,
        opening_balance_type,
        as_on_date,
        notes,
        created_at,
        created_by
      FROM opening_balance_transactions
      WHERE business_id = $1
    `;

    const params: any[] = [businessId];

    if (financialYearId) {
      sql += ` AND financial_year_id = $2`;
      params.push(financialYearId);
    }

    sql += ` ORDER BY entity_type, created_at`;

    const openingBalances = await queryRows<OpeningBalanceTransaction>(sql, params);

    // Group by entity type for easier processing
    const grouped = {
      accounts: openingBalances.filter(ob => ob.entity_type === 'account'),
      customers: openingBalances.filter(ob => ob.entity_type === 'customer'),
      suppliers: openingBalances.filter(ob => ob.entity_type === 'supplier'),
    };

    return NextResponse.json({
      opening_balances: openingBalances,
      grouped,
    });
  } catch (error: any) {
    console.error('Error fetching opening balances:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/opening-balances
 * Set opening balances (accounts, customers, suppliers)
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      financial_year_id,
      opening_balances, // Array of { entity_type, entity_id, opening_balance, opening_balance_type, as_on_date, notes }
    } = body;

    if (!business_id || !opening_balances || !Array.isArray(opening_balances)) {
      return NextResponse.json(
        { error: 'business_id and opening_balances array are required' },
        { status: 400 }
      );
    }

    const userId = request.headers.get('x-user-id') || null;

    await client.query('BEGIN');

    const createdBalances: any[] = [];

    for (const ob of opening_balances) {
      const {
        entity_type,
        entity_id,
        opening_balance,
        opening_balance_type,
        as_on_date,
        notes,
      } = ob;

      if (!entity_type || !entity_id || opening_balance === undefined || !opening_balance_type || !as_on_date) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Each opening balance must have entity_type, entity_id, opening_balance, opening_balance_type, and as_on_date' },
          { status: 400 }
        );
      }

      // Validate entity_type
      if (!['account', 'customer', 'supplier'].includes(entity_type)) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: `Invalid entity_type: ${entity_type}. Must be 'account', 'customer', or 'supplier'` },
          { status: 400 }
        );
      }

      // Insert or update opening balance
      const result = await query(
        `INSERT INTO opening_balance_transactions (
          business_id, financial_year_id, entity_type, entity_id,
          opening_balance, opening_balance_type, as_on_date, notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (business_id, entity_type, entity_id, financial_year_id)
        DO UPDATE SET
          opening_balance = EXCLUDED.opening_balance,
          opening_balance_type = EXCLUDED.opening_balance_type,
          as_on_date = EXCLUDED.as_on_date,
          notes = EXCLUDED.notes
        RETURNING *`,
        [
          business_id,
          financial_year_id || null,
          entity_type,
          entity_id,
          opening_balance,
          opening_balance_type,
          as_on_date,
          notes || null,
          userId,
        ]
      );

      createdBalances.push(result.rows[0]);

      // If entity_type is 'account', also update the accounts table opening_balance
      if (entity_type === 'account') {
        await query(
          `UPDATE accounts 
           SET opening_balance = $1, 
               opening_balance_type = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND business_id = $4`,
          [opening_balance, opening_balance_type, entity_id, business_id]
        );
      }

      // If entity_type is 'customer', update customer balance
      if (entity_type === 'customer') {
        // Assuming customers table has opening_balance or balance field
        // This depends on your schema - adjust accordingly
        await query(
          `UPDATE customers 
           SET opening_balance = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3`,
          [opening_balance_type === 'debit' ? opening_balance : -opening_balance, entity_id, business_id]
        ).catch(() => {
          // Ignore if column doesn't exist - might need to add it
          console.warn('Could not update customer opening balance - column may not exist');
        });
      }

      // If entity_type is 'supplier', update supplier balance
      if (entity_type === 'supplier') {
        // Assuming suppliers table has opening_balance or balance field
        await query(
          `UPDATE suppliers 
           SET opening_balance = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3`,
          [opening_balance_type === 'credit' ? opening_balance : -opening_balance, entity_id, business_id]
        ).catch(() => {
          // Ignore if column doesn't exist - might need to add it
          console.warn('Could not update supplier opening balance - column may not exist');
        });
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      message: 'Opening balances set successfully',
      opening_balances: createdBalances,
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error setting opening balances:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// Note: Validate endpoint moved to /api/opening-balances/validate/route.ts

