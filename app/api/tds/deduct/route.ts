import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { TDSTransaction } from '@/types/database';

/**
 * POST /api/tds/deduct
 * Record TDS deduction on payment
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      supplier_id,
      payment_id,
      tds_category_id,
      payment_amount,
      transaction_date,
      notes,
      created_by,
    } = body;

    if (!business_id || !tds_category_id || !payment_amount || !transaction_date) {
      return NextResponse.json(
        { error: 'business_id, tds_category_id, payment_amount, and transaction_date are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Get TDS category details
    const category = await queryOne(
      'SELECT section_code, rate, threshold_amount FROM tds_categories WHERE id = $1 AND business_id = $2',
      [tds_category_id, business_id]
    );

    if (!category) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TDS category not found' },
        { status: 404 }
      );
    }

    // Check threshold
    if (parseFloat(payment_amount) < parseFloat(category.threshold_amount || '0')) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Payment amount is below TDS threshold of ₹${category.threshold_amount}` },
        { status: 400 }
      );
    }

    // Calculate TDS
    const tdsRate = parseFloat(category.rate);
    const paymentAmt = parseFloat(payment_amount);
    const tdsAmount = (paymentAmt * tdsRate) / 100;
    const netPaymentAmount = paymentAmt - tdsAmount;

    // Determine financial year and quarter
    const transDate = new Date(transaction_date);
    const year = transDate.getFullYear();
    const month = transDate.getMonth() + 1;
    
    let financialYear: string;
    let quarter: string;
    
    if (month >= 4) {
      financialYear = `${year}-${year + 1}`;
    } else {
      financialYear = `${year - 1}-${year}`;
    }
    
    if (month >= 4 && month <= 6) quarter = 'Q1';
    else if (month >= 7 && month <= 9) quarter = 'Q2';
    else if (month >= 10 && month <= 12) quarter = 'Q3';
    else quarter = 'Q4';

    // Create TDS transaction
    const tdsTransaction = await client.query(
      `INSERT INTO tds_transactions (
        business_id, supplier_id, payment_id, tds_category_id, section_code,
        payment_amount, tds_rate, tds_amount, net_payment_amount,
        transaction_date, financial_year, quarter, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        business_id,
        supplier_id || null,
        payment_id || null,
        tds_category_id,
        category.section_code,
        paymentAmt,
        tdsRate,
        tdsAmount,
        netPaymentAmount,
        transaction_date,
        financialYear,
        quarter,
        notes || null,
        created_by || null,
      ]
    );

    // Create ledger entry for TDS Payable
    const tdsPayableAccount = await queryOne(
      `SELECT id FROM accounts 
       WHERE business_id = $1 AND account_code = '2102' 
       LIMIT 1`,
      [business_id]
    );

    if (tdsPayableAccount) {
      await client.query(`
        INSERT INTO ledger_entry_lines (
          business_id, voucher_id, voucher_type, account_id, entry_date,
          debit, credit, narration, reference_number
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        business_id,
        tdsTransaction.rows[0].id,
        'tds',
        tdsPayableAccount.id,
        transaction_date,
        0,
        tdsAmount,
        `TDS deducted - Section ${category.section_code}`,
        `TDS-${tdsTransaction.rows[0].id}`,
      ]);
    }

    await client.query('COMMIT');

    return NextResponse.json({
      tds_transaction: tdsTransaction.rows[0],
      message: 'TDS deducted successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error deducting TDS:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

