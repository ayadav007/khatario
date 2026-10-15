/** Session + permission check for the owner-side Khatario Staff setup routes. */
import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { isEmployeePortalSession } from '@/lib/employee-portal/portal-api-guard';
import { STAFF_ATTENDANCE_FEATURE } from '@/lib/hr/staff-app/route';
import { SiteInputError } from '@/lib/hr/staff-app/sites';

type Action = 'read' | 'create' | 'update' | 'delete';

export type OwnerContext = { userId: string; businessId: string };

/**
 * Business and user come only from the verified session headers. Employee portal sessions
 * never reach these routes.
 */
export function ownerRoute<P = Record<string, string>>(
  label: string,
  moduleKey: 'attendance' | 'settings',
  action: Action,
  handler: (ctx: OwnerContext & { request: NextRequest; params: P }) => Promise<NextResponse>,
) {
  return async (request: NextRequest, route?: { params: P }): Promise<NextResponse> => {
    try {
      const userId = request.headers.get('x-authenticated-user-id');
      const businessId = request.headers.get('x-authenticated-business-id');
      if (!userId || !businessId || isEmployeePortalSession(request)) {
        return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
      }
      await authorize(userId, moduleKey, action, { businessId });
      await assertFeatureAccess(businessId, STAFF_ATTENDANCE_FEATURE);
      return await handler({ request, userId, businessId, params: (route?.params ?? {}) as P });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      if (error instanceof SiteInputError) return NextResponse.json({ error: error.message }, { status: 400 });
      console.error(`[staff-app owner ${label}]`, error);
      return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}
