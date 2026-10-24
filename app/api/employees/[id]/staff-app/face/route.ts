import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { ownerRoute } from '@/lib/hr/staff-app/owner-route';
import {
  cancelEnrollment,
  decideEnrollment,
  faceStatus,
  FaceEnrollmentError,
  openEnrollment,
} from '@/lib/hr/staff-app/face/enrollment';
import { deleteFaceData, purgeExpiredFacePhotos } from '@/lib/hr/staff-app/face/store';

export const dynamic = 'force-dynamic';

type Params = { id: string };

async function employeeInBusiness(employeeId: string, businessId: string): Promise<boolean> {
  const row = await queryOne('SELECT 1 FROM employees WHERE id = $1 AND business_id = $2', [employeeId, businessId]);
  return !!row;
}

const notFound = () => NextResponse.json({ error: 'Employee not found' }, { status: 404 });

/** GET — the approved face (if any) and an enrollment in progress, with its photos once taken. */
export const GET = ownerRoute<Params>('face get', 'attendance', 'read', async ({ businessId, params }) => {
  if (!(await employeeInBusiness(params.id, businessId))) return notFound();
  await purgeExpiredFacePhotos();
  return NextResponse.json(await faceStatus(businessId, params.id));
});

/**
 * POST — { action: 'open' } starts face setup on the employee's phone (replacing an unfinished one);
 * { action: 'cancel' }; { action: 'approve' | 'reject', enrollment_id } after the photos are in.
 */
export const POST = ownerRoute<Params>('face enroll', 'attendance', 'update', async ({ request, businessId, userId, params }) => {
  const employee = await queryOne<{ active: boolean }>(
    `SELECT (e.is_active AND u.is_active) AS active FROM employees e JOIN users u ON u.id = e.id
     WHERE e.id = $1 AND e.business_id = $2`,
    [params.id, businessId],
  );
  if (!employee) return notFound();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; enrollment_id?: unknown };
  try {
    switch (body.action) {
      case 'open':
        if (!employee.active) return NextResponse.json({ error: 'This employee is inactive.' }, { status: 400 });
        await openEnrollment(businessId, params.id, userId);
        break;
      case 'cancel':
        await cancelEnrollment(businessId, params.id, userId);
        break;
      case 'approve':
      case 'reject': {
        const id = typeof body.enrollment_id === 'string' ? body.enrollment_id : '';
        if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'enrollment_id is required' }, { status: 400 });
        if (body.action === 'approve' && !employee.active) {
          return NextResponse.json({ error: 'This employee is inactive.' }, { status: 400 });
        }
        const ok = await decideEnrollment(businessId, params.id, userId, id, body.action === 'approve');
        if (!ok) return NextResponse.json({ error: 'These photos were already decided or have expired.' }, { status: 404 });
        break;
      }
      default:
        return NextResponse.json({ error: 'action must be open, cancel, approve or reject' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof FaceEnrollmentError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  return NextResponse.json(await faceStatus(businessId, params.id));
});

/** DELETE — removes the employee's face templates and photos (they left, or withdrew consent). */
export const DELETE = ownerRoute<Params>('face delete', 'attendance', 'update', async ({ businessId, userId, params }) => {
  if (!(await employeeInBusiness(params.id, businessId))) return notFound();
  await deleteFaceData(businessId, params.id, userId);
  return NextResponse.json({ success: true });
});
