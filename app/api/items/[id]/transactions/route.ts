import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { Item } from '@/types/database';

/**
 * GET /api/items/[id]/transactions
 * Returns the sales and purchase transactions containing this item, merged into a unified list.
 * Supports ?limit and ?range=30|90|365|all.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const item = await queryOne<Item>(
      'SELECT id, business_id FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [itemId, businessId]
    );

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'items', 'read', { businessId: item.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get('limit') ?? '50');
    const limit = Math.min(Math.max(limitParam, 1), 200);
    const range = searchParams.get('range') ?? 'all';

    let dateFilter = '';
    if (range === '30') dateFilter = "AND date >= CURRENT_DATE - INTERVAL '30 days'";
    else if (range === '90') dateFilter = "AND date >= CURRENT_DATE - INTERVAL '90 days'";
    else if (range === '365') dateFilter = "AND date >= CURRENT_DATE - INTERVAL '365 days'";

    const rows = await queryRows<{
      type: 'invoice' | 'purchase';
      id: string;
      ref_no: string;
      date: string;
      party_name: string | null;
      party_id: string | null;
      quantity: number;
      unit_price: number;
      line_total: number;
      document_type: string | null;
    }>(
      `
      WITH combined AS (
        SELECT
          'invoice'::text AS type,
          inv.id,
          inv.invoice_number AS ref_no,
          inv.invoice_date::text AS date,
          c.name AS party_name,
          c.id AS party_id,
          ii.quantity,
          ii.unit_price,
          ii.line_total,
          inv.document_type
        FROM invoice_items ii
        JOIN invoices inv ON inv.id = ii.invoice_id
        LEFT JOIN customers c ON c.id = inv.customer_id
        WHERE ii.item_id = $1 AND inv.business_id = $2

        UNION ALL

        SELECT
          'purchase'::text AS type,
          p.id,
          COALESCE(p.bill_number, 'BILL-' || SUBSTRING(p.id::text, 1, 8)) AS ref_no,
          p.bill_date::text AS date,
          s.name AS party_name,
          s.id AS party_id,
          pi.quantity,
          pi.unit_price,
          pi.line_total,
          NULL::text AS document_type
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        -- Soft delete: exclude records where deleted_at is set
        LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.deleted_at IS NULL
        WHERE pi.item_id = $1 AND p.business_id = $2
      )
      SELECT * FROM combined
      WHERE 1=1 ${dateFilter}
      ORDER BY date DESC
      LIMIT $3
      `,
      [itemId, businessId, limit]
    );

    const summary = rows.reduce(
      (acc, r) => {
        if (r.type === 'invoice') {
          acc.sales_qty += Number(r.quantity || 0);
          acc.sales_amount += Number(r.line_total || 0);
          acc.sales_count += 1;
        } else {
          acc.purchase_qty += Number(r.quantity || 0);
          acc.purchase_amount += Number(r.line_total || 0);
          acc.purchase_count += 1;
        }
        return acc;
      },
      {
        sales_qty: 0,
        sales_amount: 0,
        sales_count: 0,
        purchase_qty: 0,
        purchase_amount: 0,
        purchase_count: 0,
      }
    );

    return NextResponse.json({ transactions: rows, summary });
  } catch (error: any) {
    console.error('Error fetching item transactions', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
