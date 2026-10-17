import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { BILL_ADDRESSED_TO_BUYER_SQL } from '@/lib/supplier-bills';

export const dynamic = 'force-dynamic';

/**
 * GET /api/purchases/incoming-bills?status=pending|received|all
 * Bills from connected suppliers addressed to the signed-in business. Only bills dated on or
 * after the link was approved (or raised against one of its requests) are listed, so bills it
 * already typed in by hand before connecting do not show up again. A bill whose number matches
 * a purchase already entered for that supplier is flagged as a possible duplicate.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'read', { businessId: auth.businessId });
    const status = new URL(request.url).searchParams.get('status') || 'pending';
    const statusSql =
      status === 'received' ? 'AND pur.id IS NOT NULL' : status === 'all' ? '' : 'AND pur.id IS NULL';

    const bills = await db.queryRows(
      `
      SELECT
        inv.id AS invoice_id, inv.invoice_number, inv.invoice_date, inv.grand_total,
        inv.business_id AS supplier_business_id, vb.name AS supplier_name, sup.id AS supplier_id,
        (SELECT COUNT(*)::int FROM invoice_items ii WHERE ii.invoice_id = inv.id) AS line_count,
        pur.id AS purchase_id, pur.bill_number AS purchase_bill_number,
        rc.status AS receipt_status, rc.received_at,
        EXISTS (
          SELECT 1 FROM purchases dup
          WHERE dup.business_id = $1 AND dup.supplier_id = sup.id
            AND dup.status <> 'cancelled'
            AND dup.source_invoice_id IS NULL
            AND UPPER(TRIM(dup.bill_number)) = UPPER(TRIM(inv.invoice_number))
        ) AS possible_duplicate
      FROM invoices inv
      JOIN businesses vb ON vb.id = inv.business_id
      JOIN LATERAL (
        SELECT s.id, s.approved_at FROM suppliers s
        WHERE s.business_id = $1 AND s.linked_business_id = inv.business_id
          AND s.approval_status = 'approved' AND s.deleted_at IS NULL
        ORDER BY s.approved_at DESC NULLS LAST
        LIMIT 1
      ) sup ON true
      LEFT JOIN LATERAL (
        SELECT p.id, p.bill_number FROM purchases p
        WHERE p.business_id = $1 AND p.source_invoice_id = inv.id AND p.status <> 'cancelled'
        LIMIT 1
      ) pur ON true
      LEFT JOIN supplier_bill_receipts rc ON rc.purchase_id = pur.id
      WHERE ${BILL_ADDRESSED_TO_BUYER_SQL}
        AND (
          sup.approved_at IS NULL
          OR inv.invoice_date >= sup.approved_at::date
          OR EXISTS (SELECT 1 FROM quantity_requests qr WHERE qr.invoice_id = inv.id)
        )
        ${statusSql}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      LIMIT 200
      `,
      [auth.businessId]
    );
    return NextResponse.json({ bills });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('incoming-bills GET', error);
    return NextResponse.json({ error: 'Failed to load incoming bills' }, { status: 500 });
  }
}
