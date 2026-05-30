import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { salesTrendGranularity } from '@/lib/dashboard/sales-trend-range';

const INVOICE_BASE_FILTER = `
  business_id = $1
  AND deleted_at IS NULL
  AND status = 'final'
  AND (document_type IS NULL OR document_type != 'proforma_invoice')
`;

type BucketRow = { key: string; label: string; sales: number; receipt_count: number };

function emptySalesTrendResponse() {
  return NextResponse.json({
    granularity: 'day' as const,
    buckets: [] as BucketRow[],
    summary: { receipt_count: 0, net_sales: 0, average_sale: 0 },
  });
}

function fillHourlyBuckets(
  rows: Array<{ hour: number; sales: number; receipt_count: number }>
): BucketRow[] {
  const map = new Map(rows.map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = map.get(hour);
    const sales = Number(row?.sales || 0);
    const receipt_count = Number(row?.receipt_count || 0);
    const label =
      hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
    return { key: String(hour), label, sales, receipt_count };
  });
}

function fillDailyBuckets(start: string, end: string, rows: Array<{ date: string; sales: number; receipt_count: number }>): BucketRow[] {
  const map = new Map(rows.map((r) => [r.date, r]));
  const buckets: BucketRow[] = [];
  let cursor = parseISO(start);
  const endDate = parseISO(end);
  while (cursor <= endDate) {
    const key = format(cursor, 'yyyy-MM-dd');
    const row = map.get(key);
    buckets.push({
      key,
      label: format(cursor, 'd MMM'),
      sales: Number(row?.sales || 0),
      receipt_count: Number(row?.receipt_count || 0),
    });
    cursor = addDays(cursor, 1);
  }
  return buckets;
}

function fillWeeklyBuckets(start: string, end: string, rows: Array<{ week_start: string; sales: number; receipt_count: number }>): BucketRow[] {
  const map = new Map(rows.map((r) => [r.week_start, r]));
  const buckets: BucketRow[] = [];
  let cursor = startOfWeek(parseISO(start), { weekStartsOn: 1 });
  const endDate = parseISO(end);
  while (cursor <= endDate) {
    const key = format(cursor, 'yyyy-MM-dd');
    const row = map.get(key);
    const weekEnd = addDays(cursor, 6);
    buckets.push({
      key,
      label: `${format(cursor, 'd MMM')} – ${format(weekEnd, 'd MMM')}`,
      sales: Number(row?.sales || 0),
      receipt_count: Number(row?.receipt_count || 0),
    });
    cursor = addDays(cursor, 7);
  }
  return buckets;
}

/**
 * GET /api/dashboard/sales-trend
 * Sales buckets for dashboard chart (hourly / daily / weekly) with summary stats.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'business_id, start_date, and end_date are required' },
        { status: 400 }
      );
    }

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      if (accessibleBranchIds.length === 0) {
        return emptySalesTrendResponse();
      }
    } catch (error) {
      console.error('[Sales Trend] branch access error:', error);
      return emptySalesTrendResponse();
    }

    const granularity = salesTrendGranularity(startDate, endDate);
    const branchFilter = `AND branch_id = ANY($${granularity === 'hour' ? 3 : 4}::uuid[])`;

    let buckets: BucketRow[] = [];

    if (granularity === 'hour') {
      const rows = await queryRows<{ hour: number; sales: number; receipt_count: number }>(
        `SELECT
          EXTRACT(HOUR FROM created_at)::int AS hour,
          COALESCE(SUM(grand_total), 0) AS sales,
          COUNT(*)::int AS receipt_count
        FROM invoices
        WHERE ${INVOICE_BASE_FILTER}
          AND DATE(invoice_date) = DATE($2)
          ${branchFilter}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour ASC`,
        [businessId, startDate, accessibleBranchIds]
      );
      buckets = fillHourlyBuckets(rows);
    } else if (granularity === 'day') {
      const rows = await queryRows<{ date: string; sales: number; receipt_count: number }>(
        `SELECT
          DATE(invoice_date)::text AS date,
          COALESCE(SUM(grand_total), 0) AS sales,
          COUNT(*)::int AS receipt_count
        FROM invoices
        WHERE ${INVOICE_BASE_FILTER}
          AND DATE(invoice_date) >= DATE($2)
          AND DATE(invoice_date) <= DATE($3)
          ${branchFilter}
        GROUP BY DATE(invoice_date)
        ORDER BY date ASC`,
        [businessId, startDate, endDate, accessibleBranchIds]
      );
      buckets = fillDailyBuckets(startDate, endDate, rows);
    } else {
      const rows = await queryRows<{ week_start: string; sales: number; receipt_count: number }>(
        `SELECT
          DATE_TRUNC('week', invoice_date)::date::text AS week_start,
          COALESCE(SUM(grand_total), 0) AS sales,
          COUNT(*)::int AS receipt_count
        FROM invoices
        WHERE ${INVOICE_BASE_FILTER}
          AND DATE(invoice_date) >= DATE($2)
          AND DATE(invoice_date) <= DATE($3)
          ${branchFilter}
        GROUP BY DATE_TRUNC('week', invoice_date)
        ORDER BY week_start ASC`,
        [businessId, startDate, endDate, accessibleBranchIds]
      );
      buckets = fillWeeklyBuckets(startDate, endDate, rows);
    }

    const receipt_count = buckets.reduce((sum, b) => sum + b.receipt_count, 0);
    const net_sales = buckets.reduce((sum, b) => sum + b.sales, 0);
    const average_sale = receipt_count > 0 ? net_sales / receipt_count : 0;

    return NextResponse.json({
      granularity,
      buckets,
      summary: {
        receipt_count,
        net_sales,
        average_sale,
      },
      range_days: differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Sales Trend] error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
