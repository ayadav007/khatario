import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';

/**
 * GET /api/financial-years
 * List financial years
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const years = await queryRows(`
      SELECT * FROM financial_years
      WHERE business_id = $1
      ORDER BY start_date DESC
    `, [businessId]);

    return NextResponse.json({ years });
  } catch (error: any) {
    console.error('Error fetching financial years:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/financial-years
 * Create financial year
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      year_code,
      start_date,
      end_date,
      notes,
    } = body;

    if (!business_id || !year_code || !start_date || !end_date) {
      return NextResponse.json(
        { error: 'business_id, year_code, start_date, and end_date are required' },
        { status: 400 }
      );
    }

    // Check if year code already exists
    const existing = await queryOne(
      'SELECT id FROM financial_years WHERE business_id = $1 AND year_code = $2',
      [business_id, year_code]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Financial year with this code already exists' },
        { status: 409 }
      );
    }

    const year = await queryOne(
      `INSERT INTO financial_years (
        business_id, year_code, start_date, end_date, notes
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [business_id, year_code, start_date, end_date, notes || null]
    );

    return NextResponse.json({ year }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating financial year:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

