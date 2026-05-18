import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import { getUserAccessibleBranchIds } from '@/lib/branch-access';

/**
 * GET /api/dashboard/dead-stock/suggestions
 *
 * Phase 2 helper: for a given dead-stock `item_id`, return up to 5 customers
 * who are likely re-purchase candidates. Ranking:
 *   1. Customers who previously bought the same item_id (recency weighted).
 *   2. Customers who bought other items sharing the same category_id.
 *
 * Scoped to the user's accessible branches so suggestions never leak across
 * tenants or branches the caller can't see. Phone numbers are returned to
 * allow the client to build `https://wa.me/...` handoff links.
 *
 * Lookback window: 12 months (tunable via `months` query param, max 36).
 */

const DEFAULT_LOOKBACK_MONTHS = 12;
const MAX_LOOKBACK_MONTHS = 36;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    try {
      await assertFeatureAccess(businessId, 'dead_stock_widget');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return NextResponse.json(err.toResponse(), { status: 403 });
      }
      throw err;
    }

    const itemId = searchParams.get('item_id');
    if (!itemId) {
      return NextResponse.json(
        { error: 'item_id is required' },
        { status: 400 }
      );
    }

    const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    if (accessibleBranchIds.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const branchIdFilter = searchParams.get('branch_id');
    let scopedBranchIds = accessibleBranchIds;
    if (branchIdFilter) {
      if (!accessibleBranchIds.includes(branchIdFilter)) {
        return NextResponse.json(
          { error: 'Branch not accessible' },
          { status: 403 }
        );
      }
      scopedBranchIds = [branchIdFilter];
    }

    const monthsRaw = parseInt(
      searchParams.get('months') || `${DEFAULT_LOOKBACK_MONTHS}`,
      10
    );
    const months = Number.isFinite(monthsRaw)
      ? Math.min(Math.max(monthsRaw, 1), MAX_LOOKBACK_MONTHS)
      : DEFAULT_LOOKBACK_MONTHS;

    const limitRaw = parseInt(searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // Confirm item belongs to this business and grab its category for
    // the secondary ranking pass.
    const item = await queryOne<{ id: string; category_id: string | null }>(
      `SELECT id, category_id FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      );
    }

    const rows = await queryRows<{
      customer_id: string;
      name: string;
      phone: string | null;
      last_purchase_date: string;
      purchase_count: number;
      match_type: 'same_item' | 'same_category';
    }>(
      `
      WITH invoice_scope AS (
        SELECT inv.id, inv.customer_id, inv.invoice_date
        FROM invoices inv
        WHERE inv.business_id = $1
          AND inv.branch_id = ANY($2::uuid[])
          AND inv.deleted_at IS NULL
          AND inv.status = 'final'
          AND (inv.document_type IS NULL OR inv.document_type != 'proforma_invoice')
          AND inv.customer_id IS NOT NULL
          AND inv.invoice_date >= (CURRENT_DATE - ($3 || ' months')::interval)
      ),
      same_item AS (
        SELECT
          inv.customer_id,
          MAX(inv.invoice_date) AS last_purchase_date,
          COUNT(*)::int AS purchase_count
        FROM invoice_scope inv
        JOIN invoice_items ii ON ii.invoice_id = inv.id
        WHERE ii.item_id = $4
        GROUP BY inv.customer_id
      ),
      same_category AS (
        SELECT
          inv.customer_id,
          MAX(inv.invoice_date) AS last_purchase_date,
          COUNT(*)::int AS purchase_count
        FROM invoice_scope inv
        JOIN invoice_items ii ON ii.invoice_id = inv.id
        JOIN items it ON it.id = ii.item_id
        WHERE $5::uuid IS NOT NULL
          AND it.category_id = $5::uuid
          AND ii.item_id != $4
        GROUP BY inv.customer_id
      ),
      ranked AS (
        SELECT
          customer_id,
          last_purchase_date,
          purchase_count,
          'same_item'::text AS match_type,
          1 AS match_priority
        FROM same_item
        UNION ALL
        SELECT
          customer_id,
          last_purchase_date,
          purchase_count,
          'same_category'::text AS match_type,
          2 AS match_priority
        FROM same_category
        WHERE customer_id NOT IN (SELECT customer_id FROM same_item)
      )
      SELECT
        c.id AS customer_id,
        c.name,
        c.phone,
        r.last_purchase_date,
        r.purchase_count,
        r.match_type
      FROM ranked r
      JOIN customers c ON c.id = r.customer_id AND c.deleted_at IS NULL
      WHERE c.business_id = $1
        AND COALESCE(c.is_active, true) = true
      ORDER BY r.match_priority ASC, r.last_purchase_date DESC, r.purchase_count DESC
      LIMIT $6
      `,
      [businessId, scopedBranchIds, months, itemId, item.category_id, limit]
    );

    return NextResponse.json({
      item_id: itemId,
      lookback_months: months,
      suggestions: rows.map((r) => ({
        customer_id: r.customer_id,
        name: r.name,
        phone: r.phone,
        last_purchase_date: r.last_purchase_date,
        purchase_count: r.purchase_count,
        match_type: r.match_type,
      })),
    });
  } catch (error: any) {
    console.error('[dead-stock/suggestions] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
