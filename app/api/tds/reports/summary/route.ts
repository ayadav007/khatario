import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/tds/reports/summary
 * Get TDS summary report
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
      SELECT 
        financial_year,
        quarter,
        COUNT(*) as transaction_count,
        SUM(tds_amount) as total_tds_amount,
        SUM(CASE WHEN is_deposited THEN tds_amount ELSE 0 END) as deposited_amount,
        SUM(CASE WHEN NOT is_deposited THEN tds_amount ELSE 0 END) as pending_amount
      FROM tds_transactions
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

    sql += ` GROUP BY financial_year, quarter
             ORDER BY financial_year DESC, quarter DESC`;

    const summary = await queryOne(sql, params);

    // Get section-wise breakdown
    const sectionBreakdown = await queryOne(`
      SELECT 
        t.section_code,
        tc.section_name,
        COUNT(*) as count,
        SUM(t.tds_amount) as total_amount
      FROM tds_transactions t
      LEFT JOIN tds_categories tc ON t.tds_category_id = tc.id
      WHERE t.business_id = $1
        ${financialYear ? `AND t.financial_year = $2` : ''}
        ${quarter ? `AND t.quarter = $3` : ''}
      GROUP BY t.section_code, tc.section_name
      ORDER BY total_amount DESC
    `, financialYear && quarter 
      ? [businessId, financialYear, quarter]
      : financialYear 
        ? [businessId, financialYear]
        : [businessId]);

    return NextResponse.json({
      summary: summary || [],
      section_breakdown: sectionBreakdown || [],
    });
  } catch (error: any) {
    console.error('Error generating TDS summary:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

