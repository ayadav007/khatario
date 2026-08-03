import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import {
  getRegularizationSettings,
  listRegularizationRequestsForEmployee,
  submitRegularizationRequest,
} from '@/lib/hr/attendance-regularization';
import type { RegularizationRequestType } from '@/lib/hr/attendance-regularization-shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const settings = await getRegularizationSettings(actor.businessId);
    const requests = await listRegularizationRequestsForEmployee(actor.businessId, actor.userId);
    return NextResponse.json({ settings, requests });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const requestType = body.request_type as RegularizationRequestType;
    if (!body.attendance_date || !requestType || !body.reason) {
      return NextResponse.json(
        { error: 'attendance_date, request_type, and reason are required' },
        { status: 400 },
      );
    }

    const row = await submitRegularizationRequest({
      businessId: actor.businessId,
      employeeId: actor.userId,
      input: {
        attendance_date: String(body.attendance_date).slice(0, 10),
        request_type: requestType,
        requested_check_in: body.requested_check_in ?? null,
        requested_check_out: body.requested_check_out ?? null,
        reason: String(body.reason),
      },
    });

    return NextResponse.json({ request: row }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
