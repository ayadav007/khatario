import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { calculateSLMDepreciation, calculateWDVDepreciation } from '@/lib/accounting/depreciation';

/**
 * POST /api/fixed-assets/[id]/depreciate
 * Calculate and record depreciation for an asset
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const assetId = params.id;
    const body = await request.json();
    const {
      business_id,
      financial_year,
      period_start_date,
      period_end_date,
      created_by,
    } = body;

    if (!business_id || !financial_year || !period_start_date || !period_end_date) {
      return NextResponse.json(
        { error: 'business_id, financial_year, period_start_date, and period_end_date are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Get asset details
    const asset = await queryOne(
      'SELECT * FROM fixed_assets WHERE id = $1 AND business_id = $2',
      [assetId, business_id]
    );

    if (!asset) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Asset not found' },
        { status: 404 }
      );
    }

    if (asset.is_disposed) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Cannot depreciate a disposed asset' },
        { status: 400 }
      );
    }

    // Check if depreciation already calculated for this period
    const existing = await queryOne(
      `SELECT id FROM depreciation_schedule 
       WHERE asset_id = $1 AND financial_year = $2 
         AND period_start_date = $3 AND period_end_date = $4`,
      [assetId, financial_year, period_start_date, period_end_date]
    );

    if (existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Depreciation already calculated for this period' },
        { status: 409 }
      );
    }

    // Calculate depreciation
    const openingBookValue = parseFloat(asset.current_book_value);
    let depreciationAmount: number;

    const periodStart = new Date(period_start_date);
    const periodEnd = new Date(period_end_date);
    const monthsDiff = (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 + 
                      (periodEnd.getMonth() - periodStart.getMonth());

    if (asset.depreciation_method === 'SLM') {
      depreciationAmount = calculateSLMDepreciation(
        parseFloat(asset.purchase_cost),
        parseFloat(asset.residual_value || '0'),
        asset.useful_life_years,
        monthsDiff
      );
    } else {
      depreciationAmount = calculateWDVDepreciation(
        openingBookValue,
        parseFloat(asset.depreciation_rate || '0'),
        monthsDiff
      );
    }

    // Ensure book value doesn't go below residual value
    const residualValue = parseFloat(asset.residual_value || '0');
    if (openingBookValue - depreciationAmount < residualValue) {
      depreciationAmount = openingBookValue - residualValue;
    }

    const closingBookValue = openingBookValue - depreciationAmount;

    // Create depreciation schedule entry
    const schedule = await client.query(
      `INSERT INTO depreciation_schedule (
        business_id, asset_id, financial_year, period_start_date, period_end_date,
        opening_book_value, depreciation_amount, closing_book_value
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        business_id,
        assetId,
        financial_year,
        period_start_date,
        period_end_date,
        openingBookValue,
        depreciationAmount,
        closingBookValue,
      ]
    );

    // Create journal entry for depreciation
    const voucherId = await client.query('SELECT uuid_generate_v4() as id');
    const voucherIdValue = voucherId.rows[0].id;

    // Debit Depreciation Expense, Credit Accumulated Depreciation
    await client.query(`
      INSERT INTO ledger_entry_lines (
        business_id, voucher_id, voucher_type, account_id, entry_date,
        debit, credit, narration, reference_number
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      business_id,
      voucherIdValue,
      'depreciation',
      asset.depreciation_account_id,
      period_end_date,
      depreciationAmount,
      0,
      `Depreciation: ${asset.asset_name} - ${financial_year}`,
      asset.asset_code,
    ]);

    // Update asset book value and accumulated depreciation
    await client.query(
      `UPDATE fixed_assets
       SET current_book_value = $1,
           accumulated_depreciation = accumulated_depreciation + $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [closingBookValue, depreciationAmount, assetId]
    );

    // Mark schedule as posted
    await client.query(
      `UPDATE depreciation_schedule
       SET is_posted = true, posted_date = $1, journal_entry_id = $2
       WHERE id = $3`,
      [period_end_date, voucherIdValue, schedule.rows[0].id]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      depreciation_schedule: schedule.rows[0],
      message: 'Depreciation calculated and posted successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error calculating depreciation:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

