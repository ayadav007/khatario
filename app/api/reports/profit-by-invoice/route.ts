import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';

export const dynamic = 'force-dynamic';

/**
 * Profit per invoice for a date range (GET /api/reports/profit-by-invoice).
 *
 * Line revenue / cost aligns with GET /api/invoices/[id]:
 * - Revenue: taxable_value when present, else qty×unit_price − discount_amount (floored ≥ 0)
 * - Unit cost: COALESCE(variant purchase, base item purchase, variant parent item purchase, 0)
 *
 * Aggregate in SQL (no N+1). Only final invoices excluding proforma quotes (consistent with sales-summary).
 */

type SqlRow = {
  invoice_id: string;
  invoice_number: string | null;
  date: string | null;
  customer_name: string | null;
  total_revenue: string | number | null;
  total_cost: string | number | null;
  total_profit: string | number | null;
  margin_percent: string | number | null;
};

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    try {
      await assertFeatureAccess(businessId, FeatureKeys.PROFIT_REPORTS_BASIC);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: searchParams.get('branch_id'),
        businessId,
      });
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (code === 'BRANCH_NOT_FOUND' || code === 'BRANCH_BUSINESS_MISMATCH' || code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: (error as { message?: string }).message ?? 'Invalid branch' },
          { status: 400 }
        );
      }
      if (code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: (error as { message?: string }).message ?? 'No default branch' },
          { status: 500 }
        );
      }
      throw error;
    }

    try {
      await authorize(userId, 'report', 'read', {
        businessId,
        branchId: finalBranchId,
        resource: { business_id: businessId, branch_id: finalBranchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const rows = await queryRows<SqlRow>(
      `
      WITH line_metrics AS (
        SELECT
          ii.invoice_id,
          CASE
            WHEN ii.taxable_value IS NOT NULL THEN GREATEST(COALESCE(ii.taxable_value, 0)::numeric, 0)
            ELSE GREATEST(
              COALESCE(ii.quantity, 0)::numeric * COALESCE(ii.unit_price, 0)::numeric
              - COALESCE(ii.discount_amount, 0)::numeric,
              0
            )
          END AS line_revenue,
          COALESCE(ii.quantity, 0)::numeric * COALESCE(
            iv.purchase_price,
            i.purchase_price,
            iv_parent.purchase_price,
            0::numeric
          ) AS line_cost
        FROM invoice_items ii
        INNER JOIN invoices inv
          ON inv.id = ii.invoice_id AND inv.business_id = $1 AND inv.deleted_at IS NULL
        LEFT JOIN items i ON ii.item_id = i.id AND i.business_id = inv.business_id
        LEFT JOIN item_variants iv
          ON iv.id = ii.variant_id
          AND (ii.item_id IS NULL OR ii.item_id = iv.item_id)
        LEFT JOIN items iv_parent
          ON iv.id IS NOT NULL
          AND iv_parent.id = iv.item_id
          AND iv_parent.business_id = inv.business_id
        WHERE inv.invoice_date::date >= $2::date
          AND inv.invoice_date::date <= $3::date
          AND inv.status = 'final'
          AND (inv.document_type IS NULL OR inv.document_type <> 'proforma_invoice')
      ),
      sums AS (
        SELECT
          invoice_id,
          ROUND(SUM(line_revenue)::numeric, 2) AS total_revenue,
          ROUND(SUM(line_cost)::numeric, 2) AS total_cost
        FROM line_metrics
        GROUP BY invoice_id
      )
      SELECT
        inv.id AS invoice_id,
        inv.invoice_number,
        TO_CHAR(inv.invoice_date::date, 'YYYY-MM-DD') AS date,
        c.name AS customer_name,
        s.total_revenue,
        s.total_cost,
        ROUND((s.total_revenue - s.total_cost)::numeric, 2) AS total_profit,
        CASE
          WHEN COALESCE(s.total_revenue, 0) > 0 THEN ROUND(
            ((s.total_revenue - s.total_cost) / s.total_revenue * 100)::numeric,
            2
          )
          ELSE 0::numeric
        END AS margin_percent
      FROM sums s
      INNER JOIN invoices inv ON inv.id = s.invoice_id AND inv.business_id = $1 AND inv.deleted_at IS NULL
      LEFT JOIN customers c ON c.id = inv.customer_id AND c.deleted_at IS NULL
      ORDER BY inv.invoice_date DESC, inv.invoice_number DESC NULLS LAST
      `,
      [businessId, startDate, endDate]
    );

    const invoices = rows.map((row) => ({
      invoice_id: row.invoice_id,
      invoice_number: row.invoice_number,
      date: row.date,
      customer_name: row.customer_name ?? null,
      total_revenue: num(row.total_revenue),
      total_cost: num(row.total_cost),
      total_profit: num(row.total_profit),
      margin_percent: num(row.margin_percent),
    }));

    return NextResponse.json({ invoices });
  } catch (error: unknown) {
    console.error('GET /api/reports/profit-by-invoice:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: 'Failed to generate report', details: msg }, { status: 500 });
  }
}
