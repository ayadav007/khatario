import { NextRequest, NextResponse } from 'next/server';
import { requirePortalSession } from '@/lib/employee-portal/portal-route-guard';
import {
  cancelEmployeeResignation,
  getEmployeeResignationDetail,
  getEmployeeResignationView,
  submitEmployeeResignation,
} from '@/lib/hr/employee-resignation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const view = await getEmployeeResignationView(auth.session.businessId, auth.session.employeeId);
    const detail = view.active_exit
      ? await getEmployeeResignationDetail(auth.session.businessId, auth.session.employeeId)
      : null;

    return NextResponse.json({
      ...view,
      approvals: detail?.approvals ?? [],
    });
  } catch (error) {
    console.error('[portal/resignation GET]', error);
    return NextResponse.json({ error: 'Failed to load resignation status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const reason = String(body?.reason ?? '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'Please select a reason for leaving' }, { status: 400 });
    }

    const result = await submitEmployeeResignation({
      businessId: auth.session.businessId,
      employeeId: auth.session.employeeId,
      reason,
      preferredLastWorkingDate: body?.preferred_last_working_date
        ? String(body.preferred_last_working_date)
        : undefined,
      notes: body?.notes ? String(body.notes) : undefined,
    });

    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Submission failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    await cancelEmployeeResignation(auth.session.businessId, auth.session.employeeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not withdraw';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
