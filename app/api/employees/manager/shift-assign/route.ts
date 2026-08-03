import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { managerAssignShiftForEmployee } from '@/lib/hr/shift-overtime/shift-assignment';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    await managerAssignShiftForEmployee({
      businessId: actor.businessId,
      managerUserId: actor.userId,
      employeeId: body.employee_id,
      shiftId: body.shift_id ?? null,
      effectiveFrom: body.effective_from,
      effectiveTo: body.effective_to ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Assignment failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
