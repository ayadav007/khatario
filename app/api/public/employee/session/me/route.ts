import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  getEmployeePortalSessionFromRequest,
  destroyEmployeePortalSession,
  clearEmployeePortalCookie,
  getEmployeePortalTokenFromRequest,
} from '@/lib/employee-portal/session';
import { getEmployeePortalEntitlements } from '@/lib/employee-portal/feature-gates';
import { resolveBusinessByPortalSlug } from '@/lib/employee-portal/resolve-business';
import { isReportingManager } from '@/lib/hr/manager-scope';
import { getMustChangePassword } from '@/lib/employee-portal/password';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getEmployeePortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const business = await resolveBusinessByPortalSlug(
    request.nextUrl.searchParams.get('slug') ?? ''
  );

  const bizRow = await queryOne<{ name: string; logo_url: string | null; portal_slug: string }>(
    `SELECT b.name, b.logo_url, bs.portal_slug
     FROM businesses b
     INNER JOIN business_settings bs ON bs.business_id = b.id
     WHERE b.id = $1`,
    [session.business_id]
  );

  const entitlements = await getEmployeePortalEntitlements(session.business_id);
  const isManager = await isReportingManager(session.employee_id);
  const mustChangePassword = await getMustChangePassword(
    session.employee_id,
    session.business_id
  );

  return NextResponse.json({
    employee: {
      id: session.employee_id,
      name: session.employee_name,
      employee_code: session.employee_code,
    },
    business: {
      id: session.business_id,
      name: bizRow?.name ?? business?.name ?? '',
      logo_url: bizRow?.logo_url ?? null,
      portal_slug: bizRow?.portal_slug ?? business?.portal_slug ?? '',
    },
    entitlements: {
      ...entitlements,
      team: entitlements.team && isManager,
    },
    is_manager: isManager,
    must_change_password: mustChangePassword,
  });
}
