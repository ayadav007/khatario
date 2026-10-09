import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows } from '@/lib/db';
import { previewStaffWages, StaffWageError } from '@/lib/hr/staff-wage-posting';
import { viewerCanSeeWages } from '@/lib/hr/staff-wage-access';
import type { WagePeriodKind } from '@/lib/hr/staff-wage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const canView = await viewerCanSeeWages(actor.userId);
    if (!canView) {
      return NextResponse.json({ can_view_wages: false });
    }

    try {
      await authorize(actor.userId, 'payroll', 'read', { businessId: actor.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const kind = searchParams.get('period') === 'month' ? 'month' : 'week';
    const roster = await queryRows<{ id: string }>(
      `SELECT e.id
       FROM employees e
       INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND e.is_active = true AND u.is_active = true`,
      [actor.businessId],
    );
    const preview = await previewStaffWages({
      businessId: actor.businessId,
      employeeIds: roster.map((row) => row.id),
      periodKind: kind as WagePeriodKind,
      date,
    });
    return NextResponse.json({ can_view_wages: true, ...preview });
  } catch (error) {
    if (error instanceof StaffWageError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[GET staff-wages]', error);
    return NextResponse.json({ error: 'Could not load wages' }, { status: 500 });
  }
}
