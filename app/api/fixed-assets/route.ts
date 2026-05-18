import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { generateDepreciationSchedule } from '@/lib/accounting/depreciation';

/**
 * GET /api/fixed-assets
 * List fixed assets
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const isDisposed = searchParams.get('is_disposed');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        fa.*,
        a.account_code as asset_account_code,
        a.account_name as asset_account_name,
        da.account_code as depreciation_account_code,
        da.account_name as depreciation_account_name
      FROM fixed_assets fa
      LEFT JOIN accounts a ON fa.account_id = a.id
      LEFT JOIN accounts da ON fa.depreciation_account_id = da.id
      WHERE fa.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (isDisposed !== null) {
      sql += ` AND fa.is_disposed = $${paramIndex}`;
      params.push(isDisposed === 'true');
      paramIndex++;
    }

    sql += ` ORDER BY fa.purchase_date DESC`;

    const assets = await queryRows(sql, params);

    return NextResponse.json({ assets });
  } catch (error: any) {
    console.error('Error fetching fixed assets:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/fixed-assets
 * Add fixed asset
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      asset_code,
      asset_name,
      asset_category,
      purchase_date,
      purchase_cost,
      account_id,
      depreciation_account_id,
      depreciation_method,
      useful_life_years,
      depreciation_rate,
      residual_value = 0,
      location,
      vendor_name,
      invoice_number,
      warranty_expiry_date,
      notes,
    } = body;

    if (!business_id || !asset_code || !asset_name || !purchase_date || !purchase_cost || 
        !account_id || !depreciation_account_id || !depreciation_method || !useful_life_years) {
      return NextResponse.json(
        { error: 'Required fields: business_id, asset_code, asset_name, purchase_date, purchase_cost, account_id, depreciation_account_id, depreciation_method, useful_life_years' },
        { status: 400 }
      );
    }

    if (depreciation_method === 'WDV' && !depreciation_rate) {
      return NextResponse.json(
        { error: 'depreciation_rate is required for WDV method' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Check if asset code already exists
    const existing = await queryOne(
      'SELECT id FROM fixed_assets WHERE business_id = $1 AND asset_code = $2',
      [business_id, asset_code]
    );

    if (existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Asset code already exists' },
        { status: 409 }
      );
    }

    const asset = await client.query(
      `INSERT INTO fixed_assets (
        business_id, asset_code, asset_name, asset_category, purchase_date,
        purchase_cost, account_id, depreciation_account_id, depreciation_method,
        useful_life_years, depreciation_rate, residual_value, current_book_value,
        location, vendor_name, invoice_number, warranty_expiry_date, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        business_id,
        asset_code,
        asset_name,
        asset_category || null,
        purchase_date,
        purchase_cost,
        account_id,
        depreciation_account_id,
        depreciation_method,
        useful_life_years,
        depreciation_rate || null,
        residual_value,
        purchase_cost, // Initial book value = purchase cost
        location || null,
        vendor_name || null,
        invoice_number || null,
        warranty_expiry_date || null,
        notes || null,
      ]
    );

    // Create journal entry for asset purchase
    const voucherId = await client.query('SELECT uuid_generate_v4() as id');
    const voucherIdValue = voucherId.rows[0].id;

    await client.query(`
      INSERT INTO ledger_entry_lines (
        business_id, voucher_id, voucher_type, account_id, entry_date,
        debit, credit, narration, reference_number
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      business_id,
      voucherIdValue,
      'asset_purchase',
      account_id,
      purchase_date,
      purchase_cost,
      0,
      `Fixed asset purchase: ${asset_name}`,
      asset_code,
    ]);

    await client.query('COMMIT');

    return NextResponse.json({
      asset: asset.rows[0],
      message: 'Fixed asset added successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error adding fixed asset:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

