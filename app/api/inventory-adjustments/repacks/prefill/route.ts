export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { repackContext, repackErrorResponse, UUID_RE } from '@/lib/repack-route';

type ItemSide = {
  id: string;
  name: string;
  unit: string | null;
  stock: number;
  is_bundle: boolean;
  has_variants: boolean;
  item_type: string | null;
  pack_source_item_id: string | null;
  pack_source_qty: number | null;
};

/**
 * GET /api/inventory-adjustments/repacks/prefill?item_id=&other_item_id=&branch_id=&location_id=
 * What the Repack screen needs to open filled in: both items with stock at the branch or
 * warehouse, the saved content per pack, the last repack's quantities, and the supplier's unit
 * (for example 1 BAG = 26 KG from the Supplier Hub item map).
 * `item_id` may be either side: a packed item brings its source, a bulk item its first packed item.
 */
export async function GET(request: NextRequest) {
  const ctx = await repackContext(request, 'read');
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { searchParams } = new URL(request.url);
    const id = (k: string) => {
      const v = searchParams.get(k);
      return v && UUID_RE.test(v) ? v : null;
    };
    const itemId = id('item_id');
    const otherId = id('other_item_id');
    const branchId = id('branch_id');
    const locationId = id('location_id');
    if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

    const load = async (target: string): Promise<ItemSide | null> =>
      queryOne<ItemSide>(
        `SELECT i.id, i.name, i.unit, COALESCE(i.is_bundle, false) AS is_bundle,
                COALESCE(i.has_variants, false) AS has_variants, i.item_type,
                i.pack_source_item_id, i.pack_source_qty::float AS pack_source_qty,
                COALESCE(
                  CASE
                    WHEN $3::uuid IS NOT NULL THEN
                      (SELECT ls.current_stock_qty FROM location_stock ls
                        JOIN warehouses w ON w.id = ls.location_id AND w.business_id = $2
                       WHERE ls.location_id = $3::uuid AND ls.item_id = i.id)
                    WHEN $4::uuid IS NOT NULL THEN
                      (SELECT bis.quantity FROM branch_item_stock bis
                        WHERE bis.business_id = $2 AND bis.branch_id = $4::uuid AND bis.item_id = i.id)
                    ELSE i.current_stock
                  END, 0)::float AS stock
           FROM items i
          WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
        [target, ctx.businessId, locationId, branchId]
      );

    const first = await load(itemId);
    if (!first) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    let source: ItemSide | null = null;
    let packed: ItemSide | null = null;
    if (otherId) {
      const other = await load(otherId);
      if (first.pack_source_item_id === otherId) [packed, source] = [first, other];
      else [source, packed] = [first, other];
    } else if (first.pack_source_item_id) {
      packed = first;
      source = await load(first.pack_source_item_id);
    } else {
      source = first;
      const child = await queryOne<{ id: string }>(
        `SELECT id FROM items
          WHERE business_id = $1 AND pack_source_item_id = $2 AND deleted_at IS NULL
          ORDER BY name LIMIT 1`,
        [ctx.businessId, first.id]
      );
      if (child) packed = await load(child.id);
    }

    const content =
      packed && source && packed.pack_source_item_id === source.id ? packed.pack_source_qty : null;

    const last =
      source && packed
        ? await queryOne<{ source_qty: number; packed_qty: number; wastage_reason: string | null }>(
            `SELECT source_qty::float AS source_qty, packed_qty::float AS packed_qty, wastage_reason
               FROM stock_repacks
              WHERE business_id = $1 AND source_item_id = $2 AND packed_item_id = $3 AND status = 'posted'
              ORDER BY created_at DESC LIMIT 1`,
            [ctx.businessId, source.id, packed.id]
          )
        : null;

    const vendorUnits = source
      ? await queryRows<{ unit: string | null; per: number }>(
          `SELECT DISTINCT vi.unit, l.buyer_units_per_vendor_unit::float AS per
             FROM supplier_item_links l
             JOIN items vi ON vi.id = l.vendor_item_id
            WHERE l.buyer_business_id = $1 AND l.buyer_item_id = $2 AND l.buyer_units_per_vendor_unit > 1
            ORDER BY per DESC LIMIT 3`,
          [ctx.businessId, source.id]
        ).catch(() => [])
      : [];

    // Estimate only: the repack itself costs from FIFO lots or the weighted average when saved.
    const sourceUnitCost = source
      ? (await currentUnitCosts(undefined, ctx.businessId, [source.id], new Date().toISOString().slice(0, 10), branchId)).get(source.id) ?? 0
      : 0;

    return NextResponse.json({
      source: source ? { ...source, unit_cost: Math.round(sourceUnitCost * 100) / 100 } : null,
      packed,
      content_per_unit: content,
      last,
      vendor_units: vendorUnits.filter((v) => v.per > 0).map((v) => ({ unit: v.unit || 'unit', per: v.per })),
    });
  } catch (error) {
    return repackErrorResponse(error, 'Failed to load repack details');
  }
}
