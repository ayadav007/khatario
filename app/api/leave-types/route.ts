import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { LeaveType } from '@/types/database';

/**
 * GET /api/leave-types
 * List all leave types for a business
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

    let sql = 'SELECT * FROM leave_types WHERE business_id = $1';
    const params: any[] = [businessId];

    if (activeOnly) {
      sql += ' AND is_active = true';
    }

    sql += ' ORDER BY leave_name ASC';

    const leaveTypes = await queryRows<LeaveType>(sql, params);

    return NextResponse.json({ leave_types: leaveTypes });
  } catch (error: any) {
    console.error('Error fetching leave types:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leave-types
 * Create a new leave type
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      leave_name,
      leave_code,
      max_days_per_year,
      carry_forward = false,
      max_carry_forward_days,
      requires_approval = true,
      is_paid = true,
      description,
    } = body;

    if (!business_id || !leave_name || !leave_code) {
      return NextResponse.json(
        { error: 'business_id, leave_name, and leave_code are required' },
        { status: 400 }
      );
    }

    // Check if leave_code already exists for this business
    const existing = await queryOne(
      'SELECT id FROM leave_types WHERE business_id = $1 AND leave_code = $2',
      [business_id, leave_code.toUpperCase()]
    );

    if (existing) {
      return NextResponse.json(
        { error: `Leave code "${leave_code}" already exists` },
        { status: 400 }
      );
    }

    const leaveType = await queryOne<LeaveType>(
      `INSERT INTO leave_types (
        business_id, leave_name, leave_code, max_days_per_year,
        carry_forward, max_carry_forward_days, requires_approval,
        is_paid, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        business_id,
        leave_name,
        leave_code.toUpperCase(),
        max_days_per_year || null,
        carry_forward,
        max_carry_forward_days || null,
        requires_approval,
        is_paid,
        description || null,
      ]
    );

    return NextResponse.json({ leave_type: leaveType }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating leave type:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

