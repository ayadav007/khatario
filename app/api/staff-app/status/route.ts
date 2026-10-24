import { NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';
import { staffRoute } from '@/lib/hr/staff-app/route';
import { sitesForEmployee } from '@/lib/hr/staff-app/sites';
import { phoneFaceStatus } from '@/lib/hr/staff-app/face/enrollment';

export const dynamic = 'force-dynamic';

/** GET /api/staff-app/status — signed. Who this phone belongs to, today, the last two weeks, and face setup. */
export const GET = staffRoute('status', async ({ device }) => {
  const today = attendanceDateYmd();
  const [todayRow, history, sites, pending, face] = await Promise.all([
    queryOne(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, check_in_time, check_out_time, status, is_late, late_minutes, total_hours
       FROM employee_attendance WHERE employee_id = $1 AND date = $2`,
      [device.employee_id, today],
    ),
    queryRows(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, check_in_time, check_out_time, status, is_late, total_hours
       FROM employee_attendance
       WHERE employee_id = $1 AND date >= ($2::date - INTERVAL '14 days')
       ORDER BY date DESC`,
      [device.employee_id, today],
    ),
    sitesForEmployee(device.business_id, device.employee_id),
    queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM staff_attendance_punches
       WHERE employee_id = $1 AND decision = 'review' AND review_decision IS NULL`,
      [device.employee_id],
    ),
    phoneFaceStatus(device),
  ]);
  return NextResponse.json({
    employee: { name: device.employee_name, code: device.employee_code },
    business: { name: device.business_name },
    today: todayRow ?? null,
    history,
    sites: sites.map((s) => ({ name: s.name, radius_m: s.radius_m, wifi_required: s.require_wifi })),
    pending_reviews: Number(pending?.n ?? 0),
    face,
    server_time: Date.now(),
  });
});
