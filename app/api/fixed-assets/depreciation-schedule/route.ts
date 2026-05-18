import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * GET /api/fixed-assets/depreciation-schedule
 * Get depreciation schedule
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const assetId = searchParams.get('asset_id');
    const financialYear = searchParams.get('financial_year');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        ds.*,
        fa.asset_code,
        fa.asset_name
      FROM depreciation_schedule ds
      LEFT JOIN fixed_assets fa ON ds.asset_id = fa.id
      WHERE ds.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (assetId) {
      sql += ` AND ds.asset_id = $${paramIndex}`;
      params.push(assetId);
      paramIndex++;
    }

    if (financialYear) {
      sql += ` AND ds.financial_year = $${paramIndex}`;
      params.push(financialYear);
      paramIndex++;
    }

    sql += ` ORDER BY ds.period_start_date DESC`;

    const schedule = await queryRows(sql, params);

    return NextResponse.json({ schedule });
  } catch (error: any) {
    console.error('Error fetching depreciation schedule:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

