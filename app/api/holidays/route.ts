import { NextRequest, NextResponse } from 'next/server';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import { queryRows, queryOne, query } from '@/lib/db';
import { Holiday } from '@/types/database';

/**
 * GET /api/holidays
 * List holidays for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const year = searchParams.get('year');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = 'SELECT * FROM holidays WHERE business_id = $1';
    const params: any[] = [businessId];

    if (year) {
      sql += ` AND EXTRACT(YEAR FROM holiday_date) = $2`;
      params.push(parseInt(year));
    }

    sql += ' ORDER BY holiday_date ASC';

    const holidays = await queryRows<Holiday>(sql, params);

    return NextResponse.json({ holidays });
  } catch (error: any) {
    console.error('Error fetching holidays:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/holidays
 * Create a new holiday
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, holiday_date, holiday_name, is_recurring = false, description } = body;

    if (!business_id || !holiday_date || !holiday_name) {
      return NextResponse.json(
        { error: 'business_id, holiday_date, and holiday_name are required' },
        { status: 400 }
      );
    }

    const holidayLimit = await limitExceededResponse(business_id, 'holidays');
    if (holidayLimit) return holidayLimit;

    const holiday = await queryOne<Holiday>(
      `INSERT INTO holidays (business_id, holiday_date, holiday_name, is_recurring, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [business_id, holiday_date, holiday_name, is_recurring, description || null]
    );

    return NextResponse.json({ holiday }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating holiday:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

