import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { resolveAttendanceActor } from '@/lib/hr/attendance-actor';
import { AttendancePunchError, recordCheckIn } from '@/lib/hr/attendance-punch';
import { validateSelfServiceLocation } from '@/lib/hr/staff-app/sites';

export const dynamic = 'force-dynamic';

/**
 * POST /api/employees/attendance/check-in
 * Self-service check-in (portal, kiosk, OTP session, or an employee for themself) always passes
 * the location rule. A user with attendance permission may record a manual check-in for someone
 * else in their business. Fraud-resistant phone check-in is /api/staff-app/punch.
 */
export async function POST(request: NextRequest) {
  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const actor = await resolveAttendanceActor(request, body, 'create');
    if (actor instanceof NextResponse) return actor;

    const lat = typeof body.location_lat === 'number' ? body.location_lat : null;
    const lng = typeof body.location_lng === 'number' ? body.location_lng : null;

    if (actor.selfService) {
      const geo = await validateSelfServiceLocation(actor.businessId, actor.employeeId, lat, lng);
      if (!geo.ok) return NextResponse.json({ error: geo.error }, { status: 400 });
    }

    const attendance = await recordCheckIn({
      employeeId: actor.employeeId,
      businessId: actor.businessId,
      method: actor.method,
      lat,
      lng,
      deviceInfo: typeof body.device_info === 'string' ? body.device_info.slice(0, 500) : null,
      ipAddress: getClientIp(request),
      shiftId: !actor.selfService && typeof body.shift_id === 'string' ? body.shift_id : null,
    });

    return NextResponse.json({ success: true, attendance, message: 'Checked in successfully' });
  } catch (error) {
    if (error instanceof AttendancePunchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error checking in:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
