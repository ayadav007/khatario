import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { seedOpeningStockLayers } from '@/lib/seed-opening-stock-layers';
import { Item } from '@/types/database';
import { checkLimit } from '@/lib/subscription';
import { validateBarcode, normalizeBarcode } from '@/lib/barcode-validator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const search = searchParams.get('search') || '';
    const itemType = searchParams.get('item_type');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'items', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs for stock filtering
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    // If user has branch access, calculate branch-specific stock
    // Otherwise, use business-level current_stock
    let sql = '';
    const params: any[] = [businessId];
    
    if (accessibleBranchIds.length > 0) {
      // Sum branch_item_stock for branches the user can access (same source as invoice checks
      // when warehouse mode is off). Fall back to items.current_stock for legacy rows with no
      // branch_item_stock yet.
      sql = `
        SELECT 
          i.*,
          COALESCE(
            (SELECT SUM(bis.quantity)::numeric
             FROM branch_item_stock bis
             WHERE bis.business_id = i.business_id
               AND bis.item_id = i.id
               AND bis.branch_id = ANY($2::uuid[])),
            i.current_stock,
            0
          ) as current_stock
        FROM items i
        -- Soft delete: exclude records where deleted_at is set
        WHERE i.business_id = $1
          AND i.deleted_at IS NULL
          AND (i.is_active IS NULL OR i.is_active = true)
      `;
      params.push(accessibleBranchIds);
    } else {
      // No branch filtering - use business-level stock
      sql = `
        SELECT * FROM items 
        -- Soft delete: exclude records where deleted_at is set
        WHERE business_id = $1
          AND deleted_at IS NULL
          AND (is_active IS NULL OR is_active = true)
      `;
    }

    if (itemType) {
      sql += ` AND item_type = $${params.length + 1}`;
      params.push(itemType);
    }

    if (search) {
      sql += ` AND (name ILIKE $${params.length + 1} OR code ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    if (updatedAfter) {
      const tableRef = accessibleBranchIds.length > 0 ? 'i' : 'items';
      sql += ` AND ${tableRef}.updated_at >= $${params.length + 1}::timestamptz`;
      params.push(updatedAfter);
    }

    // Total row count: must NOT reuse the data SELECT (it contains $2 for branch UUID[] in a
    // subquery). Slice-based COUNT dropped that clause but still passed 2 params → PG bind error.
    const hasBranchScope = accessibleBranchIds.length > 0;
    const countRef = hasBranchScope ? 'i' : 'items';
    let countSql = hasBranchScope
      ? `SELECT COUNT(*)::integer AS total FROM items i WHERE i.business_id = $1 AND i.deleted_at IS NULL AND (i.is_active IS NULL OR i.is_active = true)`
      : `SELECT COUNT(*)::integer AS total FROM items WHERE business_id = $1 AND deleted_at IS NULL AND (is_active IS NULL OR is_active = true)`;
    const countParams: any[] = [businessId];
    let c = 2;
    if (itemType) {
      countSql += ` AND ${countRef}.item_type = $${c}`;
      countParams.push(itemType);
      c++;
    }
    if (search) {
      countSql += ` AND (${countRef}.name ILIKE $${c} OR ${countRef}.code ILIKE $${c})`;
      countParams.push(`%${search}%`);
      c++;
    }
    if (updatedAfter) {
      countSql += ` AND ${countRef}.updated_at >= $${c}::timestamptz`;
      countParams.push(updatedAfter);
    }
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const items = await queryRows<Item>(sql, params);
    return NextResponse.json({ 
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      name,
      code,
      barcode,
      barcode_type,
      unit = 'PCS',
      selling_price,
      purchase_price = 0,
      tax_rate = 0,
      hsn_sac,
      item_type = 'goods',
      opening_stock = 0,
      min_stock = 0,
      default_supplier_id,
      has_variants = false,
      variants = [],
      image_url,
      gst_included = false,
      mrp,
      // Retail compliance fields (migration 162)
      fssai_licence_no,
      net_quantity,
      country_of_origin,
      brand,
      // Weighed / PLU fields (migration 165)
      is_weighed = false,
      plu_code,
      weight_barcode_mode = 'weight',
      /** null = inherit business default; boolean = override */
      allow_sale_when_out_of_stock,
      created_by, // User ID who created the item
    } = body;

    if (!business_id || !name) {
      return NextResponse.json({ error: 'Name and Business ID are required' }, { status: 400 });
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce access boundary - reject attendance-only employees
    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(created_by, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    // AUTHORIZATION: Check create permission
    try {
      await authorize(created_by, 'items', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Validate barcode if provided
    let normalizedBarcode: string | null = null;
    let finalBarcodeType: string | null = null;
    
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
      
      // Check uniqueness within business
      const existing = await queryOne(
        'SELECT id, name FROM items WHERE barcode = $1 AND business_id = $2 AND deleted_at IS NULL',
        [normalizedBarcode, business_id]
      );
      
      if (existing) {
        return NextResponse.json(
          { error: `Barcode "${normalizedBarcode}" already exists for item "${existing.name}"` },
          { status: 400 }
        );
      }
    }

    // Validation: Services cannot have stock or variants
    if (item_type === 'service' && (opening_stock > 0 || min_stock > 0 || has_variants)) {
      return NextResponse.json(
        { error: 'Services cannot have stock or variants.' }, 
        { status: 400 }
      );
    }

    // Force values for services or items with variants
    const finalOpeningStock = (item_type === 'service' || has_variants) ? 0 : opening_stock;
    const finalMinStock = (item_type === 'service' || has_variants) ? 0 : min_stock;
    
    // Selling price is null for items with variants (prices are in variants)
    const finalSellingPrice = (item_type === 'service' || has_variants)
      ? (selling_price !== undefined && selling_price !== null && selling_price !== '' ? Number(selling_price) : null)
      : (Number(selling_price) || 0);

    // Check subscription limits before creating item
    const limitCheck = await checkLimit(business_id, 'items');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { 
          error: limitCheck.message || 'Item limit reached',
          limit: limitCheck.limit,
          current: limitCheck.current,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED'
        },
        { status: 403 }
      );
    }

    // Weighed-item sanity: PLU must be 4-5 digits, weight barcode mode must
    // be one of the known values. We coerce rather than fail here so the
    // form can keep old rows (which won't ship is_weighed) working.
    const normalizedPlu = plu_code
      ? String(plu_code).replace(/\D/g, '').slice(0, 5) || null
      : null;
    const normalizedWeightMode =
      weight_barcode_mode === 'price' ? 'price' : 'weight';

    const oversellOverride =
      allow_sale_when_out_of_stock === undefined
        ? null
        : Boolean(allow_sale_when_out_of_stock);

    const item = await queryOne<Item>(`
      INSERT INTO items (
        business_id, name, code, barcode, barcode_type, unit, selling_price, purchase_price, 
        tax_rate, hsn_sac, item_type, opening_stock, current_stock, min_stock, 
        default_supplier_id, has_variants, image_url, gst_included, mrp,
        fssai_licence_no, net_quantity, country_of_origin, brand,
        is_weighed, plu_code, weight_barcode_mode, allow_sale_when_out_of_stock
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
              $20, $21, $22, $23, $24, $25, $26, $27)
      RETURNING *
    `, [
      business_id, name, code || null, normalizedBarcode, finalBarcodeType, unit, 
      finalSellingPrice, purchase_price, tax_rate, hsn_sac || null, item_type, 
      finalOpeningStock, finalOpeningStock, finalMinStock,
      default_supplier_id || null, has_variants, image_url, gst_included || false, mrp || null,
      fssai_licence_no || null, net_quantity || null, country_of_origin || null, brand || null,
      !!is_weighed, normalizedPlu, normalizedWeightMode, oversellOverride
    ]);

    if (!item) throw new Error('Failed to create item');

    // Handle Variants
    if (has_variants && variants.length > 0) {
      console.log(`[Items API] Creating ${variants.length} variants for item ${item.id}`);
      
      for (const variant of variants) {
        try {
          // Validate variant barcode if provided
          let variantBarcode: string | null = null;
          let variantBarcodeType: string | null = null;
          
          if (variant.barcode) {
            variantBarcode = normalizeBarcode(variant.barcode);
            const validation = validateBarcode(variantBarcode, variant.barcode_type);
            
            if (!validation.isValid) {
              // Log error but don't fail entire item creation
              console.error(`Invalid barcode for variant ${variant.name}: ${validation.error}`);
              variantBarcode = null;
            } else {
              variantBarcodeType = validation.type || null;
              
              // Check variant barcode uniqueness within item
              try {
                const existingVariant = await queryOne(
                  'SELECT id FROM item_variants WHERE item_id = $1 AND barcode = $2',
                  [item.id, variantBarcode]
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
          
          const variantData = {
            item_id: item.id,
            variant_name: variant.name,
            sku: variant.sku,
            barcode: variantBarcode,
            barcode_type: variantBarcodeType,
            purchase_price: variant.purchase_price || purchase_price,
            selling_price: variant.selling_price || selling_price,
            opening_stock: variant.opening_stock || 0,
            attributes: variant.attributes || {}
          };
          
          console.log(`[Items API] Inserting variant:`, variantData);
          
          const insertParams = [
            item.id,
            variant.name,
            variant.sku || null,
            variantBarcode,
            variantBarcodeType,
            Number(variant.purchase_price) || Number(purchase_price) || 0,
            variant.selling_price ? Number(variant.selling_price) : (selling_price ? Number(selling_price) : null),
            Number(variant.opening_stock) || 0,
            Number(variant.opening_stock) || 0,
            JSON.stringify(variant.attributes || {})
          ];
          
          console.log(`[Items API] Insert params:`, insertParams);
          
          const insertResult = await query(`
            INSERT INTO item_variants (
              item_id, variant_name, sku, barcode, barcode_type, purchase_price, 
              selling_price, opening_stock, current_stock, attributes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, variant_name
          `, insertParams);
          
          console.log(`[Items API] Successfully created variant: ${variant.name}`, insertResult.rows[0]);

          if ((variant.opening_stock || 0) > 0) {
            await query(`
              INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, notes)
              VALUES ($1, $2, 'in', $3, 'adjustment', $4)
            `, [business_id, item.id, variant.opening_stock, `Opening Stock (Variant: ${variant.name})`]);
            const newVariantId = insertResult.rows[0]?.id as string | undefined;
            if (newVariantId) {
              await seedOpeningStockLayers(business_id, {
                itemId: item.id,
                quantity: Number(variant.opening_stock) || 0,
                variantId: newVariantId,
              });
            }
          }
        } catch (variantError: any) {
          console.error(`[Items API] Error creating variant ${variant.name}:`, {
            error: variantError,
            message: variantError?.message,
            code: variantError?.code,
            detail: variantError?.detail,
            stack: variantError?.stack,
            variant: variant
          });
          // Continue with other variants even if one fails
        }
      }
      
      // Verify variants were created
      try {
        const createdVariants = await queryRows(
          'SELECT id, variant_name FROM item_variants WHERE item_id = $1',
          [item.id]
        );
        console.log(`[Items API] Verified ${createdVariants.length} variants created for item ${item.id}`);
        
        if (createdVariants.length < variants.length) {
          console.error(`[Items API] WARNING: Only ${createdVariants.length} out of ${variants.length} variants were created!`);
        }
      } catch (verifyError) {
        console.error('[Items API] Error verifying variants:', verifyError);
      }
    } else if (finalOpeningStock > 0 && item_type === 'goods') {
      // Create initial stock movement for base item
      await query(`
        INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, notes)
        VALUES ($1, $2, 'in', $3, 'adjustment', 'Opening Stock')
      `, [business_id, item.id, finalOpeningStock]);
      await seedOpeningStockLayers(business_id, {
        itemId: item.id,
        quantity: finalOpeningStock,
      });
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
