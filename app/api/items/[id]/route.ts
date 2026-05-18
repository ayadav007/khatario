import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, queryRows, getPool } from '@/lib/db';
import { validateBundleComponentItems } from '@/lib/bundle-items-validation';
import { Item } from '@/types/database';
import { validateBarcode, normalizeBarcode } from '@/lib/barcode-validator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    const businessId = getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
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
      'SELECT * FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [itemId, businessId]
    );

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'items', 'read', { businessId: item.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch variants if item has variants
    let variants: any[] = [];
    if (item.has_variants) {
      try {
        const variantRows = await queryRows(
          `SELECT id, variant_name, sku, barcode, barcode_type, purchase_price, 
                  selling_price, opening_stock, current_stock, attributes
           FROM item_variants 
           WHERE item_id = $1 
           ORDER BY variant_name`,
          [itemId]
        );
        console.log(`[Items API] Found ${variantRows.length} variants for item ${itemId}`);
        variants = variantRows.map((v: any) => ({
          id: v.id,
          name: v.variant_name,
          sku: v.sku || '',
          barcode: v.barcode || '',
          barcode_type: v.barcode_type || '',
          purchase_price: v.purchase_price?.toString() || '',
          selling_price: v.selling_price?.toString() || '',
          opening_stock: v.opening_stock?.toString() || '0',
          attributes: v.attributes || {}
        }));
      } catch (error) {
        console.error('[Items API] Error fetching variants:', error);
        // If variants table doesn't exist, just return empty array
        variants = [];
      }
    } else {
      console.log(`[Items API] Item ${itemId} does not have variants (has_variants = ${item.has_variants})`);
    }

    return NextResponse.json({ item, variants, variantCount: variants.length });
  } catch (error: any) {
    console.error('Error fetching item', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    const body = await request.json();
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    const { user_id, updated_by, ...updateData } = body;
    const userId = getUserIdFromRequest(request, body) || updated_by;

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id or updated_by is required for authorization' },
        { status: 400 }
      );
    }

    // Get item first to check business_id
    const existingItem = await queryOne<Item>(
      'SELECT * FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [itemId, businessId]
    );

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // AUTHORIZATION: Check update permission
    try {
      await authorize(userId, 'items', 'update', { 
        businessId: existingItem.business_id,
        resourceId: itemId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const {
      name,
      code,
      barcode,
      barcode_type,
      unit,
      selling_price,
      purchase_price,
      tax_rate,
      hsn_sac,
      item_type,
      min_stock,
      description,
      default_supplier_id,
      image_url,
      has_variants,
      is_bundle: patchIsBundle,
      bundle_components,
      gst_included,
      // Retail compliance fields (migration 162)
      fssai_licence_no,
      net_quantity,
      country_of_origin,
      brand,
      // Weighed / PLU fields (migration 165)
      is_weighed,
      plu_code,
      weight_barcode_mode,
      allow_sale_when_out_of_stock,
      variants = []
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const bundleFlagProvided = Object.prototype.hasOwnProperty.call(body, 'is_bundle');
    const rawBundleActive =
      bundleFlagProvided && patchIsBundle !== undefined
        ? !!patchIsBundle
        : !!(existingItem as { is_bundle?: boolean }).is_bundle;

    const finalHasVariants = rawBundleActive
      ? false
      : has_variants !== undefined
        ? !!has_variants
        : !!existingItem.has_variants;

    if (patchIsBundle && has_variants) {
      return NextResponse.json(
        {
          error: 'A bundle cannot have product variants.',
          code: 'BUNDLE_VARIANT_CONFLICT',
        },
        { status: 400 }
      );
    }

    // Validate barcode if provided
    let normalizedBarcode: string | null = null;
    let finalBarcodeType: string | null = null;
    
    if (barcode !== undefined) {
      if (barcode) {
        normalizedBarcode = normalizeBarcode(barcode);
        const validation = validateBarcode(normalizedBarcode, barcode_type);
        
        if (!validation.isValid) {
          return NextResponse.json(
            { error: validation.error || 'Invalid barcode format' },
            { status: 400 }
          );
        }
        
        finalBarcodeType = validation.type || null;
        
        // Check uniqueness within business (excluding current item)
        const existing = await queryOne(
          'SELECT id, name FROM items WHERE barcode = $1 AND business_id = $2 AND deleted_at IS NULL AND id != $3',
          [normalizedBarcode, businessId, itemId]
        );
        
        if (existing) {
          return NextResponse.json(
            { error: `Barcode "${normalizedBarcode}" already exists for item "${existing.name}"` },
            { status: 400 }
          );
        }
      } else {
        // barcode is explicitly set to empty/null
        normalizedBarcode = null;
        finalBarcodeType = null;
      }
    }

    // Handle selling_price for services or items with variants
    const finalSellingPrice = (item_type === 'service' || finalHasVariants)
      ? (selling_price !== undefined && selling_price !== null && selling_price !== '' ? Number(selling_price) : null)
      : (Number(selling_price) || 0);

    // Normalize weighed-item fields so bad/unset values don't blow up the
    // CHECK constraint on weight_barcode_mode.
    const normalizedPlu =
      plu_code === undefined
        ? undefined
        : plu_code
        ? String(plu_code).replace(/\D/g, '').slice(0, 5) || null
        : null;
    const normalizedWeightMode =
      weight_barcode_mode === 'price' ? 'price' : 'weight';

    const oversellOverride =
      allow_sale_when_out_of_stock === undefined
        ? undefined
        : allow_sale_when_out_of_stock === null
          ? null
          : Boolean(allow_sale_when_out_of_stock);
    const patchOversellPolicy = Object.prototype.hasOwnProperty.call(body, 'allow_sale_when_out_of_stock');

    // Build UPDATE query dynamically based on whether barcode is being updated
    let updateQuery: string;
    let updateParams: any[];
    
    if (barcode !== undefined) {
      updateQuery = `UPDATE items 
       SET name = $3, code = $4, barcode = $5, barcode_type = $6, unit = $7, selling_price = $8, purchase_price = $9,
           tax_rate = $10, hsn_sac = $11, item_type = $12, min_stock = $13, description = $14,
           default_supplier_id = $15, image_url = $16, has_variants = $17, gst_included = $18,
           fssai_licence_no = $19, net_quantity = $20, country_of_origin = $21, brand = $22,
           is_weighed = $23, plu_code = $24, weight_barcode_mode = $25${
             patchOversellPolicy ? ', allow_sale_when_out_of_stock = $26' : ''
           },
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2
       RETURNING *`;
      updateParams = [
        itemId, businessId, name, code || null, normalizedBarcode, finalBarcodeType, unit || 'PCS',
        finalSellingPrice, purchase_price || 0, tax_rate || 0,
        hsn_sac || null, item_type || 'goods', min_stock || 0, description || null,
        default_supplier_id || null, image_url, finalHasVariants, gst_included ?? false,
        fssai_licence_no || null, net_quantity || null, country_of_origin || null, brand || null,
        !!is_weighed, normalizedPlu ?? null, normalizedWeightMode,
        ...(patchOversellPolicy ? [oversellOverride] : []),
      ];
    } else {
      updateQuery = `UPDATE items 
       SET name = $3, code = $4, unit = $5, selling_price = $6, purchase_price = $7,
           tax_rate = $8, hsn_sac = $9, item_type = $10, min_stock = $11, description = $12,
           default_supplier_id = $13, image_url = $14, has_variants = $15, gst_included = $16,
           fssai_licence_no = $17, net_quantity = $18, country_of_origin = $19, brand = $20,
           is_weighed = $21, plu_code = $22, weight_barcode_mode = $23${
             patchOversellPolicy ? ', allow_sale_when_out_of_stock = $24' : ''
           },
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2
       RETURNING *`;
      updateParams = [
        itemId, businessId, name, code || null, unit || 'PCS',
        finalSellingPrice, purchase_price || 0, tax_rate || 0,
        hsn_sac || null, item_type || 'goods', min_stock || 0, description || null,
        default_supplier_id || null, image_url, finalHasVariants, gst_included ?? false,
        fssai_licence_no || null, net_quantity || null, country_of_origin || null, brand || null,
        !!is_weighed, normalizedPlu ?? null, normalizedWeightMode,
        ...(patchOversellPolicy ? [oversellOverride] : []),
      ];
    }

    const item = await queryOne<Item>(updateQuery, updateParams);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Bundle (combo): clear or replace components
    if (bundleFlagProvided && patchIsBundle === false) {
      await query('DELETE FROM bundle_items WHERE bundle_id = $1', [itemId]);
      await query(
        `UPDATE items SET is_bundle = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
        [itemId, businessId]
      );
    }

    if (bundleFlagProvided && patchIsBundle === true && Array.isArray(bundle_components)) {
      const comps = bundle_components as { item_id: string; quantity: number | string }[];
      if (comps.length < 1) {
        return NextResponse.json(
          { error: 'Bundle must include at least one component item' },
          { status: 400 }
        );
      }
      for (const c of comps) {
        const q = Number(c.quantity);
        if (!c.item_id || !(q > 0)) {
          return NextResponse.json(
            { error: 'Each component needs item_id and quantity greater than 0' },
            { status: 400 }
          );
        }
      }
      const ids = comps.map((c) => c.item_id);
      const compCheck = await validateBundleComponentItems(businessId, ids);
      if (!compCheck.ok) {
        return NextResponse.json(
          { error: compCheck.error, code: compCheck.code },
          { status: 400 }
        );
      }

      await query('DELETE FROM item_variants WHERE item_id = $1', [itemId]);

      const pool = getPool();
      const bc = await pool.connect();
      try {
        await bc.query('BEGIN');
        await bc.query('DELETE FROM bundle_items WHERE bundle_id = $1', [itemId]);
        for (const row of comps) {
          await bc.query(
            `INSERT INTO bundle_items (bundle_id, item_id, quantity) VALUES ($1, $2, $3)`,
            [itemId, row.item_id, Number(row.quantity)]
          );
        }
        await bc.query(
          `UPDATE items SET is_bundle = true, has_variants = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
          [itemId, businessId]
        );
        await bc.query('COMMIT');
      } catch (e) {
        await bc.query('ROLLBACK');
        throw e;
      } finally {
        bc.release();
      }
    }

    // Handle Variants Update
    if (finalHasVariants && variants.length > 0) {
      // For simplicity in PATCH, we'll replace variants or update existing ones
      // A more robust way would be to sync them, but for now we'll delete and re-insert
      // if it's a small number of variants.
      await query('DELETE FROM item_variants WHERE item_id = $1', [itemId]);
      
      for (const variant of variants) {
        // Validate variant barcode if provided
        let variantBarcode: string | null = null;
        let variantBarcodeType: string | null = null;
        
        if (variant.barcode) {
          variantBarcode = normalizeBarcode(variant.barcode);
          const validation = validateBarcode(variantBarcode, variant.barcode_type);
          
          if (!validation.isValid) {
            console.error(`Invalid barcode for variant ${variant.name}: ${validation.error}`);
            variantBarcode = null;
          } else {
            variantBarcodeType = validation.type || null;
            
            // Check variant barcode uniqueness within item
            try {
              const existingVariant = await queryOne(
                'SELECT id FROM item_variants WHERE item_id = $1 AND barcode = $2 AND id != COALESCE($3, \'00000000-0000-0000-0000-000000000000\'::uuid)',
                [itemId, variantBarcode, variant.id]
              );
              
              if (existingVariant) {
                console.error(`Duplicate barcode for variant ${variant.name}`);
                variantBarcode = null;
                variantBarcodeType = null;
              }
            } catch (err) {
              // Table might not exist yet, ignore
              console.warn('Could not check variant barcode uniqueness:', err);
            }
          }
        }
        
        await query(`
          INSERT INTO item_variants (
            item_id, variant_name, sku, barcode, barcode_type, purchase_price, 
            selling_price, opening_stock, current_stock, attributes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          itemId,
          variant.name,
          variant.sku,
          variantBarcode,
          variantBarcodeType,
          variant.purchase_price || purchase_price,
          variant.selling_price || selling_price,
          variant.opening_stock || 0,
          variant.opening_stock || 0,
          JSON.stringify(variant.attributes || {})
        ]);
      }
    }

    const refreshed = await queryOne<Item>(
      'SELECT * FROM items WHERE id = $1 AND business_id = $2',
      [itemId, businessId]
    );

    return NextResponse.json({ item: refreshed || item });
  } catch (error: any) {
    console.error('Error updating item', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    let body: Record<string, unknown> | undefined;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    const userId =
      getUserIdFromRequest(request, body) ||
      (body && ((body.deleted_by as string) || undefined));
    
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get item first to check business_id
    const existingItem = await queryOne<Item>(
      'SELECT * FROM items WHERE id = $1 AND business_id = $2',
      [itemId, businessId]
    );

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // AUTHORIZATION: Check delete permission
    try {
      await authorize(userId, 'items', 'delete', { 
        businessId: existingItem.business_id,
        resourceId: itemId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Soft delete: set deleted_at (idempotent)
    await query(
      `UPDATE items
       SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [itemId, businessId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting item', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

