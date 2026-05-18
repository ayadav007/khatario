/**
 * When a final purchase line is goods but has no catalogue item_id (e.g. "New item" from invoice),
 * create a minimal items row and return its id so stock can be received.
 */

import type { PoolClient } from 'pg';
import { checkLimit } from '@/lib/subscription';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { PurchaseStockError } from '@/lib/purchase-goods-stock';

export async function createCatalogItemFromAdHocPurchaseLine(
  client: PoolClient,
  ctx: {
    businessId: string;
    createdBy: string;
    rawLineName: string;
    unit: string;
    purchasePrice: number;
    taxRate: number;
    hsnSac: string | null;
    defaultSupplierId: string | null;
  },
): Promise<string> {
  const limitCheck = await checkLimit(ctx.businessId, 'items');
  if (!limitCheck.allowed) {
    throw new PurchaseStockError(
      limitCheck.message || 'Item limit reached — cannot add a new catalogue product from this bill.',
      403,
      'SUBSCRIPTION_LIMIT_EXCEEDED',
      { limit: limitCheck.limit, current: limitCheck.current },
    );
  }

  try {
    await authorize(ctx.createdBy, 'items', 'create');
  } catch (e) {
    if (e instanceof AuthorizationError) {
      throw new PurchaseStockError(
        'You do not have permission to create new items. Add the product under Items first, or ask an admin.',
        403,
        'ITEM_CREATE_DENIED',
      );
    }
    throw e;
  }

  const displayName =
    ctx.rawLineName.replace(/^L\s+/i, '').trim() || String(ctx.rawLineName).trim();
  if (!displayName) {
    throw new PurchaseStockError('Line has no name — cannot create a catalogue item.', 400, 'ITEM_NAME_MISSING');
  }

  const dup = await client.query(
    `
    SELECT id FROM items
    WHERE business_id = $1
      AND deleted_at IS NULL
      AND (is_active IS NULL OR is_active = true)
      AND LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM($2::text), '\\s+', ' ', 'g'))
    LIMIT 1
  `,
    [ctx.businessId, displayName],
  );
  if (dup.rows[0]) {
    return dup.rows[0].id as string;
  }

  /** Selling price left unset — user edits item or sets rate on invoice; purchase price comes from the bill. */
  const selling = 0;
  const purchase = Number(ctx.purchasePrice) || 0;
  const tax = Number(ctx.taxRate) || 0;

  const ins = await client.query(
    `
    INSERT INTO items (
      business_id, name, code, barcode, barcode_type, unit, selling_price, purchase_price,
      tax_rate, hsn_sac, item_type, opening_stock, current_stock, min_stock,
      default_supplier_id, has_variants, image_url, gst_included, mrp,
      fssai_licence_no, net_quantity, country_of_origin, brand,
      is_weighed, plu_code, weight_barcode_mode, allow_sale_when_out_of_stock
    )
    VALUES (
      $1, $2, NULL, NULL, NULL, $3, $4, $5, $6, $7, 'goods', 0, 0, 0,
      $8, false, NULL, false, NULL,
      NULL, NULL, NULL, NULL,
      false, NULL, 'weight', NULL
    )
    RETURNING id
  `,
    [
      ctx.businessId,
      displayName,
      ctx.unit || 'PCS',
      selling,
      purchase,
      tax,
      ctx.hsnSac || null,
      ctx.defaultSupplierId,
    ],
  );

  const id = ins.rows[0]?.id as string | undefined;
  if (!id) {
    throw new PurchaseStockError('Failed to create catalogue item.', 500, 'ITEM_INSERT_FAILED');
  }
  return id;
}
