import { queryOne, query } from '@/lib/db';
import { seedOpeningStockLayers } from '@/lib/seed-opening-stock-layers';
import type { CreateResult, ServiceCtx } from '@/lib/import/types';

/** The row fields POST /api/items/import reads. */
export interface ImportItemInput {
  name: string;
  code?: string;
  barcode?: string;
  unit?: string;
  item_type?: 'goods' | 'service';
  category_name?: string;
  selling_price?: number;
  purchase_price?: number;
  mrp?: number;
  tax_rate?: number;
  hsn_sac?: string;
  opening_stock?: number;
  min_stock?: number;
  description?: string;
  image_url?: string;
  is_active?: boolean;
}

/**
 * Creates one item the way the items import always has: category by name, defaults,
 * insert, and for goods with opening stock the stock movement, branch stock layers and
 * opening stock ledger. Throws on database errors; the caller records them per row.
 */
export async function createImportedItem(
  ctx: ServiceCtx,
  row: ImportItemInput
): Promise<CreateResult<{ id: string }>> {
  const business_id = ctx.businessId;
  if (!row.name) {
    return { ok: false, status: 400, code: 'MISSING_NAME', error: 'Missing name' };
  }

  // Look up category by name if provided
  let categoryId = null;
  if (row.category_name) {
    const category = await queryOne(
      'SELECT id FROM categories WHERE business_id = $1 AND name = $2 LIMIT 1',
      [business_id, row.category_name.trim()]
    );
    categoryId = category?.id || null;
  }

  // Determine item_type (default to 'goods' if not specified)
  const itemType = row.item_type === 'service' ? 'service' : 'goods';

  // Set opening_stock to 0 for services
  const openingStock = itemType === 'service' ? 0 : (row.opening_stock ?? 0);

  const item = await queryOne<{ id: string }>(
    `INSERT INTO items (
      business_id, category_id, name, code, barcode, unit, item_type,
      selling_price, purchase_price, mrp, tax_rate, hsn_sac,
      opening_stock, current_stock, min_stock, description, image_url, is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17)
    RETURNING id`,
    [
      business_id,
      categoryId,
      row.name,
      row.code || null,
      row.barcode || null,
      row.unit || 'PCS',
      itemType,
      row.selling_price ?? 0,
      row.purchase_price ?? 0,
      row.mrp || null,
      row.tax_rate ?? 18,
      row.hsn_sac || null,
      openingStock,
      row.min_stock ?? 0,
      row.description || null,
      row.image_url || null,
      row.is_active !== false, // default to true
    ]
  );

  // Record opening stock movement (only for goods)
  if (item && openingStock > 0) {
    await query(
      `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, notes)
       VALUES ($1, $2, 'in', $3, 'adjustment', 'Opening Stock (Import)')`,
      [business_id, item.id, openingStock]
    );
    await seedOpeningStockLayers(business_id, {
      itemId: item.id,
      quantity: openingStock,
    });
    const { syncItemOpeningStockLedger } = await import('@/lib/inventory/opening-stock-ledger');
    await syncItemOpeningStockLedger(business_id, item.id);
  }

  return { ok: true, record: { id: item!.id } };
}
