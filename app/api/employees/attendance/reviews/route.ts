import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { ownerRoute } from '@/lib/hr/staff-app/owner-route';
import { resolvePunchReview } from '@/lib/hr/staff-app/punch';
import { punchPhotos, purgeExpiredFacePhotos } from '@/lib/hr/staff-app/face/store';

export const dynamic = 'force-dynamic';

/** GET /api/employees/attendance/reviews — Khatario Staff punches waiting for a manager. */
export const GET = ownerRoute('reviews list', 'attendance', 'read', async ({ businessId }) => {
  const reviews = await queryRows(
    `SELECT p.id, p.action, p.risk_score, p.reasons, p.distance_m, p.lat, p.lng, p.accuracy_m,
            p.wifi_matched, p.face_similarity, p.liveness_passed, p.created_at, s.name AS site_name, u.name AS employee_name, e.employee_code
     FROM staff_attendance_punches p
     JOIN employees e ON e.id = p.employee_id
     JOIN users u ON u.id = e.id
     LEFT JOIN attendance_sites s ON s.id = p.site_id
     WHERE p.business_id = $1 AND p.decision = 'review' AND p.review_decision IS NULL
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [businessId],
  );
  await purgeExpiredFacePhotos();
  const photos = await punchPhotos(businessId, reviews.map((r) => r.id as string));
  return NextResponse.json({ reviews: reviews.map((r) => ({ ...r, photos: photos[r.id] ?? [] })) });
});

/** POST /api/employees/attendance/reviews — { punch_id, decision: 'approved' | 'rejected' } */
export const POST = ownerRoute('reviews resolve', 'attendance', 'update', async ({ request, businessId, userId }) => {
  const body = (await request.json().catch(() => ({}))) as { punch_id?: unknown; decision?: unknown };
  const decision = body.decision;
  const punchId = typeof body.punch_id === 'string' ? body.punch_id : '';
  if ((decision !== 'approved' && decision !== 'rejected') || !/^[0-9a-f-]{36}$/i.test(punchId)) {
    return NextResponse.json({ error: 'punch_id and decision (approved or rejected) are required' }, { status: 400 });
  }
  const ok = await resolvePunchReview(businessId, userId, punchId, decision);
  if (!ok) return NextResponse.json({ error: 'This check-in was already reviewed or does not exist.' }, { status: 404 });
  return NextResponse.json({ success: true });
});
