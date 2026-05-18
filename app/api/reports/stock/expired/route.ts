import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { fetchStockExpiryRows, parseAsOfDate } from '@/lib/reports/stock-expiry-report';

/**
 * GET /api/reports/stock/expired
 * Back-compat alias for expired batches only — same payload shape as /api/reports/stock/expiry?type=expired.
 *
 * Query params:
 * - warehouse_id: optional
 * - as_of_date: optional YYYY-MM-DD (default today)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const asOfParsed = parseAsOfDate(searchParams.get('as_of_date'));
    if (!asOfParsed.ok) {
      return NextResponse.json({ error: asOfParsed.error }, { status: 400 });
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

    const data = await fetchStockExpiryRows(businessId, {
      type: 'expired',
      asOfDate: asOfParsed.value,
      days: 0,
      warehouseId: warehouseId || null,
    });

    return NextResponse.json({
      data,
      meta: {
        type: 'expired' as const,
        as_of_date: asOfParsed.value,
        warehouse_id: warehouseId || null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating expired stock report:', error);
    return NextResponse.json({ error: 'Failed to generate report', details: message }, { status: 500 });
  }
}
