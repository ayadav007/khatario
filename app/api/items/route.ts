import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';
import { seedOpeningStockLayers } from '@/lib/seed-opening-stock-layers';
import { Item } from '@/types/database';
import { checkLimitInTransaction } from '@/lib/subscription';
import { validateBarcode, normalizeBarcode } from '@/lib/barcode-validator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import {
  requirePlatformModule,
  platformModuleErrorResponse,
} from '@/lib/security/require-platform-module';
import { noteShopChanged } from '@/lib/rag/tenant-reindex';
import { isOwnSupplier } from '@/lib/supplier-hub-links';
import { readPaymentIdempotencyKey } from '@/lib/accounting/payment-idempotency';
import {
  ITEM_CREATE_IDEMPOTENCY_ACTION,
  findItemCreateOutcome,
  itemCreateFingerprint,
  itemIdempotencyErrorBody,
  scopedItemCreateKey,
  type ItemCreateIdempotencyOutcome,
} from '@/lib/items/item-create-idempotency';
import { insertReplayLogPending, markReplayCompleted } from '@/lib/offline-sync/replay-log-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;
    const search = searchParams.get('search') || '';
    const itemType = searchParams.get('item_type');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after');
    // Opt-in: only items the online store sells (the same rule as saving an item: show or featured).
    const storeOnly = searchParams.get('store_only') === '1';

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'items', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await requirePlatformModule(businessId, 'billing', 'items');
    } catch (error) {
      const denied = platformModuleErrorResponse(error);
      if (denied) return denied;
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
          ) as current_stock,
          COALESCE(
            (SELECT SUM(sr.quantity)::numeric
             FROM stock_reservations sr
             WHERE sr.business_id = i.business_id
               AND sr.item_id = i.id
               AND sr.status = 'active'
               AND (sr.expires_at IS NULL OR sr.expires_at > CURRENT_TIMESTAMP)),
            0
          ) as reserved_qty
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
        SELECT
          items.*,
          COALESCE(
            (SELECT SUM(sr.quantity)::numeric
             FROM stock_reservations sr
             WHERE sr.business_id = items.business_id
               AND sr.item_id = items.id
               AND sr.status = 'active'
               AND (sr.expires_at IS NULL OR sr.expires_at > CURRENT_TIMESTAMP)),
            0
          ) as reserved_qty
        FROM items
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

    if (storeOnly) {
      const tableRef = accessibleBranchIds.length > 0 ? 'i' : 'items';
      sql += ` AND ${tableRef}.show_in_store = true`;
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
    if (storeOnly) {
      countSql += ` AND ${countRef}.show_in_store = true`;
    }
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const items = await queryRows<Item & { reserved_qty?: number | string }>(sql, params);
    const withAvailable = items.map((item) => {
      const onHand = Number(item.current_stock) || 0;
      const reserved = Number(item.reserved_qty) || 0;
      return {
        ...item,
        reserved_qty: reserved,
        available_stock: onHand - reserved,
      };
    });
    return NextResponse.json({ 
      items: withAvailable,
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
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const business_id = session.businessId;
    const created_by = session.userId;
    const body = await request.json();
    const {
      name,
      code,
      barcode,
      barcode_type,
      unit = 'PCS',
      pack_size,
      pack_unit,
      selling_price,
      purchase_price = 0,
      tax_rate = 0,
      hsn_sac,
      item_type = 'goods',
      stock_class,
      opening_stock = 0,
      min_stock = 0,
      default_supplier_id,
      category_id,
      has_variants = false,
      variants = [],
      image_url,
      gallery_urls,
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
      custom_fields,
      show_in_store,
      featured_in_store,
      seo_title,
      seo_description,
      seo_image_url,
      /** Scan & Add: provider whose suggestion the shopkeeper accepted. Its source is read from our own cache. */
      lookup_source,
      /** Scan & Add: batch code and dates printed on the stock being entered as opening stock. */
      opening_batch,
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const { normalizeOpeningBatch } = await import('@/lib/items/opening-batch');
    const openingBatch = normalizeOpeningBatch(opening_batch);
    if (openingBatch && 'error' in openingBatch) {
      return NextResponse.json({ error: openingBatch.error, code: 'INVALID_BATCH' }, { status: 400 });
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
      await authorize(created_by, 'items', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Optional retry key (X-Idempotency-Key). A retry of a save that already went through gets the
    // same item back instead of a duplicate item or a second opening-stock posting.
    const idemKey = readPaymentIdempotencyKey(request);
    if (!idemKey.ok) return NextResponse.json(idemKey.body, { status: 400 });
    const idem = idemKey.key
      ? { scopedKey: scopedItemCreateKey(idemKey.key), ...itemCreateFingerprint(body) }
      : null;
    const idemResponse = async (outcome: ItemCreateIdempotencyOutcome) => {
      if (outcome.kind !== 'replay') {
        return NextResponse.json(itemIdempotencyErrorBody(outcome.kind), { status: 409 });
      }
      const replayed = outcome.item as unknown as Item;
      if (replayed.item_type === 'goods') {
        // Re-running is safe: the opening voucher is replaced, not added.
        const { syncItemOpeningStockLedger } = await import('@/lib/inventory/opening-stock-ledger');
        await syncItemOpeningStockLedger(business_id, replayed.id).catch((e) =>
          console.error('Error re-syncing opening stock ledger on replay:', e)
        );
      }
      return NextResponse.json({ item: replayed, idempotent: true }, { status: 200 });
    };
    if (idem) {
      const prior = await findItemCreateOutcome(getPool(), {
        businessId: business_id,
        scopedKey: idem.scopedKey,
        hash: idem.hash,
      });
      if (prior) return idemResponse(prior);
    }

    if (featured_in_store) {
      const { canEnableStoreFeatured, countStoreFeaturedItems, featuredLimitMessage } = await import(
        '@/lib/store/store-featured'
      );
      const count = await countStoreFeaturedItems(business_id);
      if (!canEnableStoreFeatured({ alreadyFeatured: false, currentFeaturedCount: count })) {
        return NextResponse.json(
          { error: featuredLimitMessage(), code: 'FEATURED_LIMIT' },
          { status: 409 },
        );
      }
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

    if (default_supplier_id && !(await isOwnSupplier(business_id, String(default_supplier_id)))) {
      return NextResponse.json({ error: 'Default supplier was not found in your suppliers' }, { status: 400 });
    }

    // Validation: Services cannot have stock or variants
    if (item_type === 'service' && (opening_stock > 0 || min_stock > 0 || has_variants)) {
      return NextResponse.json(
        { error: 'Services cannot have stock or variants.' }, 
        { status: 400 }
      );
    }

    const { gstRateError } = await import('@/lib/gst/rates');
    const rateError = gstRateError(tax_rate);
    if (rateError) {
      return NextResponse.json({ error: rateError, code: 'INVALID_GST_RATE' }, { status: 400 });
    }
    const hsnClean = hsn_sac ? String(hsn_sac).replace(/\s/g, '') : '';
    if (hsnClean && !/^\d{4,8}$/.test(hsnClean)) {
      return NextResponse.json(
        { error: 'HSN/SAC must be 4 to 8 digits', code: 'INVALID_HSN' },
        { status: 400 },
      );
    }
    const { resolveItemUqc } = await import('@/lib/gst/uqc');
    const finalUqc = resolveItemUqc({ uqc: body.uqc, unit, hsn_sac: hsnClean || null });
    const { normalizePack } = await import('@/lib/quantity-display');
    const pack = normalizePack({ pack_size, pack_unit, unit });
    if (pack.error) {
      return NextResponse.json({ error: pack.error, code: 'INVALID_PACK' }, { status: 400 });
    }

    // Force values for services or items with variants
    const finalOpeningStock = (item_type === 'service' || has_variants) ? 0 : opening_stock;
    const finalMinStock = (item_type === 'service' || has_variants) ? 0 : min_stock;
    
    // Selling price is null for items with variants (prices are in variants)
    const finalSellingPrice = (item_type === 'service' || has_variants)
      ? (selling_price !== undefined && selling_price !== null && selling_price !== '' ? Number(selling_price) : null)
      : (Number(selling_price) || 0);

    const normalizedPlu = plu_code
      ? String(plu_code).replace(/\D/g, '').slice(0, 5) || null
      : null;
    const normalizedWeightMode =
      weight_barcode_mode === 'price' ? 'price' : 'weight';

    const oversellOverride =
      allow_sale_when_out_of_stock === undefined
        ? null
        : Boolean(allow_sale_when_out_of_stock);

    const { resolveItemCategoryId } = await import('@/lib/item-category');
    const resolvedCategoryId = await resolveItemCategoryId(business_id, category_id);
    if (category_id && resolvedCategoryId === null) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }

    const hasExtras = ['video_url', 'store_tabs', 'size_chart', 'store_badge', 'store_tagline', 'store_swatches'].some((k) =>
      Object.prototype.hasOwnProperty.call(body, k),
    );
    let extras: Awaited<ReturnType<typeof import('@/lib/store/product-extras').validateProductExtras>> | null = null;
    if (hasExtras) {
      const { validateProductExtras } = await import('@/lib/store/product-extras');
      extras = validateProductExtras(body);
      if (!extras.ok) {
        return NextResponse.json({ error: extras.error }, { status: 400 });
      }
    }

    const pool = getPool();
    const client = await pool.connect();
    let item: Item | null = null;

    try {
      await client.query('BEGIN');

      const limitCheck = await checkLimitInTransaction(client, business_id, 'items');
      if (!limitCheck.allowed) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: limitCheck.message || 'Item limit reached',
            limit: limitCheck.limit,
            current: limitCheck.current,
            code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
          },
          { status: 403 },
        );
      }

      const idemRow = idem
        ? await insertReplayLogPending(client, {
            businessId: business_id,
            idempotencyKey: idem.scopedKey,
            actionType: ITEM_CREATE_IDEMPOTENCY_ACTION,
            requestHash: idem.hash,
            requestPayload: idem.storedPayload,
            userId: created_by,
          })
        : null;
      if (idem && !idemRow) {
        // Another request with this key committed first; answer as its replay.
        await client.query('ROLLBACK');
        const winner = await findItemCreateOutcome(getPool(), {
          businessId: business_id,
          scopedKey: idem.scopedKey,
          hash: idem.hash,
        });
        return idemResponse(winner ?? { kind: 'in_progress' });
      }

      const insertResult = await client.query<Item>(`
      INSERT INTO items (
        business_id, category_id, name, code, barcode, barcode_type, unit, selling_price, purchase_price, 
        tax_rate, hsn_sac, item_type, opening_stock, current_stock, min_stock, 
        default_supplier_id, has_variants, image_url, gst_included, mrp,
        fssai_licence_no, net_quantity, country_of_origin, brand,
        is_weighed, plu_code, weight_barcode_mode, allow_sale_when_out_of_stock,
        show_in_store, featured_in_store, uqc, pack_size, pack_unit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
              $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
      RETURNING *
    `, [
      business_id,
      resolvedCategoryId ?? null,
      name,
      code || null,
      normalizedBarcode,
      finalBarcodeType,
      unit,
      finalSellingPrice,
      purchase_price,
      tax_rate,
      hsnClean || null,
      item_type,
      finalOpeningStock,
      finalOpeningStock,
      finalMinStock,
      default_supplier_id || null,
      has_variants,
      image_url,
      gst_included || false,
      mrp || null,
      fssai_licence_no || null,
      net_quantity || null,
      country_of_origin || null,
      brand || null,
      !!is_weighed,
      normalizedPlu,
      normalizedWeightMode,
      oversellOverride,
      !!show_in_store || !!featured_in_store,
      !!featured_in_store,
      finalUqc,
      pack.pack_size,
      pack.pack_unit,
    ]);

      item = insertResult.rows[0] ?? null;
      if (!item) {
        await client.query('ROLLBACK');
        throw new Error('Failed to create item');
      }
      if (item_type === 'goods' && stock_class) {
        const { parseStockClass } = await import('@/lib/inventory/stock-class');
        const nextClass = parseStockClass(stock_class);
        if (nextClass !== 'trading') {
          try {
            const updated = await client.query<Item>(
              `UPDATE items SET stock_class = $1 WHERE id = $2 AND business_id = $3 RETURNING *`,
              [nextClass, item.id, business_id],
            );
            item = updated.rows[0] ?? item;
          } catch (error: any) {
            if (error?.code === '42703') {
              await client.query('ROLLBACK');
              return NextResponse.json(
                { error: 'Stock kinds need the inventory migration before they can be saved', code: 'MIGRATION_REQUIRED' },
                { status: 503 },
              );
            }
            throw error;
          }
        }
      }

      const { clipItemSeo } = await import('@/lib/store/item-seo');
      const seo = clipItemSeo({ seo_title, seo_description, seo_image_url });
      if (seo.seo_title || seo.seo_description || seo.seo_image_url) {
        await client.query(
          `UPDATE items SET seo_title = $1, seo_description = $2, seo_image_url = $3
           WHERE id = $4 AND business_id = $5`,
          [seo.seo_title, seo.seo_description, seo.seo_image_url, item.id, business_id],
        );
        item = { ...item, ...seo };
      }

      if (extras?.ok) {
        const v = extras.value;
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (v.video_url !== undefined) {
          vals.push(v.video_url);
          sets.push(`video_url = $${vals.length}`);
        }
        if (v.store_tabs !== undefined) {
          vals.push(JSON.stringify(v.store_tabs));
          sets.push(`store_tabs = $${vals.length}::jsonb`);
        }
        if (v.size_chart !== undefined) {
          vals.push(v.size_chart === null ? null : JSON.stringify(v.size_chart));
          sets.push(`size_chart = $${vals.length}::jsonb`);
        }
        if (v.store_badge !== undefined) {
          vals.push(v.store_badge);
          sets.push(`store_badge = $${vals.length}`);
        }
        if (v.store_tagline !== undefined) {
          vals.push(v.store_tagline);
          sets.push(`store_tagline = $${vals.length}`);
        }
        if (v.store_swatches !== undefined) {
          vals.push(JSON.stringify(v.store_swatches));
          sets.push(`store_swatches = $${vals.length}::jsonb`);
        }
        if (sets.length > 0) {
          vals.push(item.id, business_id);
          const updated = await client.query<Item>(
            `UPDATE items SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND business_id = $${vals.length} RETURNING *`,
            vals,
          );
          item = updated.rows[0] ?? item;
        }
      }

      if (lookup_source && normalizedBarcode) {
        const { externalSourceFromCache } = await import('@/lib/product-lookup/service');
        const source = await externalSourceFromCache(client, business_id, normalizedBarcode, String(lookup_source));
        if (source) {
          await client.query(
            `UPDATE items SET external_source = $1::jsonb WHERE id = $2 AND business_id = $3`,
            [JSON.stringify(source), item.id, business_id]
          );
          item = { ...item, external_source: source } as Item;
        }
      }

      // Opening stock of a plain item posts in the same transaction as the item, so a failed save
      // leaves neither and a retried save cannot post it twice.
      if (finalOpeningStock > 0 && item_type === 'goods') {
        // Batch and expiry from the pack: the stock goes into that batch, and the item draws
        // batches down oldest first (FIFO). Without stock there is nothing to put in a batch.
        let batchId: string | null = null;
        if (openingBatch && !('error' in openingBatch)) {
          const batchRow = await client.query<{ id: string }>(
            `INSERT INTO item_batches (
               business_id, item_id, batch_number, manufacturing_date, expiry_date, purchase_price, quantity, notes
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Opening stock')
             RETURNING id`,
            [
              business_id,
              item.id,
              openingBatch.batchNumber,
              openingBatch.manufacturingDate,
              openingBatch.expiryDate,
              Number(purchase_price) || 0,
              finalOpeningStock,
            ]
          );
          batchId = batchRow.rows[0]?.id ?? null;
          await client.query(
            `UPDATE items SET track_batch = true, valuation_method = 'fifo' WHERE id = $1 AND business_id = $2`,
            [item.id, business_id]
          );
          item = { ...item, track_batch: true, valuation_method: 'fifo' } as Item;
        }
        await client.query(
          `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, notes, batch_id, unit_cost)
           VALUES ($1, $2, 'in', $3, 'adjustment', 'Opening Stock', $4, $5)`,
          // Cost and batch only when a batch was saved, so the New Item form posts exactly as before.
          [business_id, item.id, finalOpeningStock, batchId, batchId ? Number(purchase_price) || 0 : null]
        );
        await seedOpeningStockLayers(business_id, {
          itemId: item.id,
          quantity: finalOpeningStock,
          client,
        });
      }

      if (idemRow) {
        await markReplayCompleted(client, idemRow.id, { item_id: item.id }, { type: 'item', id: item.id });
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    if (!item) throw new Error('Failed to create item');

    if (gallery_urls !== undefined || image_url) {
      const { extraGalleryUrls, sanitizeGalleryUrls } = await import('@/lib/store/item-gallery');
      const extras = extraGalleryUrls(sanitizeGalleryUrls(gallery_urls, image_url), String(image_url || ''));
      await query(
        `UPDATE items SET gallery_urls = $1::jsonb WHERE id = $2 AND business_id = $3`,
        [JSON.stringify(extras), item.id, business_id],
      );
    }

    if (Object.prototype.hasOwnProperty.call(body, 'custom_fields')) {
      const { saveItemCustomFields } = await import('@/lib/custom-fields-persist');
      const cfResult = await saveItemCustomFields(business_id, item.id, custom_fields);
      if (!cfResult.ok) {
        return NextResponse.json({ error: cfResult.error }, { status: 400 });
      }
    }

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
    }

    if (item_type === 'goods') {
      try {
        const { syncItemOpeningStockLedger } = await import('@/lib/inventory/opening-stock-ledger');
        await syncItemOpeningStockLedger(business_id, item.id);
      } catch (ledgerError) {
        console.error('Error posting opening stock ledger entry for item:', ledgerError);
      }
    }

    noteShopChanged(business_id, 'item created');
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
