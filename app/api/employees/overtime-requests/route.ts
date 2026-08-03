import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { resolveActorContext, assertPortalFeatureForRequest } from '@/lib/employee-portal/portal-api-guard';
import {
  validateOtApplication,
  resolveEffectiveCompensation,
  getOtPolicy,
} from '@/lib/hr/shift-overtime/ot-policy';
import { bootstrapOtRequestApprovals } from '@/lib/hr/shift-overtime/ot-request-approval';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');

    await authorize(userId, 'leave_requests', 'read', { businessId });

    let sql = `
      SELECT o.*, u.name AS employee_name, e.employee_code
      FROM overtime_requests o
      INNER JOIN employees e ON e.id = o.employee_id
      INNER JOIN users u ON u.id = e.id
      WHERE o.business_id = $1`;
    const params: unknown[] = [businessId];
    if (employeeId) {
      sql += ` AND o.employee_id = $2`;
      params.push(employeeId);
    }
    if (status) {
      sql += ` AND o.status = $${params.length + 1}`;
      params.push(status);
    }
    sql += ` ORDER BY o.created_at DESC LIMIT 100`;

    const requests = await queryRows(sql, params);
    return NextResponse.json({ requests });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to list overtime requests' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = await resolveActorContext(request, body);
    let {
      business_id,
      employee_id,
      request_date,
      start_time,
      end_time,
      duration_minutes,
      reason,
      compensation_choice,
    } = body;

    if (actor) {
      business_id = actor.businessId;
      if (actor.isPortal) employee_id = actor.userId;
    }

    if (!business_id || !employee_id || !request_date || !duration_minutes) {
      return NextResponse.json(
        { error: 'business_id, employee_id, request_date, and duration_minutes are required' },
        { status: 400 },
      );
    }

    const authUserId = resolveCreatedByUserId(request, body) || employee_id;
    const isPortalSelfApply = Boolean(actor?.isPortal && authUserId === employee_id);

    if (!isPortalSelfApply) {
      await authorize(authUserId, 'leave_requests', 'create', { businessId: business_id });
    }

    const durationMinutes = Number(duration_minutes);
    const totalHours = Math.round((durationMinutes / 60) * 100) / 100;

    await validateOtApplication({
      businessId: business_id,
      employeeId: employee_id,
      requestDate: request_date,
      durationMinutes,
      reason,
      compensationChoice: compensation_choice,
      actorUserId: authUserId,
      isPortalSelfApply,
    });

    const comp = await resolveEffectiveCompensation(
      business_id,
      employee_id,
      request_date,
      compensation_choice,
    );

    const policy = await getOtPolicy(business_id);
    const needsChain = (policy?.approval_chain.length ?? 0) > 0;
    const status = 'pending';

    const row = await queryOne(
      `INSERT INTO overtime_requests (
         business_id, employee_id, request_date, start_time, end_time,
         duration_minutes, total_hours, reason, compensation_choice, status, requested_by
       ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        business_id,
        employee_id,
        request_date,
        start_time ?? null,
        end_time ?? null,
        durationMinutes,
        totalHours,
        reason ?? null,
        comp,
        status,
        authUserId,
      ],
    );

    if (!row) return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });

    if (needsChain) {
      await bootstrapOtRequestApprovals(String(row.id), business_id, employee_id);
    }

    return NextResponse.json({ request: row }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to create overtime request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
