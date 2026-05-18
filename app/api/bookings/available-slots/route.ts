import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { parseISO, getDay } from 'date-fns';

/**
 * GET /api/bookings/available-slots?date=2025-01-15
 * Returns available time slots for a given date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');

    if (!dateStr) {
      return NextResponse.json({ error: 'date parameter is required (YYYY-MM-DD)' }, { status: 400 });
    }

    const selectedDate = parseISO(dateStr);
    const dayOfWeek = getDay(selectedDate); // 0 = Sunday, 6 = Saturday

    // Get active time slots for this day of week
    const slots = await queryRows(`
      SELECT * FROM booking_time_slots 
      WHERE day_of_week = $1 AND is_active = true
      ORDER BY start_time ASC
    `, [dayOfWeek]);

    // Get existing bookings for this date to check availability
    const existingBookings = await queryRows(`
      SELECT time_slot_id, COUNT(*) as booked_count
      FROM demo_bookings
      WHERE scheduled_date = $1 AND status NOT IN ('cancelled')
      GROUP BY time_slot_id
    `, [dateStr]);

    const bookingCounts = new Map(existingBookings.map((b: any) => [b.time_slot_id, parseInt(b.booked_count)]));

    // Filter out slots that are fully booked
    const availableSlots = slots.filter((slot: any) => {
      const bookedCount = bookingCounts.get(slot.id) || 0;
      return bookedCount < (slot.max_bookings_per_slot || 1);
    });

    return NextResponse.json({ slots: availableSlots });
  } catch (error: any) {
    console.error('Error fetching available slots:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

