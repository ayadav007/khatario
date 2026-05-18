import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/label-print-log
 *
 * Paged audit trail of label print jobs. Supports optional filters:
 *   from, to  (ISO dates)
 *   user_id   (who printed)
 *   purpose   ('standalone' | 'purchase' | 'item_create')
 *   limit     (default 100, max 500)
 */

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId)
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );

    try {
      // Audit log is management-grade data; gate on reports module.
      await authorize(userId, 'reports', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError)
        return error.toNextResponse();
      throw error;
    }

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const filterUserId = url.searchParams.get('filter_user_id');
    const purpose = url.searchParams.get('purpose');
    const limit = Math.min(
      500,
      Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10))
    );

    const wheres: string[] = ['l.business_id = $1'];
    const params: any[] = [businessId];

    if (from) {
      params.push(from);
      wheres.push(`l.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      wheres.push(`l.created_at <= $${params.length}`);
    }
    if (filterUserId) {
      params.push(filterUserId);
      wheres.push(`l.user_id = $${params.length}`);
    }
    if (purpose) {
      params.push(purpose);
      wheres.push(`l.purpose = $${params.length}`);
    }

    params.push(limit);
    const rows = await queryRows<any>(
      `SELECT l.id, l.business_id, l.user_id, l.purpose, l.template_id,
              l.template_name, l.purchase_id, l.format, l.layout, l.symbology,
              l.line_count, l.total_labels, l.lines_snapshot, l.created_at,
              u.name  AS user_name,
              u.email AS user_email,
              p.bill_number
         FROM label_print_log l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN purchases p ON p.id = l.purchase_id AND p.deleted_at IS NULL
        WHERE ${wheres.join(' AND ')}
        ORDER BY l.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    // Aggregate totals for the filtered window.
    const totals = await queryRows<any>(
      `SELECT COUNT(*)::int AS jobs,
              COALESCE(SUM(total_labels), 0)::int AS labels
         FROM label_print_log l
        WHERE ${wheres.slice(0, wheres.length).join(' AND ')}`,
      params.slice(0, params.length - 1)
    );

    return NextResponse.json({
      entries: rows,
      total_jobs: totals[0]?.jobs || 0,
      total_labels: totals[0]?.labels || 0,
    });
  } catch (error: any) {
    console.error('[GET /api/reports/label-print-log] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load audit log' },
      { status: 500 }
    );
  }
}
