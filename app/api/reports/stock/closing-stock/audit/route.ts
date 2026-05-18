import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { applyStockAuditOverrides } from '@/lib/services/closing-stock-valuator';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/reports/stock/closing-stock/audit
 * Body: business_id, user_id, snapshot_id, overrides: { [item_id]: physical_qty }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);
    const { snapshot_id, overrides } = body;

    if (!business_id || !snapshot_id || !overrides || typeof overrides !== 'object') {
      return NextResponse.json(
        { error: 'business_id, snapshot_id, and overrides object are required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    try {
      await assertReportAccess(business_id, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.inventory', 'read', {
        businessId: business_id,
        resource: { business_id },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const map: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides)) {
      const n = Number(v);
      if (!Number.isNaN(n)) map[String(k)] = n;
    }

    await applyStockAuditOverrides(business_id, snapshot_id, map);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('closing-stock audit:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save audit entries' },
      { status: 500 }
    );
  }
}
