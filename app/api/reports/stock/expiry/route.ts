import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  fetchStockExpiryRows,
  parseAsOfDate,
  parseDays,
  parseExpiryType,
} from '@/lib/reports/stock-expiry-report';

/**
 * GET /api/reports/stock/expiry
 * Batch-level expiry report (already expired vs expiring within N days).
 *
 * Query params:
 * - type: "expired" | "expiring" (required)
 * - days: positive integer when type=expiring (default 15)
 * - warehouse_id: optional UUID filter on batch warehouse (item_batches.location_id)
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

    const typeParsed = parseExpiryType(searchParams.get('type'));
    if (!typeParsed.ok) {
      return NextResponse.json({ error: typeParsed.error }, { status: 400 });
    }

    const asOfParsed = parseAsOfDate(searchParams.get('as_of_date'));
    if (!asOfParsed.ok) {
      return NextResponse.json({ error: asOfParsed.error }, { status: 400 });
    }

    const daysParsed = parseDays(searchParams.get('days'), typeParsed.value);
    if (!daysParsed.ok) {
      return NextResponse.json({ error: daysParsed.error }, { status: 400 });
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
      type: typeParsed.value,
      asOfDate: asOfParsed.value,
      days: daysParsed.value,
      warehouseId: warehouseId || null,
    });

    return NextResponse.json({
      data,
      meta: {
        type: typeParsed.value,
        as_of_date: asOfParsed.value,
        ...(typeParsed.value === 'expiring' ? { days: daysParsed.value } : {}),
        warehouse_id: warehouseId || null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating stock expiry report:', error);
    return NextResponse.json({ error: 'Failed to generate report', details: message }, { status: 500 });
  }
}
