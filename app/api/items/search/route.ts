import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { normalizeBarcode } from '@/lib/barcode-validator';

function labelBundleNames(rows: any[]) {
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
    let query = searchParams.get('q');
    const businessId = searchParams.get('business_id');
    const browse = searchParams.get('browse') === '1';
    const warehouseId = searchParams.get('warehouse_id'); // warehouse-specific stock (location_stock)
    const branchId = searchParams.get('branch_id'); // branch_item_stock / branch_item_variant_stock when no warehouse filter
    const limitRaw = searchParams.get('limit');
    const parsedLimit = parseInt(limitRaw || '50', 10);
    const searchLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 150) : 50;

    console.log('[ItemSearchAPI] Search called:', {
      query,
      businessId,
      warehouseId,
      branchId,
      browse,
      queryLength: query?.length,
      searchLimit,
    });

    if (!businessId) {
      console.log('[ItemSearchAPI] Missing businessId');
      return NextResponse.json({ items: [] });
    }

    /** Browse mode: recent catalogue (for mobile item picker) — no search text required. */
    if (browse) {
      const itemType = searchParams.get('item_type');
      const typeClause =
        itemType === 'goods'
          ? `AND (COALESCE(i.item_type::text, 'goods') = 'goods')`
          : itemType === 'service'
            ? `AND i.item_type = 'service'`
            : '';
      try {
        let browseItems = await queryRows<any>(
          `SELECT 
            i.id, i.name, i.code, i.barcode, i.unit,
            i.selling_price, i.purchase_price, i.tax_rate, i.hsn_sac, i.current_stock,
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
          AND (i.is_active IS NULL OR i.is_active = true)
          ${typeClause}
          GROUP BY i.id
          ORDER BY i.name ASC
          LIMIT ${searchLimit}`,
          [businessId],
        );
        browseItems = labelBundleNames(browseItems);
        return NextResponse.json({ items: browseItems });
      } catch (e) {
        console.warn('[ItemSearchAPI] browse primary failed, trying simple list', e);
        try {
          let browseItems = await queryRows<any>(
            `SELECT 
              i.id, i.name, i.code, i.barcode, i.unit,
              i.selling_price, i.purchase_price, i.tax_rate, i.hsn_sac, i.current_stock,
              i.item_type, i.image_url,
              COALESCE(i.has_variants, false) as has_variants,
              COALESCE(i.is_bundle, false) as is_bundle,
              '[]'::json as variants
            FROM items i
            WHERE i.business_id = $1
            AND i.deleted_at IS NULL
            AND (i.is_active IS NULL OR i.is_active = true)
            ${typeClause}
            ORDER BY i.name ASC
            LIMIT ${searchLimit}`,
            [businessId],
          );
          browseItems = labelBundleNames(browseItems);
          return NextResponse.json({ items: browseItems });
        } catch (e2) {
          console.error('[ItemSearchAPI] browse fallback failed', e2);
          return NextResponse.json({ items: [] });
        }
      }
    }

    if (!query) {
      console.log('[ItemSearchAPI] Missing query');
      return NextResponse.json({ items: [] });
    }

    // Normalize barcode for search (remove spaces, etc.) to match how barcodes are stored
    const normalizedQuery = normalizeBarcode(query);
    console.log('[ItemSearchAPI] Normalized query:', { original: query, normalized: normalizedQuery });

    // Search by name, code, or barcode
    // Handle NULL is_active values (items created before is_active column existed)
    // Include variants if item has_variants = true
    // Prioritize exact barcode matches
    // Check if item_variants table exists first
    let items;
    try {
      // Try query with variants (if table exists)
      // If warehouse_id is provided, get warehouse-specific stock from location_stock
      const useWarehouse = !!warehouseId;
      const useBranch = !useWarehouse && !!branchId;
      const params = useWarehouse
        ? [businessId, `%${query}%`, normalizedQuery, warehouseId]
        : useBranch
          ? [businessId, `%${query}%`, normalizedQuery, branchId]
          : [businessId, `%${query}%`, normalizedQuery];
      
      let sql = '';
      if (useWarehouse) {
        sql = `SELECT 
          i.id, 
          i.name, 
          i.code, 
          i.barcode,
          i.unit, 
          i.selling_price, 
          i.purchase_price, 
          i.tax_rate, 
          i.hsn_sac, 
          COALESCE(ls.current_stock_qty, i.current_stock, 0) as current_stock, 
          i.item_type, 
          i.image_url,
          i.has_variants,
          i.gst_included,
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
         LEFT JOIN location_stock ls ON ls.item_id = i.id AND ls.location_id = $4 AND ls.variant_id IS NULL
         LEFT JOIN location_stock lsv ON lsv.item_id = i.id AND lsv.location_id = $4 AND lsv.variant_id = iv.id`;
      } else if (useBranch) {
        sql = `SELECT 
          i.id, 
          i.name, 
          i.code, 
          i.barcode,
          i.unit, 
          i.selling_price, 
          i.purchase_price, 
          i.tax_rate, 
          i.hsn_sac, 
          COALESCE(
            (SELECT bis.quantity FROM branch_item_stock bis
             WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = $4::uuid),
            i.current_stock,
            0
          ) as current_stock, 
          i.item_type, 
          i.image_url,
          i.has_variants,
          i.gst_included,
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
                   WHERE biv.business_id = i.business_id AND biv.item_variant_id = iv.id AND biv.branch_id = $4::uuid),
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
         LEFT JOIN item_variants iv ON iv.item_id = i.id`;
      } else {
        sql = `SELECT 
          i.id, 
          i.name, 
          i.code, 
          i.barcode,
          i.unit, 
          i.selling_price, 
          i.purchase_price, 
          i.tax_rate, 
          i.hsn_sac, 
          i.current_stock, 
          i.item_type, 
          i.image_url,
          i.has_variants,
          i.gst_included,
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
         LEFT JOIN item_variants iv ON iv.item_id = i.id`;
      }
      
      sql += `
         WHERE i.business_id = $1 
         AND (
           i.name ILIKE $2 OR 
           i.code ILIKE $2 OR 
           i.barcode = $3 OR
           i.barcode ILIKE $2 OR
           EXISTS (
             SELECT 1 FROM item_variants iv2 
             WHERE iv2.item_id = i.id AND (iv2.barcode = $3 OR iv2.barcode ILIKE $2)
           )
         )
         AND i.deleted_at IS NULL
         AND (i.is_active IS NULL OR i.is_active = true)
         GROUP BY i.id` + (useWarehouse ? ', ls.current_stock_qty' : '') + `
         ORDER BY 
           CASE 
             WHEN i.barcode = $3 THEN 1
             WHEN i.barcode ILIKE $2 THEN 2
             WHEN EXISTS (SELECT 1 FROM item_variants iv3 WHERE iv3.item_id = i.id AND iv3.barcode = $3) THEN 3
             WHEN EXISTS (SELECT 1 FROM item_variants iv4 WHERE iv4.item_id = i.id AND iv4.barcode ILIKE $2) THEN 4
             ELSE 5
           END,
           i.name ASC
         LIMIT ${searchLimit}`;
      
      items = await queryRows<any>(sql, params);
    } catch (error: any) {
      // If item_variants table doesn't exist, use simpler query without variants
      if (error.code === '42P01' && error.message?.includes('item_variants')) {
        console.log('item_variants table not found, using simplified query');
        // Try query without has_variants column (it might not exist)
        // Fallback to using items.current_stock (global stock) instead of warehouse-specific
        try {
          items = await queryRows<any>(
            `SELECT 
              i.id, 
              i.name, 
              i.code, 
              i.barcode,
              i.unit, 
              i.selling_price, 
              i.purchase_price, 
              i.tax_rate, 
              i.hsn_sac, 
              i.current_stock, 
              i.item_type, 
              i.image_url,
              COALESCE(i.has_variants, false) as has_variants,
              COALESCE(i.is_bundle, false) as is_bundle,
              '[]'::json as variants
             FROM items i
             WHERE i.business_id = $1 
             AND (
               i.name ILIKE $2 OR 
               i.code ILIKE $2 OR 
               i.barcode = $3 OR
               i.barcode ILIKE $2
             )
             AND (i.is_active IS NULL OR i.is_active = true)
             ORDER BY 
               CASE 
                 WHEN i.barcode = $3 THEN 1
                 WHEN i.barcode ILIKE $2 THEN 2
                 ELSE 3
               END,
               i.name ASC
             LIMIT ${searchLimit}`,
            [businessId, `%${query}%`, normalizedQuery]
          );
        } catch (err2: any) {
          // If has_variants column also doesn't exist, use even simpler query
          if (err2.code === '42703' && err2.message?.includes('has_variants')) {
            console.log('has_variants column not found, using basic query');
            items = await queryRows<any>(
              `SELECT 
                i.id, 
                i.name, 
                i.code, 
                i.barcode,
                i.unit, 
                i.selling_price, 
                i.purchase_price, 
                i.tax_rate, 
                i.hsn_sac, 
                i.current_stock, 
                i.item_type, 
                i.image_url,
                false as has_variants,
                COALESCE(i.is_bundle, false) as is_bundle,
                '[]'::json as variants
               FROM items i
               WHERE i.business_id = $1 
               AND (
                 i.name ILIKE $2 OR 
                 i.code ILIKE $2 OR 
                 i.barcode = $3 OR
                 i.barcode ILIKE $2
               )
               AND (i.is_active IS NULL OR i.is_active = true)
               ORDER BY 
                 CASE 
                   WHEN i.barcode = $3 THEN 1
                   WHEN i.barcode ILIKE $2 THEN 2
                   ELSE 3
                 END,
                 i.name ASC
               LIMIT ${searchLimit}`,
              [businessId, `%${query}%`, normalizedQuery]
            );
          } else {
            throw err2;
          }
        }
      } else {
        throw error;
      }
    }

    items = labelBundleNames(items);

    console.log('[ItemSearchAPI] Search results:', items.length, 'items found');
    
    // Debug: Log first item structure if found
    if (items.length > 0) {
      console.log('[ItemSearchAPI] First item structure:', JSON.stringify(items[0], null, 2));
      console.log('[ItemSearchAPI] First item name:', items[0].name);
      console.log('[ItemSearchAPI] First item barcode:', items[0].barcode);
      console.log('[ItemSearchAPI] First item selling_price:', items[0].selling_price);
      console.log('[ItemSearchAPI] First item tax_rate:', items[0].tax_rate);
    } else {
      // Log when no items found - check if barcode exists in DB
      console.log('[ItemSearchAPI] No items found. Checking if barcode exists in database...');
      try {
        // Check with normalized barcode (exact match)
        const normalizedCheck = await queryRows<any>(
          `SELECT id, name, barcode, code FROM items 
           WHERE business_id = $1 AND deleted_at IS NULL AND barcode = $2 
           LIMIT 1`,
          [businessId, normalizedQuery]
        );
        console.log('[ItemSearchAPI] Exact normalized barcode match:', normalizedCheck.length > 0 ? 'FOUND' : 'NOT FOUND', normalizedCheck);
        
        // Also check with original query (in case barcode wasn't normalized in DB)
        const originalCheck = await queryRows<any>(
          `SELECT id, name, barcode, code FROM items 
           WHERE business_id = $1 AND deleted_at IS NULL AND barcode = $2 
           LIMIT 1`,
          [businessId, query]
        );
        console.log('[ItemSearchAPI] Exact original barcode match:', originalCheck.length > 0 ? 'FOUND' : 'NOT FOUND', originalCheck);
        
        // Check with ILIKE pattern
        const patternCheck = await queryRows<any>(
          `SELECT id, name, barcode, code FROM items 
           WHERE business_id = $1 AND deleted_at IS NULL AND barcode ILIKE $2 
           LIMIT 5`,
          [businessId, `%${query}%`]
        );
        console.log('[ItemSearchAPI] Pattern match check (ILIKE):', patternCheck.length, 'items found', patternCheck);
        
        // List all items with barcodes for this business (for debugging)
        const allBarcodes = await queryRows<any>(
          `SELECT id, name, barcode, code FROM items 
           WHERE business_id = $1 AND deleted_at IS NULL AND barcode IS NOT NULL AND barcode != ''
           ORDER BY name ASC
           LIMIT 10`,
          [businessId]
        );
        console.log('[ItemSearchAPI] All items with barcodes in this business:', allBarcodes.length, allBarcodes.map(i => ({ name: i.name, barcode: i.barcode, code: i.code })));
      } catch (err) {
        console.error('[ItemSearchAPI] Error checking barcode:', err);
      }
    }
    
    return NextResponse.json({ items });
  } catch (error: any) {
    console.error('Item search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

