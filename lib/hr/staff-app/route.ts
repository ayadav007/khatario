/** Wrapper for Khatario Staff API routes: signature check, plan gate, error replies. */
import { NextRequest, NextResponse } from 'next/server';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authenticateStaffRequest, StaffAuthError, type StaffDevice } from '@/lib/hr/staff-app/device-auth';

/** Plan switch for the Khatario Staff app (HR Starter and up). Manual attendance alone is `hr_attendance`. */
export const STAFF_ATTENDANCE_FEATURE = 'hr_staff_app';

export function staffRoute(
  label: string,
  handler: (ctx: { request: NextRequest; device: StaffDevice; body: unknown }) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const raw = request.method === 'GET' ? '' : await request.text();
      const device = await authenticateStaffRequest(request, raw);
      await assertFeatureAccess(device.business_id, STAFF_ATTENDANCE_FEATURE);
      let body: unknown = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
        }
      }
      return await handler({ request, device, body });
    } catch (error) {
      if (error instanceof StaffAuthError) return error.toNextResponse();
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      console.error(`[staff-app ${label}]`, error);
      return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}
