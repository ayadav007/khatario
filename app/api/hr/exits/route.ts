import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { initiateExit, listExits } from '@/lib/hr/exit-process';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'employees', 'read', { businessId });

    const status = request.nextUrl.searchParams.get('status') ?? undefined;
    const exits = await listExits(businessId, status);
    return NextResponse.json({ exits });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load exits' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'employees', 'update', { businessId });

    const body = await request.json();
    const employeeId = String(body?.employee_id ?? '');
    const exitType = body?.exit_type === 'termination' ? 'termination' : 'resignation';
    if (!employeeId) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });
    }

    const result = await initiateExit({
      businessId,
      employeeId,
      exitType,
      reason: body?.reason ? String(body.reason) : undefined,
      resignationSubmittedAt: body?.resignation_submitted_at
        ? String(body.resignation_submitted_at)
        : undefined,
      rehireEligible: body?.rehire_eligible != null ? Boolean(body.rehire_eligible) : undefined,
      lastWorkingDate: body?.last_working_date ? String(body.last_working_date) : undefined,
      createdBy: userId,
    });

    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to initiate exit';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
