import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  fetchSummaryLegacy,
  fetchStockHealth,
  fetchReorderSuggestions,
  fetchAgingBuckets,
  fetchValueAnalysis,
  fetchVelocity,
  fetchRecentActivity,
} from '@/lib/reports/stockSummaryDashboard';

/**
 * GET /api/reports/stock-summary
 * Inventory intelligence dashboard + legacy stock summary fields.
 *
 * Query: reorder_limit (default 25, max 100), reorder_offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');

    const reorderLimit = Math.min(
      Math.max(parseInt(searchParams.get('reorder_limit') || '25', 10) || 25, 1),
      100
    );
    const reorderOffset = Math.max(parseInt(searchParams.get('reorder_offset') || '0', 10) || 0, 0);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    try {
      await assertReportAccess(businessId, 'basic');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.inventory', 'read', {
        businessId,
        warehouseId: warehouseId || undefined,
        resource: {
          business_id: businessId,
          warehouse_id: warehouseId || null,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const [
      legacy,
      stockHealth,
      reorder,
      agingBuckets,
      valueAnalysis,
      velocity,
      recentActivity,
    ] = await Promise.all([
      fetchSummaryLegacy(businessId),
      fetchStockHealth(businessId),
      fetchReorderSuggestions(businessId, reorderLimit, reorderOffset),
      fetchAgingBuckets(businessId),
      fetchValueAnalysis(businessId),
      fetchVelocity(businessId),
      fetchRecentActivity(businessId, 10),
    ]);

    return NextResponse.json({
      summary: legacy.summary,
      lowStockItems: legacy.lowStockItems,
      highValueItems: legacy.highValueItems,
      stockHealth,
      valueAnalysis,
      reorderSuggestions: reorder.rows,
      reorderPagination: {
        total: reorder.totalCount,
        limit: reorderLimit,
        offset: reorderOffset,
        hasMore: reorderOffset + reorder.rows.length < reorder.totalCount,
      },
      agingBuckets,
      velocity,
      recentActivity,
    });
  } catch (error: any) {
    console.error('Error generating stock summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}
