import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { getAttendanceRollCallScope } from '@/lib/hr/attendance-roll-call-scope';

export const dynamic = 'force-dynamic';

/** GET /api/employees/manager/context — lightweight flag for nav / UI. */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const scope = await getAttendanceRollCallScope(actor.userId, actor.businessId);

    return NextResponse.json({
      is_reporting_manager: scope.isReportingManager,
      team_count: scope.scope === 'team' ? scope.employeeIds.length : 0,
      can_roll_call: scope.scope !== 'none' && scope.employeeIds.length > 0,
      roll_call_scope: scope.scope,
      employee_count: scope.employeeIds.length,
    });
  } catch (error: unknown) {
    console.error('[GET /api/employees/manager/context]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
