import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows } from '@/lib/db';
import { closeStaffWagePeriod, StaffWageError } from '@/lib/hr/staff-wage-posting';
import type { WagePeriodKind } from '@/lib/hr/staff-wage';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    try {
      await authorize(actor.userId, 'payroll', 'create', { businessId: actor.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json().catch(() => ({}));
    const date = typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10);
    const periodKind: WagePeriodKind = body.period === 'month' ? 'month' : 'week';
    const roster = await queryRows<{ id: string }>(
      `SELECT e.id
       FROM employees e
       INNER JOIN users u ON u.id = e.id
       WHERE e.business_id = $1 AND e.is_active = true AND u.is_active = true`,
      [actor.businessId],
    );
    const result = await closeStaffWagePeriod({
      businessId: actor.businessId,
      actorUserId: actor.userId,
      employeeIds: roster.map((row) => row.id),
      periodKind,
      date,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StaffWageError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Could not post wages';
    const status = message.includes('locked period') ? 409 : 500;
    if (status === 500) console.error('[POST staff-wages/close]', error);
    return NextResponse.json({ error: message }, { status });
  }
}
