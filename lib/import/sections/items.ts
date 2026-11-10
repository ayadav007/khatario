import { createImportedItem } from '@/lib/items/create-imported-item';
import { normaliseKey } from '@/lib/import/parse-values';
import { removeUnused } from '@/lib/import/record-usage';
import { compactName, firstMatch, fromService, NAME_SQL, num, text, undoOne } from '@/lib/import/sections/shared';
import type { SectionDefinition } from '@/lib/import/types';

const OPENING_STOCK_REASON = 'Has opening stock. Delete it from the Items list if it is not needed.';

/**
 * Items with opening stock are kept. Checked before the generic reference check, which the
 * opening stock movement would otherwise answer. Reversing opening stock belongs to plan 2.
 */
const undoRecords: SectionDefinition['undoRecords'] = (ctx, ids) =>
  removeUnused('items', ctx, ids, async (client, live) => {
    const stocked = await client.query<{ id: string }>(
      `SELECT i.id FROM items i
        WHERE i.id = ANY($1::uuid[]) AND i.business_id = $2
          AND (COALESCE(i.opening_stock, 0) > 0 OR EXISTS (
            SELECT 1 FROM stock_movements m
             WHERE m.item_id = i.id AND m.notes ILIKE 'Opening Stock%'))`,
      [live, ctx.businessId]
    );
    return new Map(stocked.rows.map((r) => [r.id, OPENING_STOCK_REASON]));
  });

export const itemsSection: SectionDefinition = {
  key: 'items',
  label: 'Items',
  module: 'items',
  limitType: 'items',
  fields: [
    { key: 'name', label: 'Item name', type: 'text', required: true, aliases: ['Name', 'Item name', 'Item', 'Product name', 'Product'] },
    { key: 'code', label: 'Item code', type: 'text', aliases: ['Item code', 'Code', 'SKU', 'Product code'] },
    { key: 'barcode', label: 'Barcode', type: 'text', aliases: ['Barcode', 'EAN', 'UPC'] },
    { key: 'unit', label: 'Unit', type: 'unit', aliases: ['Unit', 'Units', 'UOM', 'Unit of measure'] },
    { key: 'item_type', label: 'Type', type: 'text', aliases: ['Type', 'Item type', 'Product type'] },
    { key: 'category_name', label: 'Category', type: 'text', aliases: ['Category', 'Group', 'Item group'] },
    { key: 'selling_price', label: 'Selling price', type: 'amount', aliases: ['Selling price', 'Sale price', 'Sales price', 'Price'] },
    { key: 'purchase_price', label: 'Purchase price', type: 'amount', aliases: ['Purchase price', 'Cost price', 'Cost'] },
    { key: 'mrp', label: 'MRP', type: 'amount', aliases: ['MRP'] },
    { key: 'tax_rate', label: 'Tax rate', type: 'tax_rate', aliases: ['Tax rate', 'GST rate', 'GST %', 'Tax %', 'GST'] },
    { key: 'hsn_sac', label: 'HSN/SAC', type: 'text', aliases: ['HSN/SAC', 'HSN', 'SAC', 'HSN code'] },
    { key: 'opening_stock', label: 'Opening stock', type: 'number', aliases: ['Opening stock', 'Opening quantity', 'Opening qty', 'Stock', 'Quantity'] },
    { key: 'min_stock', label: 'Minimum stock', type: 'number', aliases: ['Minimum stock', 'Min stock', 'Reorder level'] },
    { key: 'description', label: 'Description', type: 'text', aliases: ['Description', 'Details'] },
  ],

  duplicateKeys(values) {
    const keys: string[] = [];
    const code = text(values, 'code');
    if (code) keys.push(`code:${code.toLowerCase()}`);
    const barcode = text(values, 'barcode');
    if (barcode) keys.push(`barcode:${barcode}`);
    const name = compactName(values.name);
    if (name) keys.push(`name:${name}`);
    return keys;
  },

  findExisting(ctx, values) {
    const scope = `SELECT id, name FROM items WHERE business_id = $1 AND deleted_at IS NULL`;
    return firstMatch(
      [
        { matchedOn: 'item code', value: text(values, 'code')?.toLowerCase(), sql: `${scope} AND LOWER(TRIM(code)) = $2 LIMIT 1` },
        { matchedOn: 'barcode', value: text(values, 'barcode'), sql: `${scope} AND TRIM(barcode) = $2 LIMIT 1` },
        { matchedOn: 'name', value: compactName(values.name), sql: `${scope} AND ${NAME_SQL} = $2 LIMIT 1` },
      ],
      ctx.businessId
    );
  },

  async saveRow(ctx, values) {
    const type = text(values, 'item_type');
    return fromService(
      'items',
      await createImportedItem(ctx, {
        name: text(values, 'name') ?? '',
        code: text(values, 'code'),
        barcode: text(values, 'barcode'),
        unit: text(values, 'unit'),
        item_type: type && normaliseKey(type).includes('service') ? 'service' : 'goods',
        category_name: text(values, 'category_name'),
        selling_price: num(values, 'selling_price'),
        purchase_price: num(values, 'purchase_price'),
        mrp: num(values, 'mrp'),
        tax_rate: num(values, 'tax_rate'),
        hsn_sac: text(values, 'hsn_sac'),
        opening_stock: num(values, 'opening_stock'),
        min_stock: num(values, 'min_stock'),
        description: text(values, 'description'),
      })
    );
  },

  undoRecords,
  undoRecord: undoOne(undoRecords),
};
