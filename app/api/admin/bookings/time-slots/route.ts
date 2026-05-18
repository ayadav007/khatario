import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/bookings/time-slots
 * List all time slots (Admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const slots = await queryRows(`
      SELECT * FROM booking_time_slots 
      ORDER BY day_of_week ASC, start_time ASC
    `);

    return NextResponse.json({ slots });
  } catch (error: any) {
    console.error('Error fetching time slots:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/bookings/time-slots
 * Create new time slot (Admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { admin_id: _ignored, ...data } = body;

    const { day_of_week, start_time, end_time, is_active, max_bookings_per_slot } = data;

    if (day_of_week === undefined || !start_time || !end_time) {
      return NextResponse.json({ error: 'day_of_week, start_time, and end_time are required' }, { status: 400 });
    }

    const slot = await queryOne(
      `INSERT INTO booking_time_slots (day_of_week, start_time, end_time, is_active, max_bookings_per_slot)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        day_of_week,
        start_time,
        end_time,
        is_active !== false,
        max_bookings_per_slot || 1
      ]
    );

    return NextResponse.json({ slot }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating time slot:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

