import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { payStaffWage, StaffWageError } from '@/lib/hr/staff-wage-posting';

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
    const accrualId = typeof body.accrual_id === 'string' ? body.accrual_id : '';
    const amount = Number(body.amount);
    const paymentDate = typeof body.payment_date === 'string'
      ? body.payment_date
      : new Date().toISOString().slice(0, 10);
    const paymentMode = typeof body.payment_mode === 'string' ? body.payment_mode : 'cash';
    if (!accrualId) {
      return NextResponse.json({ error: 'accrual_id is required' }, { status: 400 });
    }

    const result = await payStaffWage({
      businessId: actor.businessId,
      actorUserId: actor.userId,
      accrualId,
      amount,
      paymentDate,
      paymentMode,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StaffWageError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Could not record payment';
    const status = message.includes('locked period') ? 409 : 500;
    if (status === 500) console.error('[POST staff-wages/pay]', error);
    return NextResponse.json({ error: message }, { status });
  }
}
