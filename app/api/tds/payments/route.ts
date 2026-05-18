import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { TDSPayment } from '@/types/database';

/**
 * GET /api/tds/payments
 * List TDS payments
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const financialYear = searchParams.get('financial_year');
    const quarter = searchParams.get('quarter');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT * FROM tds_payments
      WHERE business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (financialYear) {
      sql += ` AND financial_year = $${paramIndex}`;
      params.push(financialYear);
      paramIndex++;
    }

    if (quarter) {
      sql += ` AND quarter = $${paramIndex}`;
      params.push(quarter);
      paramIndex++;
    }

    sql += ` ORDER BY deposit_date DESC, created_at DESC`;

    const payments = await queryRows<TDSPayment>(sql, params);

    return NextResponse.json({ payments });
  } catch (error: any) {
    console.error('Error fetching TDS payments:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tds/payments
 * Record TDS payment to government
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      financial_year,
      quarter,
      challan_number,
      challan_date,
      deposit_date,
      total_tds_amount,
      bank_name,
      payment_mode,
      payment_reference,
      notes,
      created_by,
    } = body;

    if (!business_id || !financial_year || !quarter || !challan_number || !challan_date || !deposit_date || !total_tds_amount) {
      return NextResponse.json(
        { error: 'business_id, financial_year, quarter, challan_number, challan_date, deposit_date, and total_tds_amount are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Check if challan number already exists
    const existing = await queryOne(
      'SELECT id FROM tds_payments WHERE business_id = $1 AND challan_number = $2',
      [business_id, challan_number]
    );

    if (existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Challan number already exists' },
        { status: 409 }
      );
    }

    const payment = await client.query<TDSPayment>(
      `INSERT INTO tds_payments (
        business_id, financial_year, quarter, challan_number, challan_date,
        deposit_date, total_tds_amount, bank_name, payment_mode, payment_reference,
        status, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        business_id,
        financial_year,
        quarter,
        challan_number,
        challan_date,
        deposit_date,
        total_tds_amount,
        bank_name || null,
        payment_mode || null,
        payment_reference || null,
        'deposited',
        notes || null,
        created_by || null,
      ]
    );

    // Update TDS transactions as deposited
    await client.query(
      `UPDATE tds_transactions
       SET is_deposited = true, deposited_date = $1, challan_number = $2, challan_date = $3
       WHERE business_id = $4 
         AND financial_year = $5 
         AND quarter = $6
         AND is_deposited = false`,
      [deposit_date, challan_number, challan_date, business_id, financial_year, quarter]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      payment: payment.rows[0],
      message: 'TDS payment recorded successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error recording TDS payment:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

