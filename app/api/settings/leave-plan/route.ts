import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getDefaultPlanBundle,
  saveDefaultLeavePlan,
  syncPlanTypesFromLeaveTypes,
} from '@/lib/hr/leave/leave-plan';
import type {
  LeaveApprovalChainLevel,
  LeaveEncashmentRateBasis,
  LeavePlanApplicationSettings,
  LeavePlanRestriction,
  LeavePlanTypeRule,
} from '@/lib/hr/leave/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });
    await syncPlanTypesFromLeaveTypes(businessId);
    const bundle = await getDefaultPlanBundle(businessId);
    return NextResponse.json(bundle);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load leave plan' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const saved = await saveDefaultLeavePlan(businessId, {
      name: body.name,
      calendar_year_start_month: body.calendar_year_start_month,
      policy_document_url: body.policy_document_url,
      application_settings: body.application_settings as LeavePlanApplicationSettings | undefined,
      leave_approval_chain: body.leave_approval_chain as LeaveApprovalChainLevel[] | undefined,
      encashment_daily_rate_basis: body.encashment_daily_rate_basis as LeaveEncashmentRateBasis | undefined,
      type_rules: body.type_rules as LeavePlanTypeRule[] | undefined,
      restrictions: body.restrictions as LeavePlanRestriction[] | undefined,
    });

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to save leave plan';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
