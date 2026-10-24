import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { resolveAttendanceActor } from '@/lib/hr/attendance-actor';
import { AttendancePunchError, recordCheckOut } from '@/lib/hr/attendance-punch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/employees/attendance/check-out
 * Self-service for the employee themself, or a manual entry by a user with attendance permission
 * in the same business.
 */
export async function POST(request: NextRequest) {
  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const actor = await resolveAttendanceActor(request, body, 'update');
    if (actor instanceof NextResponse) return actor;

    const attendance = await recordCheckOut({
      employeeId: actor.employeeId,
      businessId: actor.businessId,
      method: actor.method,
      lat: typeof body.location_lat === 'number' ? body.location_lat : null,
      lng: typeof body.location_lng === 'number' ? body.location_lng : null,
      deviceInfo: typeof body.device_info === 'string' ? body.device_info.slice(0, 500) : null,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true, attendance, message: 'Checked out successfully' });
  } catch (error) {
    if (error instanceof AttendancePunchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error checking out:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
