import { NextRequest, NextResponse } from 'next/server';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import { queryRows, queryOne, query } from '@/lib/db';
import { Shift } from '@/types/database';

/**
 * GET /api/shifts
 * List all shifts for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const activeOnly = searchParams.get('active_only') === 'true';

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT * FROM shifts
      WHERE business_id = $1
    `;
    const params: any[] = [businessId];

    if (activeOnly) {
      sql += ` AND is_active = true`;
    }

    sql += ` ORDER BY start_time ASC`;

    const shifts = await queryRows<Shift>(sql, params);

    return NextResponse.json({ shifts });
  } catch (error: any) {
    console.error('Error fetching shifts:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/shifts
 * Create a new shift
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      shift_name,
      start_time,
      end_time,
      break_duration = 0,
    } = body;

    if (!business_id || !shift_name || !start_time || !end_time) {
      return NextResponse.json(
        { error: 'business_id, shift_name, start_time, and end_time are required' },
        { status: 400 }
      );
    }

    // Check if shift name already exists for this business
    const existing = await queryOne(
      'SELECT id FROM shifts WHERE business_id = $1 AND shift_name = $2',
      [business_id, shift_name]
    );

    if (existing) {
      return NextResponse.json(
        { error: `Shift "${shift_name}" already exists` },
        { status: 400 }
      );
    }

    const shiftLimit = await limitExceededResponse(business_id, 'shifts');
    if (shiftLimit) return shiftLimit;

    const shift = await queryOne<Shift>(
      `INSERT INTO shifts (business_id, shift_name, start_time, end_time, break_duration)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [business_id, shift_name, start_time, end_time, break_duration]
    );

    return NextResponse.json({ shift }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating shift:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

