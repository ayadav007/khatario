import { NextRequest, NextResponse } from 'next/server';
import { getDirectReportIds, isReportingManager } from '@/lib/hr/manager-scope';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/manager/team
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const employeeId = actor.userId;
    const businessId = actor.businessId;

    const isManager = await isReportingManager(employeeId);
    if (!isManager) {
      return NextResponse.json({ error: 'You are not a reporting manager' }, { status: 403 });
    }

    if (!actor.isPortal) {
      try {
        await authorize(actor.userId, 'employees', 'read', { businessId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          if (!isManager) return error.toNextResponse();
        } else {
          throw error;
        }
      }
    }

    const teamIds = await getDirectReportIds(businessId, employeeId);
    if (teamIds.length === 0) {
      return NextResponse.json({ team: [] });
    }

    const placeholders = teamIds.map((_, i) => `$${i + 2}`).join(', ');
    const team = await queryRows<{
      id: string;
      employee_code: string;
      name: string;
      designation: string | null;
      department: string | null;
      is_active: boolean;
      attendance_status: string | null;
    }>(
      `SELECT e.id, e.employee_code, u.name, e.designation, e.department, e.is_active,
              a.status AS attendance_status
       FROM employees e
       INNER JOIN users u ON u.id = e.id
       LEFT JOIN employee_attendance a ON a.employee_id = e.id AND a.date = CURRENT_DATE
       WHERE e.business_id = $1 AND e.id IN (${placeholders})
       ORDER BY u.name`,
      [businessId, ...teamIds]
    );

    return NextResponse.json({ team });
  } catch (error: unknown) {
    console.error('Error fetching manager team:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
