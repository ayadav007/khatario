import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { bulkAssignShift } from '@/lib/hr/shift-overtime/shift-assignment';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'leave_requests', 'update', { businessId });

    const body = await request.json();
    const count = await bulkAssignShift({
      businessId,
      shiftId: body.shift_id ?? null,
      employeeIds: body.employee_ids,
      department: body.department,
      branchId: body.branch_id,
      assignedBy: userId,
      effectiveFrom: body.effective_from,
      effectiveTo: body.effective_to ?? null,
    });

    return NextResponse.json({ assigned: count });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Bulk assign failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
