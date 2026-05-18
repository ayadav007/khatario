import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * GET /api/tds/transactions
 * List TDS transactions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const financialYear = searchParams.get('financial_year');
    const quarter = searchParams.get('quarter');
    const supplierId = searchParams.get('supplier_id');
    const isDeposited = searchParams.get('is_deposited');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        t.*,
        s.name as supplier_name,
        tc.section_name
      FROM tds_transactions t
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      LEFT JOIN tds_categories tc ON t.tds_category_id = tc.id
      WHERE t.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (financialYear) {
      sql += ` AND t.financial_year = $${paramIndex}`;
      params.push(financialYear);
      paramIndex++;
    }

    if (quarter) {
      sql += ` AND t.quarter = $${paramIndex}`;
      params.push(quarter);
      paramIndex++;
    }

    if (supplierId) {
      sql += ` AND t.supplier_id = $${paramIndex}`;
      params.push(supplierId);
      paramIndex++;
    }

    if (isDeposited !== null) {
      sql += ` AND t.is_deposited = $${paramIndex}`;
      params.push(isDeposited === 'true');
      paramIndex++;
    }

    sql += ` ORDER BY t.transaction_date DESC, t.created_at DESC`;

    const transactions = await queryRows(sql, params);

    return NextResponse.json({ transactions });
  } catch (error: any) {
    console.error('Error fetching TDS transactions:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

