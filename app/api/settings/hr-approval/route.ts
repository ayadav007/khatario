import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getHrApprovalSettings,
  updateHrApprovalSettings,
  parseHrApprovalSettings,
  type HrApprovalSettings,
} from '@/lib/hr/hr-approval-settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/hr-approval
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const settings = await getHrApprovalSettings(businessId);
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    console.error('Error fetching HR approval settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/hr-approval
 */
export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json();
    const partial = parseHrApprovalSettings(body) as Partial<HrApprovalSettings>;
    const settings = await updateHrApprovalSettings(businessId, partial);
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    console.error('Error updating HR approval settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
