import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import {
  aggregateAreas,
  topItemPivot,
  type CustomerAreaFact,
  type ItemAreaAmount,
} from '@/lib/supplier-area-performance';

export const dynamic = 'force-dynamic';

const PERIODS = ['30d', '90d', 'fy'] as const;
type PeriodKey = (typeof PERIODS)[number];

function periodRange(key: PeriodKey, today = new Date()): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  if (key === 'fy') {
    const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return { from: `${year}-04-01`, to };
  }
  const from = new Date(today);
  from.setDate(from.getDate() - (key === '30d' ? 30 : 90));
  return { from: from.toISOString().slice(0, 10), to };
}

/**
 * GET /api/suppliers/dashboard/analytics?period=30d|90d|fy
 * Sell-in (customer purchases from this vendor) and sell-through (their onward invoices
 * of items supplied by this vendor), for customers who granted low-stock access.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('supplier_business_id');
    if (requested && requested !== auth.businessId) {
      return NextResponse.json(
        { error: 'You can only view your own area performance', code: 'TENANT_MISMATCH' },
        { status: 403 }
      );
    }

    const periodKey = (searchParams.get('period') || '90d') as PeriodKey;
    if (!PERIODS.includes(periodKey)) {
      return NextResponse.json({ error: 'period must be 30d, 90d, or fy' }, { status: 400 });
    }
    const period = periodRange(periodKey);

    const customers = await queryRows<{
      state: string | null;
      city: string | null;
      pincode: string | null;
      sell_in: string;
      sell_through: string;
      low_stock_items: string;
    }>(
      `
      WITH linked AS (
        SELECT DISTINCT s.business_id AS customer_id
        FROM suppliers s
        WHERE s.linked_business_id = $1
          AND s.allow_low_stock_access = true
          AND s.deleted_at IS NULL
      ),
      sell_in AS (
        SELECT p.business_id AS customer_id, COALESCE(SUM(p.grand_total), 0) AS amount
        FROM purchases p
        JOIN suppliers s ON s.id = p.supplier_id
        JOIN linked l ON l.customer_id = p.business_id
        WHERE s.linked_business_id = $1
          AND s.deleted_at IS NULL
          AND p.status = 'final'
          AND p.bill_date >= $2::date
          AND p.bill_date <= $3::date
        GROUP BY p.business_id
      ),
      supplied_items AS (
        SELECT DISTINCT pi.item_id, p.business_id AS customer_id
        FROM purchases p
        JOIN purchase_items pi ON pi.purchase_id = p.id
        JOIN suppliers s ON s.id = p.supplier_id
        JOIN linked l ON l.customer_id = p.business_id
        WHERE s.linked_business_id = $1
          AND p.status = 'final'
          AND pi.item_id IS NOT NULL
        UNION
        SELECT i.id, i.business_id
        FROM items i
        JOIN suppliers s ON s.id = i.default_supplier_id
        JOIN linked l ON l.customer_id = i.business_id
        WHERE s.linked_business_id = $1
          AND s.deleted_at IS NULL
          AND i.deleted_at IS NULL
        UNION
        SELECT t.item_id, t.customer_business_id
        FROM supplier_item_thresholds t
        JOIN linked l ON l.customer_id = t.customer_business_id
        WHERE t.supplier_business_id = $1
      ),
      sell_through AS (
        SELECT inv.business_id AS customer_id, COALESCE(SUM(ii.line_total), 0) AS amount
        FROM invoices inv
        JOIN invoice_items ii ON ii.invoice_id = inv.id
        JOIN supplied_items si ON si.item_id = ii.item_id AND si.customer_id = inv.business_id
        WHERE inv.status = 'final'
          AND inv.invoice_date >= $2::date
          AND inv.invoice_date <= $3::date
        GROUP BY inv.business_id
      ),
      low_stock AS (
        SELECT i.business_id AS customer_id, COUNT(*)::int AS n
        FROM items i
        JOIN supplied_items si ON si.item_id = i.id AND si.customer_id = i.business_id
        WHERE i.deleted_at IS NULL
          AND i.is_active = true
          AND COALESCE(i.min_stock, 0) > 0
          AND COALESCE(i.current_stock, 0) <= i.min_stock
        GROUP BY i.business_id
      )
      SELECT
        cb.state,
        cb.city,
        cb.pincode,
        COALESCE(si.amount, 0)::text AS sell_in,
        COALESCE(st.amount, 0)::text AS sell_through,
        COALESCE(ls.n, 0)::text AS low_stock_items
      FROM linked l
      JOIN businesses cb ON cb.id = l.customer_id
      LEFT JOIN sell_in si ON si.customer_id = cb.id
      LEFT JOIN sell_through st ON st.customer_id = cb.id
      LEFT JOIN low_stock ls ON ls.customer_id = cb.id
      `,
      [auth.businessId, period.from, period.to]
    );

    const facts: CustomerAreaFact[] = customers.map((row) => ({
      state: row.state || '',
      city: row.city || '',
      pincode: row.pincode || '',
      sellIn: Number(row.sell_in) || 0,
      sellThrough: Number(row.sell_through) || 0,
      lowStockItems: Number(row.low_stock_items) || 0,
    }));

    const itemRows = await queryRows<{ state: string | null; item_name: string; sell_through: string }>(
      `
      WITH linked AS (
        SELECT DISTINCT s.business_id AS customer_id
        FROM suppliers s
        WHERE s.linked_business_id = $1
          AND s.allow_low_stock_access = true
          AND s.deleted_at IS NULL
      ),
      supplied_items AS (
        SELECT DISTINCT pi.item_id, p.business_id AS customer_id
        FROM purchases p
        JOIN purchase_items pi ON pi.purchase_id = p.id
        JOIN suppliers s ON s.id = p.supplier_id
        JOIN linked l ON l.customer_id = p.business_id
        WHERE s.linked_business_id = $1
          AND p.status = 'final'
          AND pi.item_id IS NOT NULL
        UNION
        SELECT i.id, i.business_id
        FROM items i
        JOIN suppliers s ON s.id = i.default_supplier_id
        JOIN linked l ON l.customer_id = i.business_id
        WHERE s.linked_business_id = $1
          AND s.deleted_at IS NULL
          AND i.deleted_at IS NULL
        UNION
        SELECT t.item_id, t.customer_business_id
        FROM supplier_item_thresholds t
        JOIN linked l ON l.customer_id = t.customer_business_id
        WHERE t.supplier_business_id = $1
      )
      SELECT cb.state, ii.item_name, COALESCE(SUM(ii.line_total), 0)::text AS sell_through
      FROM invoices inv
      JOIN invoice_items ii ON ii.invoice_id = inv.id
      JOIN supplied_items si ON si.item_id = ii.item_id AND si.customer_id = inv.business_id
      JOIN businesses cb ON cb.id = inv.business_id
      WHERE inv.status = 'final'
        AND inv.invoice_date >= $2::date
        AND inv.invoice_date <= $3::date
      GROUP BY cb.state, ii.item_name
      `,
      [auth.businessId, period.from, period.to]
    );

    const itemAmounts: ItemAreaAmount[] = itemRows.map((row) => ({
      state: row.state || '',
      itemName: row.item_name,
      sellThrough: Number(row.sell_through) || 0,
    }));
    const pivot = topItemPivot(itemAmounts);

    return NextResponse.json({
      success: true,
      period: { key: periodKey, from: period.from, to: period.to },
      states: aggregateAreas(facts, 'state'),
      cities: aggregateAreas(facts, 'city').slice(0, 80),
      pincodes: aggregateAreas(facts, 'pincode').slice(0, 100),
      pivot_items: pivot.items,
      pivot_matrix: pivot.matrix,
    });
  } catch (error: any) {
    console.error('Error fetching supplier area analytics:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
