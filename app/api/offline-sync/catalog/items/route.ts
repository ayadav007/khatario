import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

function labelBundleNames(rows: Record<string, unknown>[]) {
  return rows.map((it) => {
    if (!it?.is_bundle) return it;
    const base = String(it.name ?? '')
      .replace(/\s*\(Bundle\)\s*$/i, '')
      .trim();
    return { ...it, name: `${base} (Bundle)` };
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '500', 10), 500);
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after');
    const warehouseId = searchParams.get('warehouse_id');
    const branchId = searchParams.get('branch_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
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

    const useWarehouse = !!warehouseId;
    const useBranch = !useWarehouse && !!branchId && branchId !== 'ALL';

    let sql = '';
    const params: unknown[] = [];

    if (useWarehouse) {
      params.push(businessId, warehouseId);
      sql = `SELECT 
          i.id, i.name, i.code, i.barcode, i.unit,
          i.selling_price, i.purchase_price, i.tax_rate, i.hsn_sac,
          COALESCE(ls.current_stock_qty, i.current_stock, 0) as current_stock,
          i.item_type, i.image_url,
          COALESCE(i.has_variants, false) as has_variants,
          COALESCE(i.gst_included, false) as gst_included,
          COALESCE(i.is_bundle, false) as is_bundle,
          COALESCE(
            json_agg(
              json_build_object(
                'id', iv.id,
                'variant_name', iv.variant_name,
                'attributes', iv.attributes,
                'selling_price', iv.selling_price,
                'current_stock', COALESCE(lsv.current_stock_qty, iv.current_stock, 0),
                'sku', iv.sku,
                'barcode', iv.barcode
              )
            ) FILTER (WHERE iv.id IS NOT NULL),
            '[]'::json
          ) as variants
         FROM items i
         LEFT JOIN item_variants iv ON iv.item_id = i.id
         LEFT JOIN location_stock ls ON ls.item_id = i.id AND ls.location_id = $2 AND ls.variant_id IS NULL
         LEFT JOIN location_stock lsv ON lsv.item_id = i.id AND lsv.location_id = $2 AND lsv.variant_id = iv.id
         WHERE i.business_id = $1
           AND i.deleted_at IS NULL
           AND (i.is_active IS NULL OR i.is_active = true)`;
    } else if (useBranch) {
      params.push(businessId, branchId);
      sql = `SELECT 
          i.id, i.name, i.code, i.barcode, i.unit,
          i.selling_price, i.purchase_price, i.tax_rate, i.hsn_sac,
          COALESCE(
            (SELECT bis.quantity FROM branch_item_stock bis
             WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = $2::uuid),
            i.current_stock,
            0
          ) as current_stock,
          i.item_type, i.image_url,
          COALESCE(i.has_variants, false) as has_variants,
          COALESCE(i.gst_included, false) as gst_included,
          COALESCE(i.is_bundle, false) as is_bundle,
          COALESCE(
            json_agg(
              json_build_object(
                'id', iv.id,
                'variant_name', iv.variant_name,
                'attributes', iv.attributes,
                'selling_price', iv.selling_price,
                'current_stock', COALESCE(
                  (SELECT biv.quantity FROM branch_item_variant_stock biv
                   WHERE biv.business_id = i.business_id AND biv.item_variant_id = iv.id AND biv.branch_id = $2::uuid),
                  iv.current_stock,
                  0
                ),
                'sku', iv.sku,
                'barcode', iv.barcode
              )
            ) FILTER (WHERE iv.id IS NOT NULL),
            '[]'::json
          ) as variants
         FROM items i
         LEFT JOIN item_variants iv ON iv.item_id = i.id
         WHERE i.business_id = $1
           AND i.deleted_at IS NULL
           AND (i.is_active IS NULL OR i.is_active = true)`;
    } else {
      params.push(businessId);
      sql = `SELECT 
          i.id, i.name, i.code, i.barcode, i.unit,
          i.selling_price, i.purchase_price, i.tax_rate, i.hsn_sac,
          i.current_stock,
          i.item_type, i.image_url,
          COALESCE(i.has_variants, false) as has_variants,
          COALESCE(i.gst_included, false) as gst_included,
          COALESCE(i.is_bundle, false) as is_bundle,
          COALESCE(
            json_agg(
              json_build_object(
                'id', iv.id,
                'variant_name', iv.variant_name,
                'attributes', iv.attributes,
                'selling_price', iv.selling_price,
                'current_stock', iv.current_stock,
                'sku', iv.sku,
                'barcode', iv.barcode
              )
            ) FILTER (WHERE iv.id IS NOT NULL),
            '[]'::json
          ) as variants
         FROM items i
         LEFT JOIN item_variants iv ON iv.item_id = i.id
         WHERE i.business_id = $1
           AND i.deleted_at IS NULL
           AND (i.is_active IS NULL OR i.is_active = true)`;
    }

    if (updatedAfter) {
      sql += ` AND i.updated_at >= $${params.length + 1}::timestamptz`;
      params.push(updatedAfter);
    }

    sql += ` GROUP BY i.id` + (useWarehouse ? ', ls.current_stock_qty' : '');
    sql += ` ORDER BY i.name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    let countSql = `
      SELECT COUNT(*)::integer AS total FROM items i
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND (i.is_active IS NULL OR i.is_active = true)`;
    const countParams: unknown[] = [businessId];
    if (updatedAfter) {
      countSql += ` AND i.updated_at >= $2::timestamptz`;
      countParams.push(updatedAfter);
    }
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total ?? 0;

    let items = await queryRows<Record<string, unknown>>(sql, params);
    items = labelBundleNames(items);

    return NextResponse.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Catalog items sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
