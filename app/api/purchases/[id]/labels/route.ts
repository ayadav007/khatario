import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';

/**
 * GET /api/purchases/[id]/labels
 *
 * Returns one pre-filled label line per row of the purchase, merged with the
 * latest item_batches row tied to that purchase (when items.track_batch is
 * true) and the item's MRP. Powers the PrintLabelsModal on /purchases/[id].
 *
 * Response shape:
 *   {
 *     purchase: { id, bill_number, status, supplier_name, bill_date },
 *     lines: [
 *       {
 *         row_id: string,          // synthetic row id
 *         item_id: string,
 *         variant_id: string | null,
 *         batch_id: string | null,
 *         name: string,
 *         barcode: string | null,
 *         barcode_type: string | null,
 *         quantity: number,        // from purchase_items.quantity
 *         copies: number,          // initial = ceil(quantity)
 *         selling_price: number | null,
 *         mrp: number | null,
 *         batch_number: string | null,
 *         mfg_date: string | null,
 *         expiry_date: string | null,
 *         track_batch: boolean,
 *       }
 *     ]
 *   }
 */

export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    const businessId = getBusinessIdFromRequest(request);
    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    try {
      await authorize(userId, 'purchases', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_from_purchase');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return NextResponse.json(err.toResponse(), { status: 403 });
      }
      throw err;
    }

    const purchaseId = context.params.id;
    if (!purchaseId) {
      return NextResponse.json(
        { error: 'Purchase id required' },
        { status: 400 }
      );
    }

    const purchase = await queryOne<any>(
      `SELECT p.id, p.bill_number, p.status, p.bill_date,
              s.name AS supplier_name
         FROM purchases p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
      [purchaseId, businessId]
    );
    if (!purchase) {
      return NextResponse.json(
        { error: 'Purchase not found' },
        { status: 404 }
      );
    }

    const items = await queryRows<any>(
      `SELECT
         pi.id            AS purchase_item_id,
         pi.item_id,
         pi.variant_id,
         pi.item_name,
         pi.quantity,
         i.name           AS item_name_full,
         i.barcode        AS item_barcode,
         i.barcode_type   AS item_barcode_type,
         i.selling_price  AS item_selling_price,
         i.mrp            AS item_mrp,
         COALESCE(i.track_batch, FALSE) AS track_batch,
         v.variant_name,
         v.barcode        AS variant_barcode,
         v.barcode_type   AS variant_barcode_type,
         v.selling_price  AS variant_selling_price
       FROM purchase_items pi
       LEFT JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants v ON v.id = pi.variant_id
       WHERE pi.purchase_id = $1
       ORDER BY pi.id`,
      [purchaseId]
    );

    // For each line, find the latest matching batch tied to this purchase.
    const lines: any[] = [];
    for (const r of items) {
      let batch: any = null;
      if (r.item_id) {
        batch = await queryOne<any>(
          `SELECT id, batch_number, manufacturing_date, expiry_date
             FROM item_batches
            WHERE business_id = $1
              AND item_id = $2
              AND ($3::uuid IS NULL OR variant_id = $3 OR variant_id IS NULL)
              AND purchase_id = $4
            ORDER BY created_at DESC
            LIMIT 1`,
          [businessId, r.item_id, r.variant_id || null, purchaseId]
        );
      }

      const qty = Number(r.quantity || 0);
      const initialCopies = Math.max(1, Math.ceil(qty));
      const displayName = r.variant_name
        ? `${r.item_name_full || r.item_name} - ${r.variant_name}`
        : r.item_name_full || r.item_name;

      lines.push({
        row_id: r.purchase_item_id,
        item_id: r.item_id,
        variant_id: r.variant_id,
        batch_id: batch?.id || null,
        name: displayName,
        barcode: r.variant_barcode || r.item_barcode || null,
        barcode_type: r.variant_barcode_type || r.item_barcode_type || null,
        quantity: qty,
        copies: initialCopies,
        selling_price: numericOrNull(
          r.variant_selling_price ?? r.item_selling_price
        ),
        mrp: numericOrNull(r.item_mrp),
        batch_number: batch?.batch_number || null,
        mfg_date: batch?.manufacturing_date || null,
        expiry_date: batch?.expiry_date || null,
        track_batch: !!r.track_batch,
      });
    }

    return NextResponse.json({
      purchase: {
        id: purchase.id,
        bill_number: purchase.bill_number,
        status: purchase.status,
        supplier_name: purchase.supplier_name,
        bill_date: purchase.bill_date,
      },
      lines,
    });
  } catch (error: any) {
    console.error('[GET /api/purchases/[id]/labels] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load purchase labels' },
      { status: 500 }
    );
  }
}

function numericOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
