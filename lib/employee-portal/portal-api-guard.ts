import { NextRequest, NextResponse } from 'next/server';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import {
  assertEmployeePortalFeature,
  type EssModule,
} from '@/lib/employee-portal/feature-gates';
import {
  getEmployeePortalSessionFromRequest,
  type EmployeePortalSession,
} from '@/lib/employee-portal/session';
import { EMPLOYEE_PORTAL_SESSION_HEADER } from '@/lib/employee-portal/ess-api-allowlist';
import { isEssApiAllowed } from '@/lib/employee-portal/ess-api-allowlist';

export type ActorContext = {
  userId: string;
  businessId: string;
  isPortal: boolean;
  portalSession?: EmployeePortalSession;
};

export function isEmployeePortalSession(request: NextRequest): boolean {
  return request.headers.get(EMPLOYEE_PORTAL_SESSION_HEADER) === '1';
}

/** Resolve JWT headers (middleware) or employee portal cookie session. */
export async function resolveActorContext(
  request: NextRequest,
  body?: Record<string, unknown> | null
): Promise<ActorContext | null> {
  const headerUser = request.headers.get('x-authenticated-user-id');
  const headerBusiness = request.headers.get('x-authenticated-business-id');
  if (headerUser && headerBusiness && !isEmployeePortalSession(request)) {
    return { userId: headerUser, businessId: headerBusiness, isPortal: false };
  }

  const portal = await getEmployeePortalSessionFromRequest(request);
  if (portal) {
    return {
      userId: portal.employee_id,
      businessId: portal.business_id,
      isPortal: true,
      portalSession: portal,
    };
  }

  if (headerUser && headerBusiness) {
    return {
      userId: headerUser,
      businessId: headerBusiness,
      isPortal: isEmployeePortalSession(request),
    };
  }

  const userId =
    (body?.user_id as string | undefined) ??
    (body?.updated_by_user_id as string | undefined) ??
    (body?.employee_id as string | undefined) ??
    null;
  const businessId = (body?.business_id as string | undefined) ?? null;
  if (userId && businessId) {
    return { userId, businessId, isPortal: false };
  }

  return null;
}

export async function assertPortalFeatureForRequest(
  request: NextRequest,
  businessId: string,
  module: EssModule
): Promise<void> {
  if (!isEmployeePortalSession(request) && !(await getEmployeePortalSessionFromRequest(request))) {
    return;
  }
  try {
    await assertEmployeePortalFeature(businessId, module);
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      throw error;
    }
    throw error;
  }
}

export function enforcePortalSelfScope(
  actor: ActorContext,
  requestedEmployeeId: string | null | undefined
): string {
  if (!actor.isPortal) {
    return requestedEmployeeId ?? actor.userId;
  }
  return actor.userId;
}

export function assertPortalOwnResource(
  actor: ActorContext,
  resourceEmployeeId: string
): NextResponse | null {
  if (actor.isPortal && resourceEmployeeId !== actor.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export function blockPortalAdminAction(
  actor: ActorContext,
  action: string,
  allowed: string[] = ['cancel']
): NextResponse | null {
  if (actor.isPortal && !allowed.includes(action)) {
    return NextResponse.json({ error: 'Action not allowed in employee portal' }, { status: 403 });
  }
  return null;
}

export async function enforceEmployeePortalApiBoundary(
  request: NextRequest
): Promise<NextResponse | null> {
  const portal = await getEmployeePortalSessionFromRequest(request);
  if (!portal) return null;
  const { pathname } = new URL(request.url);
  if (!isEssApiAllowed(request.method, pathname)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
