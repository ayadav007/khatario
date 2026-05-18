import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, queryRows } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/bookings/[id]
 * Get single booking with activities (Admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const id = params.id;

    const booking = await queryOne(`
      SELECT b.*,
        pa.name as assigned_admin_name,
        pa.email as assigned_admin_email,
        pa.phone as assigned_admin_phone
      FROM demo_bookings b
      LEFT JOIN platform_admins pa ON b.assigned_admin_id = pa.id
      WHERE b.id = $1
    `, [id]);

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Get all activities for this booking
    const activities = await queryRows(`
      SELECT a.*,
        pa.name as performed_by_name,
        pa.email as performed_by_email
      FROM booking_activities a
      LEFT JOIN platform_admins pa ON a.performed_by = pa.id
      WHERE a.booking_id = $1
      ORDER BY a.created_at DESC
    `, [id]);

    return NextResponse.json({
      booking,
      activities
    });
  } catch (error: any) {
    console.error('Error fetching booking:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/bookings/[id]
 * Update booking (Admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { admin_id: _ignored, ...updates } = body;
    const id = params.id;

    const admin = auth.admin;

    const allowedFields = [
      'status', 'assigned_admin_id', 'lead_source', 'demo_type', 
      'outcome', 'internal_notes', 'next_follow_up_date',
      'scheduled_date', 'scheduled_time', 'time_slot_id'
    ];

    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    let statusChanged = false;
    let oldStatus = '';

    // Get old status if status is being changed
    if (updates.status) {
      const oldBooking = await queryOne('SELECT status FROM demo_bookings WHERE id = $1', [id]);
      oldStatus = oldBooking?.status || '';
      if (oldStatus !== updates.status) {
        statusChanged = true;
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${i++}`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
    }

    values.push(id);
    const booking = await queryOne(
      `UPDATE demo_bookings 
       SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${i}
       RETURNING *`,
      values
    );

    // Create activity if status changed
    if (statusChanged) {
      await query(
        `INSERT INTO booking_activities (booking_id, activity_type, title, description, performed_by)
         VALUES ($1, 'status_change', 'Status Changed', $2, $3)`,
        [id, `Status changed from ${oldStatus} to ${updates.status}`, admin.id]
      );
    }

    return NextResponse.json({ booking });
  } catch (error: any) {
    console.error('Error updating booking:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

