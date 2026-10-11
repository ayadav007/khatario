import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock-requests/reorder-suggestions
 * Buyer items at or below minimum stock whose default supplier is a linked business,
 * and which do not already have a pending quantity request.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const rows = await db.queryRows(
      `
      SELECT
        i.id AS item_id,
        i.name AS item_name,
        i.code AS item_code,
        i.current_stock,
        i.min_stock,
        i.unit,
        s.id AS supplier_id,
        s.name AS supplier_name,
        s.linked_business_id
      FROM items i
      JOIN suppliers s
        ON s.id = i.default_supplier_id
       AND s.business_id = i.business_id
       AND s.deleted_at IS NULL
       AND s.linked_business_id IS NOT NULL
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND i.is_active = true
        AND COALESCE(i.item_type, 'goods') <> 'service'
        AND COALESCE(i.has_variants, false) = false
        AND COALESCE(i.min_stock, 0) > 0
        AND COALESCE(i.current_stock, 0) <= i.min_stock
        AND NOT EXISTS (
          SELECT 1
          FROM quantity_requests qr
          WHERE qr.item_id = i.id
            AND qr.status = 'pending'
            AND (
              (qr.requester_business_id = $1 AND qr.responder_business_id = s.linked_business_id)
              OR (qr.responder_business_id = $1 AND qr.requester_business_id = s.linked_business_id)
            )
        )
      ORDER BY (i.min_stock - COALESCE(i.current_stock, 0)) DESC, i.name
      LIMIT 50
      `,
      [auth.businessId]
    );

    return NextResponse.json({
      suggestions: rows.map((row: any) => {
        const current = Number(row.current_stock || 0);
        const min = Number(row.min_stock || 0);
        return {
          item_id: row.item_id,
          item_name: row.item_name,
          item_code: row.item_code,
          current_stock: current,
          min_stock: min,
          unit: row.unit || 'PCS',
          shortage: Math.max(0, min - current),
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          linked_business_id: row.linked_business_id,
        };
      }),
    });
  } catch (error: any) {
    console.error('Error fetching reorder suggestions:', error);
    return NextResponse.json(
      { error: 'Failed to load low-stock suggestions', details: error.message },
      { status: 500 }
    );
  }
}
