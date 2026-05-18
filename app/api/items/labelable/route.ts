import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
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
 * GET /api/items/labelable
 *
 * Returns a flattened list of every printable barcode source the current
 * business has — both top-level items with a barcode and any child
 * `item_variants` row with its own barcode. Powers the bulk
 * `/items/barcodes` page so variants get distinct rows.
 *
 * Response shape:
 *   {
 *     entries: [
 *       {
 *         row_id: string,            // synthetic id (item or variant)
 *         item_id: string,
 *         variant_id: string | null,
 *         name: string,              // "Parle G" or "Parle G - 100g"
 *         code: string | null,
 *         barcode: string,
 *         barcode_type: BarcodeType | null,
 *         selling_price: number | null,
 *         mrp: number | null,
 *         current_stock: number | null,
 *         unit: string | null,
 *         item_type: 'goods'|'service'|null
 *       }
 *     ]
 *   }
 */

export async function GET(request: NextRequest) {
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
      await authorize(userId, 'items', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_printing');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return NextResponse.json(err.toResponse(), { status: 403 });
      }
      throw err;
    }

    // Top-level items. Includes weighed items (PLU-based) even without a
    // stored barcode, since the printer generates the variable-measure EAN-13
    // on the fly from plu_code + weight/price at print time.
    const itemRows = await queryRows<any>(
      `SELECT
         i.id              AS item_id,
         i.name,
         i.code,
         i.barcode,
         i.barcode_type,
         i.selling_price,
         i.mrp,
         i.current_stock,
         i.unit,
         i.item_type,
         i.has_variants,
         i.is_weighed,
         i.plu_code,
         i.weight_barcode_mode
       FROM items i
       WHERE i.business_id = $1
         AND i.deleted_at IS NULL
         AND COALESCE(i.is_active, TRUE) = TRUE
         AND (
           (i.barcode IS NOT NULL AND TRIM(i.barcode) <> '')
           OR (i.is_weighed = TRUE AND i.plu_code IS NOT NULL AND TRIM(i.plu_code) <> '')
         )
       ORDER BY i.name ASC`,
      [businessId]
    );

    const variantRows = await queryRows<any>(
      `SELECT
         v.id              AS variant_id,
         v.item_id         AS item_id,
         v.variant_name,
         v.sku,
         v.barcode,
         v.barcode_type,
         v.selling_price,
         v.current_stock,
         i.name            AS parent_name,
         i.mrp             AS parent_mrp,
         i.unit            AS parent_unit,
         i.item_type       AS parent_item_type
       FROM item_variants v
       JOIN items i ON i.id = v.item_id
       WHERE i.business_id = $1
         AND i.deleted_at IS NULL
         AND COALESCE(i.is_active, TRUE) = TRUE
         AND v.barcode IS NOT NULL
         AND TRIM(v.barcode) <> ''
       ORDER BY i.name ASC, v.variant_name ASC`,
      [businessId]
    );

    const entries: any[] = [];

    for (const r of itemRows) {
      entries.push({
        row_id: `item:${r.item_id}`,
        item_id: r.item_id,
        variant_id: null,
        name: r.name,
        code: r.code,
        barcode: r.barcode,
        barcode_type: r.barcode_type,
        selling_price: numericOrNull(r.selling_price),
        mrp: numericOrNull(r.mrp),
        current_stock: numericOrNull(r.current_stock),
        unit: r.unit,
        item_type: r.item_type,
        is_weighed: !!r.is_weighed,
        plu_code: r.plu_code || null,
        weight_barcode_mode:
          r.weight_barcode_mode === 'price' ? 'price' : 'weight',
      });
    }
    for (const v of variantRows) {
      entries.push({
        row_id: `variant:${v.variant_id}`,
        item_id: v.item_id,
        variant_id: v.variant_id,
        name: `${v.parent_name} - ${v.variant_name}`,
        code: v.sku,
        barcode: v.barcode,
        barcode_type: v.barcode_type,
        selling_price: numericOrNull(v.selling_price),
        mrp: numericOrNull(v.parent_mrp),
        current_stock: numericOrNull(v.current_stock),
        unit: v.parent_unit,
        item_type: v.parent_item_type,
      });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ entries });
  } catch (error: any) {
    console.error('[GET /api/items/labelable] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load printable items' },
      { status: 500 }
    );
  }
}

function numericOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
