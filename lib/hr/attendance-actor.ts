/**
 * Who is punching on the older check-in / check-out routes, and on whose behalf.
 * Self-service (portal, kiosk, OTP session, or an employee punching themself) must pass the
 * location rule whatever `method` the client sends; only a user with attendance permission
 * may record a manual entry for someone else, and only inside their own business.
 */
import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertPortalFeatureForRequest } from '@/lib/employee-portal/portal-api-guard';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { getEmployeePortalSessionFromRequest } from '@/lib/employee-portal/session';
import { EMPLOYEE_PORTAL_SESSION_HEADER } from '@/lib/employee-portal/ess-api-allowlist';

export type AttendanceActor = {
  employeeId: string;
  businessId: string;
  defaultShiftId: string | null;
  selfService: boolean;
  /** Stored as check_in_method / check_out_method. */
  method: string;
};

const MANAGER_METHODS = new Set(['manual', 'kiosk']);

export async function resolveAttendanceActor(
  request: NextRequest,
  body: Record<string, unknown>,
  action: 'create' | 'update',
): Promise<AttendanceActor | NextResponse> {
  const portalHeader = request.headers.get(EMPLOYEE_PORTAL_SESSION_HEADER) === '1';
  const portalSession = portalHeader ? await getEmployeePortalSessionFromRequest(request) : null;
  const sessionToken = typeof body.session_token === 'string' ? body.session_token : null;

  let employeeId: string | null = null;
  let selfService = true;
  let method = 'mobile_app';
  let sessionBusinessId: string | null = null;
  let actorUserId: string | null = null;

  if (portalSession) {
    try {
      await assertPortalFeatureForRequest(request, portalSession.business_id, 'attendance');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }
    employeeId = portalSession.employee_id;
    sessionBusinessId = portalSession.business_id;
    method = body.method === 'kiosk' ? 'kiosk' : 'mobile_app';
  } else if (sessionToken) {
    const session = await queryOne<{ employee_id: string }>(
      `SELECT employee_id FROM attendance_sessions
       WHERE session_token = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [sessionToken],
    );
    if (!session) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    employeeId = session.employee_id;
    method = 'otp';
  } else {
    actorUserId = request.headers.get('x-authenticated-user-id');
    sessionBusinessId = request.headers.get('x-authenticated-business-id');
    if (!actorUserId || !sessionBusinessId) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    employeeId = typeof body.employee_id === 'string' && body.employee_id ? body.employee_id : actorUserId;
    if (employeeId !== actorUserId) {
      selfService = false;
      method = typeof body.method === 'string' && MANAGER_METHODS.has(body.method) ? body.method : 'manual';
    }
  }

  const employee = await queryOne<{ business_id: string; default_shift_id: string | null }>(
    'SELECT business_id, default_shift_id FROM employees WHERE id = $1',
    [employeeId],
  );
  if (!employee || (sessionBusinessId && employee.business_id !== sessionBusinessId)) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  if (!selfService) {
    try {
      await authorize(actorUserId!, 'attendance', action, { businessId: employee.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
  }

  return {
    employeeId: employeeId!,
    businessId: employee.business_id,
    defaultShiftId: employee.default_shift_id,
    selfService,
    method,
  };
}
