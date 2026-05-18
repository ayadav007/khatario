import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * PATCH /api/admin/bookings/time-slots/[id]
 * Update time slot (Admin only)
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

    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (['day_of_week', 'start_time', 'end_time', 'is_active', 'max_bookings_per_slot'].includes(key)) {
        setClauses.push(`${key} = $${i++}`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
    }

    values.push(id);
    const slot = await queryOne(
      `UPDATE booking_time_slots 
       SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${i}
       RETURNING *`,
      values
    );

    return NextResponse.json({ slot });
  } catch (error: any) {
    console.error('Error updating time slot:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/bookings/time-slots/[id]
 * Delete time slot (Admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const id = params.id;

    await query('DELETE FROM booking_time_slots WHERE id = $1', [id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting time slot:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

