export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { formatStockQuantity } from '@/lib/quantity-display';
import { stockMovementPresentation } from '@/lib/stock-movement-label';

/**
 * GET /api/items/[id]/movements
 * Why the stock quantity is what it is: purchases, sales, returns, and damage.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const itemId = params.id;
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      await authorize(userId, 'items', 'read', { businessId: tenant.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const rows = await queryRows<{
      id: string;
      movement_date: string;
      type: string;
      quantity: string;
      reference_type: string | null;
      reference_id: string | null;
      notes: string | null;
      unit: string | null;
      pack_size: number | null;
      pack_unit: string | null;
      document_number: string | null;
      reason_code: string | null;
    }>(
      `SELECT sm.id,
              sm.created_at AS movement_date,
              sm.type,
              sm.quantity,
              sm.reference_type,
              sm.reference_id,
              COALESCE(
                ia.reason_notes,
                sm.notes
              ) AS notes,
              i.unit,
              i.pack_size,
              i.pack_unit,
              COALESCE(
                inv.invoice_number,
                pur.bill_number,
                cn.credit_note_number,
                dn.debit_note_number,
                pr.return_number,
                st.transfer_number,
                ia.adjustment_number
              ) AS document_number,
              ia.reason_code
         FROM stock_movements sm
         JOIN items i ON i.id = sm.item_id AND i.business_id = sm.business_id
         LEFT JOIN invoices inv
           ON sm.reference_type IN ('invoice', 'sale', 'invoice_cancel')
          AND inv.id = sm.reference_id AND inv.business_id = sm.business_id
         LEFT JOIN purchases pur
           ON sm.reference_type IN ('purchase', 'purchase_cancel')
          AND pur.id = sm.reference_id AND pur.business_id = sm.business_id
         LEFT JOIN credit_notes cn
           ON sm.reference_type IN ('credit_note', 'credit_note_cancel')
          AND cn.id = sm.reference_id AND cn.business_id = sm.business_id
         LEFT JOIN debit_notes dn
           ON sm.reference_type = 'debit_note'
          AND dn.id = sm.reference_id AND dn.business_id = sm.business_id
         LEFT JOIN purchase_returns pr
           ON sm.reference_type = 'purchase_return'
          AND pr.id = sm.reference_id AND pr.business_id = sm.business_id
         LEFT JOIN stock_transfers st
           ON sm.reference_type = 'stock_transfer'
          AND st.id = sm.reference_id AND st.business_id = sm.business_id
         LEFT JOIN inventory_adjustments ia
           ON sm.reference_type = 'adjustment'
          AND ia.id = sm.reference_id AND ia.business_id = sm.business_id
        WHERE sm.business_id = $1 AND sm.item_id = $2
        ORDER BY sm.created_at DESC
        LIMIT 50`,
      [tenant.businessId, itemId],
    );

    const movements = rows.map((row) => {
      const raw = Number(row.quantity) || 0;
      const signed = row.type === 'out' ? -Math.abs(raw) : row.type === 'in' ? Math.abs(raw) : raw;
      const presentation = stockMovementPresentation({
        referenceType: row.reference_type,
        reasonCode: row.reason_code,
        documentNumber: row.document_number,
        referenceId: row.reference_id,
      });
      return {
        id: row.id,
        movement_date: row.movement_date,
        label: presentation.label,
        document_number: presentation.documentNumber,
        href: presentation.href,
        notes: row.notes,
        signed_quantity: signed,
        quantity_label: formatStockQuantity(Math.abs(signed), row.unit, row.pack_size, row.pack_unit),
      };
    });

    return NextResponse.json({ movements });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching item stock movements:', error);
    return NextResponse.json({ error: 'Failed to load stock history', details: message }, { status: 500 });
  }
}
